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

export type ResultGridViewModelOptions = {
  /**
   * Above this row count, an unfiltered/unsorted result uses the lazy row window
   * path. The default keeps existing callers materialized unless they opt in.
   */
  windowedRowThreshold?: number;
  /**
   * Wide-but-not-tall results can still be expensive to format eagerly. When
   * rows * estimated columns crosses this threshold, use the same lazy path.
   */
  windowedCellThreshold?: number;
};

export type ResultGridViewModel = {
  unfilteredRows: ResultGridDisplayRow[];
  filteredRows: ResultGridDisplayRow[];
  displayRows: ResultGridDisplayRow[];
  unfilteredRowCount: number;
  filteredRowCount: number;
  totalRowCount: number;
  activeFilters: ResultFilterRule[];
  filtersActive: boolean;
  filteredOutCount: number;
  pendingCount: number;
  windowed: boolean;
  rowAt: (displayIndex: number) => ResultGridDisplayRow | null;
  rowsInRange: (firstDisplayIndex: number, lastDisplayIndex: number) => ResultGridDisplayRow[];
  displayIndexForKey: (key: string) => number;
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

function buildOriginalDisplayRowsInRange(
  rows: readonly (readonly unknown[])[],
  cellEdits: ReadonlyMap<string, ResultGridDraftCell>,
  deletedRows: ReadonlySet<number>,
  firstDisplayIndex: number,
  lastDisplayIndex: number,
): ResultGridDisplayRow[] {
  const start = floorAtZero(firstDisplayIndex);
  const end = floorAtZero(lastDisplayIndex);
  if (end <= start) {
    return [];
  }
  const out: ResultGridDisplayRow[] = [];
  for (let displayIndex = start; displayIndex < end; displayIndex += 1) {
    const row = originalDisplayRowAt(rows, cellEdits, deletedRows, displayIndex);
    if (!row) {
      break;
    }
    out.push(row);
  }
  return out;
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

function originalDisplayRowAt(
  rows: readonly (readonly unknown[])[],
  cellEdits: ReadonlyMap<string, ResultGridDraftCell>,
  deletedRows: ReadonlySet<number>,
  displayIndex: number,
): ResultGridDisplayRow | null {
  const originalIndex = originalIndexForDisplayIndex(
    displayIndex,
    rows.length,
    deletedRows,
  );
  const row = rows[originalIndex];
  return row ? buildOriginalDisplayRow(row, originalIndex, cellEdits) : null;
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

function canUseWindowedViewModel(
  input: ResultGridViewModelInput,
  activeFilters: readonly ResultFilterRule[],
  rowThreshold: number,
  cellThreshold: number,
): boolean {
  const firstRowWidth = input.rows[0]?.length ?? input.newRows[0]?.length ?? 0;
  const estimatedCellCount = (input.rows.length + input.newRows.length) * firstRowWidth;
  return (
    (input.rows.length > rowThreshold || estimatedCellCount > cellThreshold) &&
    input.quickFilter.trim().length === 0 &&
    activeFilters.length === 0 &&
    input.sortRules.length === 0
  );
}

function buildWindowedResultGridViewModel(
  input: ResultGridViewModelInput,
  activeFilters: ResultFilterRule[],
): ResultGridViewModel {
  const sortedDeletedRows = sortedDeletedRowIndexes(input.deletedRows, input.rows.length);
  const originalRowCount = input.rows.length - sortedDeletedRows.length;
  const totalRowCount = originalRowCount + input.newRows.length;
  const rowAt = (displayIndex: number): ResultGridDisplayRow | null => {
    const index = Math.floor(displayIndex);
    if (!Number.isFinite(index) || index < 0 || index >= totalRowCount) {
      return null;
    }
    if (index < originalRowCount) {
      return originalDisplayRowAt(
        input.rows,
        input.cellEdits,
        input.deletedRows,
        index,
      );
    }
    const newIndex = index - originalRowCount;
    const row = input.newRows[newIndex];
    return row ? buildNewDisplayRow(row, newIndex) : null;
  };
  const rowsInRange = (
    firstDisplayIndex: number,
    lastDisplayIndex: number,
  ): ResultGridDisplayRow[] => {
    const first = clampIndex(firstDisplayIndex, 0, totalRowCount);
    const last = clampIndex(lastDisplayIndex, first, totalRowCount);
    if (last <= first) {
      return [];
    }
    const rows: ResultGridDisplayRow[] = [];
    if (first < originalRowCount) {
      rows.push(
        ...buildOriginalDisplayRowsInRange(
          input.rows,
          input.cellEdits,
          input.deletedRows,
          first,
          Math.min(last, originalRowCount),
        ),
      );
    }
    if (last > originalRowCount) {
      const newStart = Math.max(0, first - originalRowCount);
      const newEnd = Math.min(input.newRows.length, last - originalRowCount);
      for (let index = newStart; index < newEnd; index += 1) {
        rows.push(buildNewDisplayRow(input.newRows[index], index));
      }
    }
    return rows;
  };

  return {
    unfilteredRows: [],
    filteredRows: [],
    displayRows: [],
    unfilteredRowCount: totalRowCount,
    filteredRowCount: totalRowCount,
    totalRowCount,
    activeFilters,
    filtersActive: false,
    filteredOutCount: 0,
    pendingCount:
      input.cellEdits.size + input.newRows.length + input.deletedRows.size,
    windowed: true,
    rowAt,
    rowsInRange,
    displayIndexForKey: (key) =>
      displayIndexForRowKey(key, input.rows.length, sortedDeletedRows, originalRowCount),
    sortRuleByColumn: buildSortRulePriorityMap(input.sortRules),
  };
}

export function buildResultGridViewModel(
  input: ResultGridViewModelInput,
  options: ResultGridViewModelOptions = {},
): ResultGridViewModel {
  const activeFilters = activeResultFilters(input.filterRules);
  if (
    canUseWindowedViewModel(
      input,
      activeFilters,
      options.windowedRowThreshold ?? Number.POSITIVE_INFINITY,
      options.windowedCellThreshold ?? Number.POSITIVE_INFINITY,
    )
  ) {
    return buildWindowedResultGridViewModel(input, activeFilters);
  }

  const unfilteredRows = buildResultGridRows(input);
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
    unfilteredRowCount: unfilteredRows.length,
    filteredRowCount: filteredRows.length,
    totalRowCount: displayRows.length,
    activeFilters,
    filtersActive,
    filteredOutCount: unfilteredRows.length - filteredRows.length,
    pendingCount:
      input.cellEdits.size + input.newRows.length + input.deletedRows.size,
    windowed: false,
    rowAt: (displayIndex) => displayRows[Math.floor(displayIndex)] ?? null,
    rowsInRange: (firstDisplayIndex, lastDisplayIndex) =>
      displayRows.slice(
        clampIndex(firstDisplayIndex, 0, displayRows.length),
        clampIndex(lastDisplayIndex, 0, displayRows.length),
      ),
    displayIndexForKey: (key) => displayRows.findIndex((row) => row.key === key),
    sortRuleByColumn: buildSortRulePriorityMap(input.sortRules),
  };
}

function displayIndexForRowKey(
  key: string,
  originalRowCount: number,
  sortedDeletedRows: readonly number[],
  originalDisplayRowCount: number,
): number {
  const match = key.match(/^([on])(\d+)$/);
  if (!match) {
    return -1;
  }
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index) || index < 0) {
    return -1;
  }
  if (match[1] === "n") {
    return originalDisplayRowCount + index;
  }
  if (index >= originalRowCount || deletedRowIndexHas(sortedDeletedRows, index)) {
    return -1;
  }
  return index - countDeletedBefore(sortedDeletedRows, index);
}

