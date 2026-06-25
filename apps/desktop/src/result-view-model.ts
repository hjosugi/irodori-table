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

type DisplayCell = {
  text: string;
  edited: boolean;
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

export function formatResultGridDraftCell(value: ResultGridDraftCell): string {
  return value === null ? "NULL" : value;
}

export function resultGridRowKey(origin: ResultGridRowOrigin): string {
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
>): ResultGridDisplayRow[] {
  return [
    ...buildOriginalDisplayRows(rows, cellEdits, deletedRows),
    ...newRows.map(buildNewDisplayRow),
  ];
}

function buildOriginalDisplayRows(
  rows: readonly (readonly unknown[])[],
  cellEdits: ReadonlyMap<string, ResultGridDraftCell>,
  deletedRows: ReadonlySet<number>,
): ResultGridDisplayRow[] {
  return rows.flatMap((row, index) =>
    deletedRows.has(index) ? [] : [buildOriginalDisplayRow(row, index, cellEdits)],
  );
}

function buildOriginalDisplayRow(
  row: readonly unknown[],
  index: number,
  cellEdits: ReadonlyMap<string, ResultGridDraftCell>,
): ResultGridDisplayRow {
  const origin: ResultGridRowOrigin = { kind: "orig", index };
  const displayCells = row.map((cell, columnIndex) =>
    displayOriginalCell(cell, index, columnIndex, cellEdits),
  );
  return {
    key: resultGridRowKey(origin),
    origin,
    cells: displayCells.map((cell) => cell.text),
    state: displayCells.some((cell) => cell.edited) ? "edited" : "clean",
  };
}

function displayOriginalCell(
  cell: unknown,
  rowIndex: number,
  columnIndex: number,
  cellEdits: ReadonlyMap<string, ResultGridDraftCell>,
): DisplayCell {
  const edit = cellEdits.get(originalCellEditKey(rowIndex, columnIndex));
  return edit === undefined
    ? { text: formatResultGridCell(cell), edited: false }
    : { text: formatResultGridDraftCell(edit), edited: true };
}

function buildNewDisplayRow(
  cells: readonly ResultGridDraftCell[],
  index: number,
): ResultGridDisplayRow {
  const origin: ResultGridRowOrigin = { kind: "new", index };
  return {
    key: resultGridRowKey(origin),
    origin,
    cells: cells.map(formatResultGridDraftCell),
    state: "new",
  };
}

function originalCellEditKey(rowIndex: number, columnIndex: number): string {
  return `o${rowIndex}:${columnIndex}`;
}

export function buildSortRulePriorityMap(
  sortRules: readonly ResultSortRule[],
): ReadonlyMap<number, ResultGridSortRuleView> {
  return new Map<number, ResultGridSortRuleView>(
    sortRules.map((rule, index): [number, ResultGridSortRuleView] => [
      rule.columnIndex,
      { ...rule, priority: index + 1 },
    ]),
  );
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
