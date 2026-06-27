import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { ColumnMetadata, DatabaseMetadata, DbObjectMetadata } from "@/generated/irodori-api";
import { buildErdModel, layoutErdModel } from "@/features/erd/erd";
import { ErdSvg, erdSvgStyle } from "@/features/erd/erd-svg";
import { serializeSvgElement, svgMarkupToPngBlob } from "@/features/erd/erd-export";
import { lightTheme } from "@/theme";

function table(
  schema: string,
  name: string,
  columns: readonly string[],
  foreignKeys: DbObjectMetadata["foreignKeys"] = [],
): DbObjectMetadata {
  return {
    schema,
    name,
    kind: "table",
    primaryKey: columns.includes("id") ? ["id"] : [],
    indexes: [],
    foreignKeys,
    columns: columns.map<ColumnMetadata>((column, index) => ({
      name: column,
      dataType: column === "id" ? "integer" : "text",
      nullable: column !== "id",
      ordinal: index + 1,
    })),
  };
}

function metadata(): DatabaseMetadata {
  return {
    schemas: [
      {
        name: "sales",
        objects: [
          table("sales", "customers", ["id", "name"]),
          table("sales", "orders", ["id", "customer_id"], [
            {
              columns: ["customer_id"],
              referencesTable: "customers",
              referencesColumns: ["id"],
            },
          ]),
        ],
      },
      {
        name: "auth",
        objects: [
          table("auth", "users", ["id", "display_name"]),
          table("auth", "sessions", ["id", "user_id"], [
            {
              columns: ["user_id"],
              referencesTable: "users",
              referencesColumns: ["id"],
            },
          ]),
        ],
      },
    ],
  };
}

async function decodePng(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("PNG did not decode"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Canvas is unavailable");
    }
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set<string>();
    let opaqueSamples = 0;
    const step = Math.max(1, Math.floor((canvas.width * canvas.height) / 2500));
    for (let offset = 0; offset < pixels.length; offset += step * 4) {
      const alpha = pixels[offset + 3];
      if (alpha > 0) {
        opaqueSamples += 1;
        colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${alpha}`);
      }
    }
    return {
      width: canvas.width,
      height: canvas.height,
      opaqueSamples,
      colorCount: colors.size,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

describe("ERD browser rendering", () => {
  it("renders ERD SVG and converts it to a non-empty PNG in a real browser", async () => {
    const layout = layoutErdModel(buildErdModel(metadata()));
    const host = document.createElement("div");
    document.body.append(host);

    const root = createRoot(host);
    flushSync(() => root.render(
      <ErdSvg
        layout={layout}
        svgRef={createRef<SVGSVGElement>()}
        svgStyle={erdSvgStyle(lightTheme)}
      />,
    ));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const svg = host.querySelector("svg.erd-svg");
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(host.querySelectorAll("path.erd-edge")).toHaveLength(2);

    const markup = serializeSvgElement(svg as SVGSVGElement);
    expect(markup).toContain("Entity relationship diagram");
    expect(markup).not.toMatch(/\b(?:NaN|undefined)\b/);

    const png = await svgMarkupToPngBlob(markup, layout.width, layout.height);
    expect(png.type).toBe("image/png");
    expect(png.size).toBeGreaterThan(1_000);

    const stats = await decodePng(png);
    expect(stats.width).toBeGreaterThan(500);
    expect(stats.height).toBeGreaterThan(300);
    expect(stats.opaqueSamples).toBeGreaterThan(100);
    expect(stats.colorCount).toBeGreaterThan(3);

    root.unmount();
    host.remove();
  });
});
