import { describe, expect, it } from "vitest";
import {
  formatResultSelectionStatus,
  historySnapshotToQueryResult,
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
