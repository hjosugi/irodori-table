import { describe, expect, it } from "vitest";
import {
  hitTestWebGlResultGrid,
  parseWebGlColor,
  webGlResultGridScrollSize,
} from "@/features/results/webgl-grid";

describe("webgl result grid helpers", () => {
  it("hit-tests sticky headers and scrolled cells", () => {
    const base = {
      scrollLeft: 0,
      scrollTop: 270,
      headerHeight: 27,
      rowHeight: 27,
      columnWidth: 148,
      rowCount: 1_000,
      columnCount: 10,
    };

    expect(hitTestWebGlResultGrid({ ...base, x: 160, y: 10 })).toEqual({
      kind: "header",
      columnIndex: 1,
    });
    expect(hitTestWebGlResultGrid({ ...base, x: 160, y: 30 })).toEqual({
      kind: "cell",
      rowIndex: 10,
      columnIndex: 1,
    });
    expect(
      hitTestWebGlResultGrid({ ...base, x: 160, y: 30, scrollLeft: 296 }),
    ).toEqual({
      kind: "cell",
      rowIndex: 10,
      columnIndex: 3,
    });
  });

  it("bounds hit-tests outside the logical result", () => {
    const input = {
      scrollLeft: 0,
      scrollTop: 0,
      headerHeight: 27,
      rowHeight: 27,
      columnWidth: 148,
      rowCount: 2,
      columnCount: 2,
    };

    expect(hitTestWebGlResultGrid({ ...input, x: -1, y: 0 })).toBeNull();
    expect(hitTestWebGlResultGrid({ ...input, x: 400, y: 30 })).toBeNull();
    expect(hitTestWebGlResultGrid({ ...input, x: 10, y: 200 })).toBeNull();
  });

  it("calculates scroll size from grid dimensions", () => {
    expect(
      webGlResultGridScrollSize({
        columnCount: 4,
        columnWidth: 148,
        headerHeight: 27,
        rowCount: 10,
        rowHeight: 27,
      }),
    ).toEqual({ width: 592, height: 297 });
  });

  it("parses common CSS colors into normalized WebGL channels", () => {
    expect(parseWebGlColor("#fff")).toEqual([1, 1, 1, 1]);
    expect(parseWebGlColor("#00000080")).toEqual([0, 0, 0, 128 / 255]);
    expect(parseWebGlColor("rgba(255, 128, 0, 0.5)")).toEqual([
      1,
      128 / 255,
      0,
      0.5,
    ]);
    expect(parseWebGlColor("color-mix(...)")).toEqual([0, 0, 0, 1]);
  });
});
