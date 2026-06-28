import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  downloadBlob,
  erdFileName,
  serializeSvgElement,
  svgMarkupToPngBlob,
} from "@/features/erd/erd-export";
import { buildErdModel, layoutErdModel } from "@/features/erd/erd";
import { ErdSvg, erdSvgStyle } from "@/features/erd/erd-svg";
import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import { lightTheme } from "@/theme";

const SVG_NS = "http://www.w3.org/2000/svg";

type UrlObjectMethod = "createObjectURL" | "revokeObjectURL";

const urlRestorers: Array<() => void> = [];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const restore of urlRestorers.splice(0).reverse()) {
    restore();
  }
  document.body.replaceChildren();
});

describe("ERD exports", () => {
  it("builds deterministic sanitized file names", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T00:00:00.000Z"));

    expect(erdFileName("local/main db", ".SVG")).toBe(
      "irodori-erd-local-main-db-2026-06-25T00-00-00-000Z.svg",
    );
    expect(erdFileName(" /// ", "%%%")).toBe(
      "irodori-erd-connection-2026-06-25T00-00-00-000Z.dat",
    );
  });

  it("serializes SVG dimensions, viewBox, and embedded styles", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("width", "640");
    svg.setAttribute("height", "420");
    svg.setAttribute("viewBox", "0 0 640 420");

    const style = document.createElementNS(SVG_NS, "style");
    style.textContent =
      ".erd-table { fill: #fff; }\n.erd-edge { stroke: #333; }";
    svg.append(style);

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("width", "640");
    rect.setAttribute("height", "420");
    svg.append(rect);

    const markup = serializeSvgElement(svg);
    const parsedSvg = new DOMParser().parseFromString(
      markup,
      "image/svg+xml",
    ).documentElement;

    expect(markup).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n/);
    expect(markup).toContain(`xmlns="${SVG_NS}"`);
    expect(markup.match(/xmlns=/g)).toHaveLength(1);
    expect(parsedSvg.namespaceURI).toBe(SVG_NS);
    expect(parsedSvg.getAttribute("version")).toBe("1.1");
    expect(parsedSvg.getAttribute("width")).toBe("640");
    expect(parsedSvg.getAttribute("height")).toBe("420");
    expect(parsedSvg.getAttribute("viewBox")).toBe("0 0 640 420");
    expect(parsedSvg.querySelector("style")?.getAttribute("type")).toBe(
      "text/css",
    );
    expect(parsedSvg.querySelector("style")?.textContent).toContain(
      ".erd-edge { stroke: #333; }",
    );
    expect(style.hasAttribute("type")).toBe(false);
  });

  it("serializes a rendered ERD SVG with dimensions, groups, and edges", () => {
    const metadata: DatabaseMetadata = {
      schemas: [
        {
          name: "sales",
          objects: [
            table("sales", "customers", ["id", "email"]),
            table(
              "sales",
              "orders",
              ["id", "customer_id", "owner_id"],
              [
                {
                  columns: ["customer_id"],
                  referencesTable: "customers",
                  referencesColumns: ["id"],
                },
                {
                  columns: ["owner_id"],
                  referencesSchema: "auth",
                  referencesTable: "users",
                  referencesColumns: ["id"],
                },
              ],
            ),
          ],
        },
        {
          name: "auth",
          objects: [table("auth", "users", ["id", "name"])],
        },
      ],
    };
    const layout = layoutErdModel(buildErdModel(metadata));
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      createElement(ErdSvg, {
        layout,
        svgRef: createRef<SVGSVGElement>(),
        svgStyle: erdSvgStyle(lightTheme),
      }),
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeInstanceOf(SVGSVGElement);

    const markup = serializeSvgElement(svg as SVGSVGElement);
    const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    const parsedSvg = parsed.documentElement;

    expect(blob.size).toBeGreaterThan(1000);
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsedSvg.getAttribute("width")).toBe(String(layout.width));
    expect(parsedSvg.getAttribute("height")).toBe(String(layout.height));
    expect(parsedSvg.getAttribute("viewBox")).toBe(
      `0 0 ${layout.width} ${layout.height}`,
    );
    expect(svgTextContent(parsedSvg, ".erd-schema-title")).toEqual([
      "sales",
      "auth",
    ]);
    expect(svgTextContent(parsedSvg, ".erd-table-title")).toEqual([
      "customers",
      "orders",
      "users",
    ]);
    expect(parsedSvg.querySelectorAll(".erd-schema")).toHaveLength(2);
    expect(parsedSvg.querySelectorAll("path.erd-edge")).toHaveLength(2);
    expect(parsedSvg.querySelectorAll("path.erd-edge.cross")).toHaveLength(1);
    expect(svgTextContent(parsedSvg, ".erd-edge-label")).toEqual([
      "customer_id",
      "owner_id",
    ]);
    expect(markup).not.toMatch(/\b(?:NaN|undefined)\b/);
  });

  it("downloads blobs with the requested file name and revokes object URLs", () => {
    vi.useFakeTimers();
    const { createObjectURL, revokeObjectURL } = stubObjectUrls("blob:erd-svg");
    const clickedDownloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clickedDownloads.push(this.download);
      },
    );
    const blob = new Blob(["<svg />"], { type: "image/svg+xml" });

    downloadBlob(blob, "diagram.svg");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickedDownloads).toEqual(["diagram.svg"]);
    expect(document.body.querySelector("a")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:erd-svg");
  });

  it("converts SVG markup to a non-empty PNG blob", async () => {
    const { createObjectURL, revokeObjectURL } = stubObjectUrls("blob:erd-png");
    stubImageThatLoads();
    const canvas = stubCanvasPng();

    const blob = await svgMarkupToPngBlob(
      `<svg xmlns="${SVG_NS}" width="240" height="120" viewBox="0 0 240 120"><rect width="240" height="120" /></svg>`,
      240,
      120,
    );

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:erd-png");
    expect(canvas.getContext).toHaveBeenCalledWith("2d");
    expect(canvas.setTransform).toHaveBeenCalled();
    expect(canvas.drawImage).toHaveBeenCalled();
    expect(canvas.canvasSizes).toHaveLength(1);
    expect(canvas.canvasSizes[0].width).toBeGreaterThanOrEqual(240);
    expect(canvas.canvasSizes[0].height).toBeGreaterThanOrEqual(120);
  });

  it("rejects invalid and oversized PNG dimensions", async () => {
    const { revokeObjectURL } = stubObjectUrls("blob:erd-png");
    stubImageThatLoads();

    await expect(svgMarkupToPngBlob("<svg />", 0, 100)).rejects.toThrow(
      "ERD has invalid dimensions",
    );
    await expect(
      svgMarkupToPngBlob("<svg />", 100, Number.POSITIVE_INFINITY),
    ).rejects.toThrow("ERD has invalid dimensions");
    await expect(svgMarkupToPngBlob("<svg />", 20_000, 100)).rejects.toThrow(
      "ERD is too large to export as PNG; export SVG instead",
    );
    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
  });
});

