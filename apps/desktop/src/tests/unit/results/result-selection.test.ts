import { describe, expect, it } from "vitest";
import { buildResultGridViewModel } from "@/result-view-model";
import {
  normalizeResultCellRange,
  readResultCellRangeRows,
  resultCellInRange,
  summarizeResultCellRange,
} from "@/features/results/result-selection";

const view = buildResultGridViewModel({
  rows: [
    [1, "10", null, "alpha"],
    [2, "20.5", "3,000", "beta"],
    [3, "-5", "not numeric", ""],
  ],
  cellEdits: new Map(),
  newRows: [],
  deletedRows: new Set(),
  filterRules: [],
  quickFilter: "",
  filterJoin: "and",
  sortRules: [],
});

describe("result grid selection", () => {
  it("normalizes a rectangular cell range from either direction", () => {
    const bounds = normalizeResultCellRange(view, {
      anchor: { key: "o2", col: 3 },
      focus: { key: "o0", col: 1 },
    });

    expect(bounds).toEqual({
      rowStart: 0,
      rowEnd: 2,
      colStart: 1,
      colEnd: 3,
      rowCount: 3,
      columnCount: 3,
      cellCount: 9,
    });
    expect(resultCellInRange(1, 2, bounds)).toBe(true);
    expect(resultCellInRange(1, 0, bounds)).toBe(false);
  });

  it("summarizes numeric, null, and text cells in the selected range", () => {
    const bounds = normalizeResultCellRange(view, {
      anchor: { key: "o0", col: 1 },
      focus: { key: "o2", col: 2 },
    });
    const summary = summarizeResultCellRange(view, bounds);

    expect(summary).toMatchObject({
      cellCount: 6,
      rowCount: 3,
      columnCount: 2,
      numericCount: 4,
      nullCount: 1,
      textCount: 1,
      sum: 3025.5,
      average: 756.375,
      min: -5,
      max: 3000,
      truncated: false,
    });
  });

  it("caps large summaries without changing the selected cell count", () => {
    const bounds = normalizeResultCellRange(view, {
      anchor: { key: "o0", col: 0 },
      focus: { key: "o2", col: 3 },
    });
    const summary = summarizeResultCellRange(view, bounds, 4);

    expect(summary?.cellCount).toBe(12);
    expect(summary?.sampledCellCount).toBe(4);
    expect(summary?.truncated).toBe(true);
  });

  it("reads selected rows for rectangular TSV copy", () => {
    const bounds = normalizeResultCellRange(view, {
      anchor: { key: "o1", col: 1 },
      focus: { key: "o2", col: 2 },
    });

    expect(bounds ? readResultCellRangeRows(view, bounds) : []).toEqual([
      ["20.5", "3,000"],
      ["-5", "not numeric"],
    ]);
  });
});
