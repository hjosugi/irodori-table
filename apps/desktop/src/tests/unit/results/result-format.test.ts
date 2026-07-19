import { describe, expect, it } from "vitest";
import {
  formatResultSelectionStatus,
  historySnapshotToQueryResult,
  toCount,
} from "@/features/results/result-format";
import type { QueryHistoryResultSnapshot } from "@/features/query-history";

describe("result formatting helpers", () => {
  it("formats aggregate selection status", () => {
    expect(
      formatResultSelectionStatus({
        cellCount: 4,
        rowCount: 2,
        columnCount: 2,
        numericCount: 2,
        textCount: 1,
        nullCount: 1,
        sum: 30,
        average: 15,
        min: 10,
        max: 20,
        sampledCellCount: 4,
        truncated: false,
      }),
    ).toBe("4 cells · 2x2 · sum 30 · avg 15 · min 10 · max 20 · null 1");
  });

  it("formats numbers in the requested app locale, not the OS locale", () => {
    // de-DE groups with dots, so the assertion can only pass when the locale
    // argument actually reaches toLocaleString (the OS/test locale is en).
    expect(toCount(1234567, "de-DE")).toBe("1.234.567");
    expect(
      formatResultSelectionStatus(
        {
          cellCount: 1234,
          rowCount: 1234,
          columnCount: 1,
          numericCount: 0,
          textCount: 0,
          nullCount: 0,
          sum: null,
          average: null,
          min: null,
          max: null,
          sampledCellCount: 1234,
          truncated: false,
        },
        "de-DE",
      ),
    ).toContain("1.234 cells");
  });

  it("restores a retained history result snapshot", () => {
    const snapshot: QueryHistoryResultSnapshot = {
      columns: ["id"],
      rows: [[1]],
      rowCount: 3,
      retainedRows: 1,
      elapsedMs: 12,
      truncated: false,
      retentionTruncated: true,
    };

    expect(historySnapshotToQueryResult(snapshot)).toEqual({
      columns: ["id"],
      rows: [[1]],
      rowCount: 1n,
      elapsedMs: 12n,
      truncated: true,
      message: "history preview retained 1 of 3 rows",
      resultSets: undefined,
    });
  });
});
