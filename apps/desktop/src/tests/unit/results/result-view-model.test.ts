import { describe, expect, it } from "vitest";
import {
  buildResultGridViewModel,
  formatResultGridCell,
  resultGridRowKey,
} from "@/features/results/result-view-model";

describe("result grid view model", () => {
  function syntheticRows(rowCount: number, columnCount = 2) {
    let reads = 0;
    const rowFor = (rowIndex: number) =>
      Array.from({ length: columnCount }, (_, columnIndex) =>
        columnIndex === 0 ? rowIndex : `col_${columnIndex}_${rowIndex}`,
      );
    const rows = new Proxy([], {
      get(target, prop, receiver) {
        if (prop === "length") {
          return rowCount;
        }
        if (typeof prop === "string" && /^\d+$/.test(prop)) {
          reads += 1;
          return rowFor(Number(prop));
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as readonly (readonly unknown[])[];
    return { rows, reads: () => reads };
  }

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

  it("counts off-grid staged edits without marking visible cells edited", () => {
    const model = buildResultGridViewModel({
      rows: [[1]],
      cellEdits: new Map([["o0:3", "ignored"]]),
      newRows: [],
      deletedRows: new Set(),
      filterRules: [],
      quickFilter: "",
      filterJoin: "and",
      sortRules: [],
    });

    expect(model.unfilteredRows).toEqual([
      {
        key: "o0",
        origin: { kind: "orig", index: 0 },
        cells: ["1"],
        state: "clean",
      },
    ]);
    expect(model.pendingCount).toBe(1);
  });

  it("uses a windowed model for large unsorted results", () => {
    const rows = Array.from({ length: 20 }, (_, index) => [index, `row_${index}`]);
    const model = buildResultGridViewModel(
      {
        rows,
        cellEdits: new Map([["o12:1", "edited"]]),
        newRows: [["new", "row"]],
        deletedRows: new Set([3, 10]),
        filterRules: [],
        quickFilter: "",
        filterJoin: "and",
        sortRules: [],
      },
      { windowedRowThreshold: 10 },
    );

    expect(model.windowed).toBe(true);
    expect(model.displayRows).toEqual([]);
    expect(model.totalRowCount).toBe(19);
    expect(model.displayIndexForKey("o12")).toBe(10);
    expect(model.displayIndexForKey("o10")).toBe(-1);
    expect(model.rowAt(2)?.cells).toEqual(["2", "row_2"]);
    expect(model.rowAt(3)?.cells).toEqual(["4", "row_4"]);
    expect(model.rowsInRange(9, 12).map((row) => row.key)).toEqual([
      "o11",
      "o12",
      "o13",
    ]);
    expect(model.rowAt(10)).toMatchObject({
      key: "o12",
      cells: ["12", "edited"],
      state: "edited",
    });
    expect(model.rowAt(18)).toMatchObject({
      key: "n0",
      cells: ["new", "row"],
      state: "new",
    });
  });

  it("keeps filtered or sorted results materialized for correctness", () => {
    const model = buildResultGridViewModel(
      {
        rows: [
          [1, "Aster"],
          [2, "Kawase"],
        ],
        cellEdits: new Map(),
        newRows: [],
        deletedRows: new Set(),
        filterRules: [],
        quickFilter: "",
        filterJoin: "and",
        sortRules: [{ columnIndex: 1, direction: "desc" }],
      },
      { windowedRowThreshold: 1 },
    );

    expect(model.windowed).toBe(false);
    expect(model.displayRows.map((row) => row.key)).toEqual(["o1", "o0"]);
    expect(model.rowsInRange(0, 1).map((row) => row.key)).toEqual(["o1"]);
  });

  it("uses a windowed model for wide results even when row count is moderate", () => {
    const source = syntheticRows(1_000, 2_000);
    const model = buildResultGridViewModel(
      {
        rows: source.rows,
        cellEdits: new Map(),
        newRows: [],
        deletedRows: new Set(),
        filterRules: [],
        quickFilter: "",
        filterJoin: "and",
        sortRules: [],
      },
      { windowedRowThreshold: 50_000, windowedCellThreshold: 250_000 },
    );

    expect(model.windowed).toBe(true);
    expect(model.totalRowCount).toBe(1_000);
    expect(model.rowsInRange(500, 501)[0].cells[0]).toBe("500");
    expect(source.reads()).toBeLessThanOrEqual(2);
  });

  it("benchmarks a 1M-row synthetic window without materializing every row", () => {
    const source = syntheticRows(1_000_000);
    const started = performance.now();
    const model = buildResultGridViewModel(
      {
        rows: source.rows,
        cellEdits: new Map(),
        newRows: [],
        deletedRows: new Set(),
        filterRules: [],
        quickFilter: "",
        filterJoin: "and",
        sortRules: [],
      },
      { windowedRowThreshold: 50_000 },
    );
    const rows = model.rowsInRange(750_000, 750_040);
    const elapsedMs = performance.now() - started;

    expect(model.windowed).toBe(true);
    expect(model.totalRowCount).toBe(1_000_000);
    expect(rows).toHaveLength(40);
    expect(rows[0]).toMatchObject({
      key: "o750000",
      cells: ["750000", "col_1_750000"],
    });
    expect(source.reads()).toBeLessThanOrEqual(41);
    expect(elapsedMs).toBeLessThan(100);
  });

  it("formats object cells and row keys consistently", () => {
    expect(formatResultGridCell({ status: "ok" })).toBe('{"status":"ok"}');
    expect(resultGridRowKey({ kind: "new", index: 2 })).toBe("n2");
  });
});
