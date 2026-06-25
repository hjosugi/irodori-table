import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadBlob,
  erdFileName,
  serializeSvgElement,
  svgMarkupToPngBlob,
} from "./erd-export";

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
    style.textContent = ".erd-table { fill: #fff; }\n.erd-edge { stroke: #333; }";
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
    expect(parsedSvg.querySelector("style")?.getAttribute("type")).toBe("text/css");
    expect(parsedSvg.querySelector("style")?.textContent).toContain(
      ".erd-edge { stroke: #333; }",
    );
    expect(style.hasAttribute("type")).toBe(false);
  });

  it("downloads blobs with the requested file name and revokes object URLs", () => {
    vi.useFakeTimers();
    const { createObjectURL, revokeObjectURL } = stubObjectUrls("blob:erd-svg");
    const clickedDownloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedDownloads.push(this.download);
    });
    const blob = new Blob(["<svg />"], { type: "image/svg+xml" });

    downloadBlob(blob, "diagram.svg");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickedDownloads).toEqual(["diagram.svg"]);
    expect(document.body.querySelector("a")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:erd-svg");
  });

  it("rejects invalid and oversized PNG dimensions", async () => {
    const { revokeObjectURL } = stubObjectUrls("blob:erd-png");
    stubImageThatLoads();

    await expect(svgMarkupToPngBlob("<svg />", 0, 100)).rejects.toThrow(
      "ERD has invalid dimensions",
    );
    await expect(svgMarkupToPngBlob("<svg />", 100, Number.POSITIVE_INFINITY)).rejects.toThrow(
      "ERD has invalid dimensions",
    );
    await expect(svgMarkupToPngBlob("<svg />", 20_000, 100)).rejects.toThrow(
      "ERD is too large to export as PNG; export SVG instead",
    );
    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
  });
});

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
  const original = Object.getOwnPropertyDescriptor(URL, name);
  Object.defineProperty(URL, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (original) {
      Object.defineProperty(URL, name, original);
    } else {
      delete (URL as unknown as Record<UrlObjectMethod, unknown>)[name];
    }
  };
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
