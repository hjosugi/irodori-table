import { describe, expect, it } from "vitest";
import {
  buildResultGridViewModel,
  formatResultGridCell,
  resultGridRowKey,
} from "./result-view-model";

describe("result grid view model", () => {
  it("overlays staged edits, skips deleted original rows, and appends new rows", () => {
    const model = buildResultGridViewModel({
      rows: [
        [1, "Kawase", null],
        [2, "Aster", "done"],
      ],
      cellEdits: new Map([
        ["o0:1", "Kawase Foods"],
        ["o0:2", null],
      ]),
      newRows: [["3", null, "draft"]],
      deletedRows: new Set([1]),
      filterRules: [],
      quickFilter: "",
      filterJoin: "and",
      sortRules: [],
    });

    expect(model.unfilteredRows).toEqual([
      {
        key: "o0",
        origin: { kind: "orig", index: 0 },
        cells: ["1", "Kawase Foods", "NULL"],
        state: "edited",
      },
      {
        key: "n0",
        origin: { kind: "new", index: 0 },
        cells: ["3", "NULL", "draft"],
        state: "new",
      },
    ]);
    expect(model.displayRows.map((row) => row.key)).toEqual(["o0", "n0"]);
    expect(model.pendingCount).toBe(4);
  });

  it("returns filter, sort, and count data for the result grid UI", () => {
    const model = buildResultGridViewModel({
      rows: [
        [1, "Aster", "5", "Tokyo"],
        [2, "Kawase", "20", "Tokyo"],
        [3, "Minato", "30", "Osaka"],
      ],
      cellEdits: new Map(),
      newRows: [],
      deletedRows: new Set(),
      filterRules: [
        {
          id: "amount",
          columnIndex: 2,
          operator: "gte",
          value: "10",
          enabled: true,
        },
      ],
      quickFilter: "tokyo",
      filterJoin: "and",
      sortRules: [{ columnIndex: 1, direction: "desc" }],
    });

    expect(model.filtersActive).toBe(true);
    expect(model.activeFilters.map((rule) => rule.id)).toEqual(["amount"]);
    expect(model.filteredOutCount).toBe(2);
    expect(model.displayRows.map((row) => row.key)).toEqual(["o1"]);
    expect(model.sortRuleByColumn.get(1)).toEqual({
      columnIndex: 1,
      direction: "desc",
      priority: 1,
    });
  });

  it("formats object cells and row keys consistently", () => {
    expect(formatResultGridCell({ status: "ok" })).toBe('{"status":"ok"}');
    expect(resultGridRowKey({ kind: "new", index: 2 })).toBe("n2");
  });
});
