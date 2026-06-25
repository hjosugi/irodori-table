import {
  activeResultFilters,
  applyResultFilters,
  applyResultSort,
  type ResultFilterJoin,
  type ResultFilterRule,
  type ResultSortRule,
} from "./result-grid";

export type ResultGridDraftCell = string | null;

export type ResultGridRowOrigin =
  | { kind: "orig"; index: number }
  | { kind: "new"; index: number };

export type ResultGridDisplayRow = {
  key: string;
  origin: ResultGridRowOrigin;
  cells: string[];
  state: "clean" | "edited" | "new";
};

export type ResultGridSortRuleView = ResultSortRule & { priority: number };

export type ResultGridViewModelInput = {
  rows: readonly (readonly unknown[])[];
  cellEdits: ReadonlyMap<string, ResultGridDraftCell>;
  newRows: readonly (readonly ResultGridDraftCell[])[];
  deletedRows: ReadonlySet<number>;
  filterRules: readonly ResultFilterRule[];
  quickFilter: string;
  filterJoin: ResultFilterJoin;
  sortRules: readonly ResultSortRule[];
};

export type ResultGridViewModel = {
  unfilteredRows: ResultGridDisplayRow[];
  filteredRows: ResultGridDisplayRow[];
  displayRows: ResultGridDisplayRow[];
  activeFilters: ResultFilterRule[];
  filtersActive: boolean;
  filteredOutCount: number;
  pendingCount: number;
  sortRuleByColumn: ReadonlyMap<number, ResultGridSortRuleView>;
};

export function formatResultGridCell(value: unknown): string {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "object") {
    return JSON.stringify(value) ?? String(value);
  }
  return String(value);
}

export function formatResultGridDraftCell(value: ResultGridDraftCell) {
  return value === null ? "NULL" : value;
}

export function resultGridRowKey(origin: ResultGridRowOrigin) {
  return `${origin.kind === "orig" ? "o" : "n"}${origin.index}`;
}

export function buildResultGridRows({
  rows,
  cellEdits,
  newRows,
  deletedRows,
}: Pick<
  ResultGridViewModelInput,
  "rows" | "cellEdits" | "newRows" | "deletedRows"
>) {
  const displayRows: ResultGridDisplayRow[] = [];

  rows.forEach((row, index) => {
    if (deletedRows.has(index)) {
      return;
    }
    let state: "clean" | "edited" = "clean";
    const cells = row.map((cell, col) => {
      const edit = cellEdits.get(`o${index}:${col}`);
      if (edit !== undefined) {
        state = "edited";
        return formatResultGridDraftCell(edit);
      }
      return formatResultGridCell(cell);
    });
    displayRows.push({
      key: resultGridRowKey({ kind: "orig", index }),
      origin: { kind: "orig", index },
      cells,
      state,
    });
  });

  newRows.forEach((cells, index) => {
    displayRows.push({
      key: resultGridRowKey({ kind: "new", index }),
      origin: { kind: "new", index },
      cells: cells.map(formatResultGridDraftCell),
      state: "new",
    });
  });

  return displayRows;
}

export function buildSortRulePriorityMap(sortRules: readonly ResultSortRule[]) {
  const sortRuleByColumn = new Map<number, ResultGridSortRuleView>();
  sortRules.forEach((rule, index) => {
    sortRuleByColumn.set(rule.columnIndex, { ...rule, priority: index + 1 });
  });
  return sortRuleByColumn;
}

export function buildResultGridViewModel(
  input: ResultGridViewModelInput,
): ResultGridViewModel {
  const unfilteredRows = buildResultGridRows(input);
  const activeFilters = activeResultFilters(input.filterRules);
  const filtersActive =
    input.quickFilter.trim().length > 0 || activeFilters.length > 0;
  const filteredRows = applyResultFilters(
    unfilteredRows,
    input.filterRules,
    input.quickFilter,
    input.filterJoin,
  );
  const displayRows = applyResultSort(filteredRows, input.sortRules);

  return {
    unfilteredRows,
    filteredRows,
    displayRows,
    activeFilters,
    filtersActive,
    filteredOutCount: unfilteredRows.length - filteredRows.length,
    pendingCount:
      input.cellEdits.size + input.newRows.length + input.deletedRows.size,
    sortRuleByColumn: buildSortRulePriorityMap(input.sortRules),
  };
}