function table(
  schema: string,
  name: string,
  columns: string[],
  foreignKeys: DbObjectMetadata["foreignKeys"] = [],
): DbObjectMetadata {
  return {
    schema,
    name,
    kind: "table",
    columns: columns.map((column, index) => ({
      name: column,
      dataType: index === 0 ? "integer" : "text",
      nullable: index !== 0,
      ordinal: index + 1,
    })),
    indexes: [],
    primaryKey: [columns[0]],
    foreignKeys,
  };
}

function svgTextContent(root: Element, selector: string) {
  return Array.from(
    root.querySelectorAll(selector),
    (node) => node.textContent ?? "",
  );
}

function stubObjectUrls(url: string) {
  const createObjectURL = vi.fn(() => url);
  const revokeObjectURL = vi.fn();
  urlRestorers.push(
    setUrlObjectMethod("createObjectURL", createObjectURL),
    setUrlObjectMethod("revokeObjectURL", revokeObjectURL),
  );
  return { createObjectURL, revokeObjectURL };
}

function setUrlObjectMethod(name: UrlObjectMethod, value: unknown) {
  return setObjectMethod(URL, name, value);
}

function setObjectMethod(target: object, name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (original) {
      Object.defineProperty(target, name, original);
    } else {
      delete (target as Record<string, unknown>)[name];
    }
  };
}

function stubCanvasPng() {
  const canvasSizes: Array<{ width: number; height: number }> = [];
  const setTransform = vi.fn();
  const drawImage = vi.fn();
  const getContext = vi.fn(() => ({ setTransform, drawImage }));
  const toBlob = vi.fn(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
  ) {
    canvasSizes.push({ width: this.width, height: this.height });
    callback(new Blob(["png bytes"], { type: type ?? "image/png" }));
  });
  urlRestorers.push(
    setObjectMethod(HTMLCanvasElement.prototype, "getContext", getContext),
    setObjectMethod(HTMLCanvasElement.prototype, "toBlob", toBlob),
  );
  return { canvasSizes, drawImage, getContext, setTransform, toBlob };
}

function stubImageThatLoads() {
  class LoadingImage {
    onload: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }

  vi.stubGlobal("Image", LoadingImage);
}
