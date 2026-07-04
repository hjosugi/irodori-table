import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EngineIcon } from "@/components/EngineIcon";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

function renderedSvg(engine: string): SVGSVGElement | null {
  flushSync(() => root.render(<EngineIcon engine={engine} />));
  return container.querySelector("svg");
}

function svgClass(svg: SVGSVGElement | null): string {
  return svg?.getAttribute("class") ?? "";
}

describe("EngineIcon", () => {
  it("renders a brand mark (not a lucide glyph) for engines with a public-domain logo", () => {
    for (const engine of ["postgres", "mysql", "mongodb", "redis", "duckdb"]) {
      const svg = renderedSvg(engine);
      expect(svg, engine).not.toBeNull();
      expect(svgClass(svg), engine).not.toContain("lucide");
    }
  });

  it("falls back to a neutral lucide category glyph for trademark-strict engines", () => {
    // Oracle / SQL Server are deliberately absent from the CC0 brand set, so we
    // must not ship a look-alike — they render a neutral category glyph instead.
    for (const engine of ["oracle", "sqlserver", "redshift", "dynamodb"]) {
      const svg = renderedSvg(engine);
      expect(svg, engine).not.toBeNull();
      expect(svgClass(svg), engine).toContain("lucide");
    }
  });

  it("renders a default glyph for unknown engine ids without throwing", () => {
    const svg = renderedSvg("totally-unknown-engine-xyz");
    expect(svg).not.toBeNull();
    expect(svgClass(svg)).toContain("lucide");
  });

  it("renders brand marks monochrome (currentColor), never a hardcoded brand color", () => {
    const svg = renderedSvg("postgres");
    const fill = svg?.getAttribute("fill");
    // Forced to currentColor so the logo blends into the UI theme; must never be
    // a baked-in brand hex.
    expect(fill === null || fill === "currentColor").toBe(true);
    expect(fill ?? "").not.toMatch(/^#?[0-9a-fA-F]{6}$/);
  });
});