function originalIndexForDisplayIndex(
  displayIndex: number,
  originalRowCount: number,
  deletedRows: ReadonlySet<number>,
): number {
  if (deletedRows.size === 0) {
    return displayIndex;
  }
  let originalIndex = displayIndex;
  while (originalIndex < originalRowCount) {
    const deletedBeforeOrAt = countDeletedBeforeOrAt(deletedRows, originalIndex);
    const next = displayIndex + deletedBeforeOrAt;
    if (next === originalIndex && !deletedRows.has(originalIndex)) {
      return originalIndex;
    }
    originalIndex = next + (deletedRows.has(next) ? 1 : 0);
  }
  return originalRowCount;
}

function sortedDeletedRowIndexes(
  deletedRows: ReadonlySet<number>,
  originalRowCount: number,
): number[] {
  return [...deletedRows]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < originalRowCount)
    .sort((left, right) => left - right);
}

function deletedRowIndexHas(sortedDeletedRows: readonly number[], index: number) {
  return sortedDeletedRows.includes(index);
}

function countDeletedBefore(sortedDeletedRows: readonly number[], index: number) {
  return sortedDeletedRows.filter((deleted) => deleted < index).length;
}

function countDeletedBeforeOrAt(
  deletedRows: ReadonlySet<number>,
  index: number,
): number {
  let count = 0;
  for (const deleted of deletedRows) {
    if (deleted <= index) {
      count += 1;
    }
  }
  return count;
}

function floorAtZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function clampIndex(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}
