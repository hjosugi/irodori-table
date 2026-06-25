export type ResultSortDirection = "asc" | "desc";

export type ResultSortRule = {
  columnIndex: number;
  direction: ResultSortDirection;
};

export type ResultFilterJoin = "and" | "or";

export type ResultFilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_null"
  | "is_not_null"
  | "is_empty"
  | "is_not_empty"
  | "regex";

export type ResultFilterRule = {
  id: string;
  columnIndex: number | "any";
  operator: ResultFilterOperator;
  value: string;
  enabled: boolean;
};

export type ResultGridRowLike = {
  cells: readonly string[];
};

export type ResultGridVirtualRowWindowInput = {
  rowCount: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan: number;
};

export type ResultGridVirtualRowWindow = {
  firstRowIndex: number;
  lastRowIndex: number;
  renderedRowCount: number;
  maxRenderedRowCount: number;
  topPadPx: number;
  bottomPadPx: number;
};

export const resultFilterOperators: Array<{
  value: ResultFilterOperator;
  label: string;
}> = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "equals", label: "=" },
  { value: "not_equals", label: "!=" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "is_null", label: "is NULL" },
  { value: "is_not_null", label: "is not NULL" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
  { value: "regex", label: "regex" },
];

const valuelessOperators = new Set<ResultFilterOperator>([
  "is_null",
  "is_not_null",
  "is_empty",
  "is_not_empty",
]);

export function resultFilterNeedsValue(operator: ResultFilterOperator) {
  return !valuelessOperators.has(operator);
}

export function isResultFilterRuleActive(rule: ResultFilterRule) {
  return (
    rule.enabled &&
    (!resultFilterNeedsValue(rule.operator) || rule.value.trim().length > 0)
  );
}

export function activeResultFilters(filters: readonly ResultFilterRule[]) {
  return filters.filter(isResultFilterRuleActive);
}

export function calculateResultGridVirtualRowWindow({
  rowCount,
  scrollTop,
  viewportHeight,
  rowHeight,
  overscan,
}: ResultGridVirtualRowWindowInput): ResultGridVirtualRowWindow {
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
    throw new Error("rowHeight must be a positive finite number");
  }
  const boundedRowCount = floorAtZero(rowCount);
  const boundedScrollTop = atLeastZero(scrollTop);
  const boundedViewportHeight = atLeastZero(viewportHeight);
  const boundedOverscan = floorAtZero(overscan);
  const firstRowIndex = firstVisibleRowIndex(
    boundedRowCount,
    boundedScrollTop,
    rowHeight,
    boundedOverscan,
  );
  const maxRenderedRowCount =
    Math.ceil(boundedViewportHeight / rowHeight) + boundedOverscan * 2;
  const lastRowIndex = Math.min(
    boundedRowCount,
    firstRowIndex + maxRenderedRowCount,
  );
  const renderedRowCount = Math.max(0, lastRowIndex - firstRowIndex);

  return {
    firstRowIndex,
    lastRowIndex,
    renderedRowCount,
    maxRenderedRowCount,
    topPadPx: firstRowIndex * rowHeight,
    bottomPadPx: Math.max(0, (boundedRowCount - lastRowIndex) * rowHeight),
  };
}

function floorAtZero(value: number): number {
  return Math.max(0, Math.floor(value));
}

function atLeastZero(value: number): number {
  return Math.max(0, value);
}

function firstVisibleRowIndex(
  rowCount: number,
  scrollTop: number,
  rowHeight: number,
  overscan: number,
): number {
  return Math.min(rowCount, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
}

// Sort comparator for grid cells: numeric when both sides parse as finite
// numbers, otherwise a locale-aware string compare. "NULL" sorts first.
export function compareGridCells(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a === "NULL") {
    return -1;
  }
  if (b === "NULL") {
    return 1;
  }
  const left = numericCellValue(a);
  const right = numericCellValue(b);
  if (left !== null && right !== null) {
    return left - right;
  }
  return a.localeCompare(b);
}

function numericCellValue(value: string): number | null {
  const numeric = Number(value);
  return value.trim() !== "" && Number.isFinite(numeric) ? numeric : null;
}

export function applyResultSort<T extends ResultGridRowLike>(
  rows: readonly T[],
  sortRules: readonly ResultSortRule[],
): T[] {
  if (sortRules.length === 0) {
    return [...rows];
  }
  return [...rows].sort((left, right) => compareGridRows(left, right, sortRules));
}

function compareGridRows(
  left: ResultGridRowLike,
  right: ResultGridRowLike,
  sortRules: readonly ResultSortRule[],
): number {
  return (
    sortRules
      .map((rule) => compareGridRowsByRule(left, right, rule))
      .find((comparison) => comparison !== 0) ?? 0
  );
}

function compareGridRowsByRule(
  left: ResultGridRowLike,
  right: ResultGridRowLike,
  rule: ResultSortRule,
): number {
  return (
    compareGridCells(
      left.cells[rule.columnIndex] ?? "",
      right.cells[rule.columnIndex] ?? "",
    ) * sortDirectionMultiplier(rule.direction)
  );
}

function sortDirectionMultiplier(direction: ResultSortDirection): 1 | -1 {
  return direction === "asc" ? 1 : -1;
}

export function cycleResultSortRules(
  current: readonly ResultSortRule[],
  columnIndex: number,
  additive: boolean,
): ResultSortRule[] {
  const existing = current.find((rule) => rule.columnIndex === columnIndex);
  const nextDirection = nextResultSortDirection(existing?.direction);

  if (!additive) {
    return nextDirection ? [{ columnIndex, direction: nextDirection }] : [];
  }

  if (!existing) {
    return [...current, { columnIndex, direction: "asc" as const }];
  }
  if (!nextDirection) {
    return current.filter((rule) => rule.columnIndex !== columnIndex);
  }
  return current.map((rule) =>
    rule.columnIndex === columnIndex
      ? { ...rule, direction: nextDirection }
      : rule,
  );
}

function nextResultSortDirection(
  current: ResultSortDirection | undefined,
): ResultSortDirection | null {
  if (current === "asc") {
    return "desc";
  }
  if (current === "desc") {
    return null;
  }
  return "asc";
}

export function applyResultFilters<T extends ResultGridRowLike>(
  rows: readonly T[],
  filters: readonly ResultFilterRule[],
  quickFilter: string,
  join: ResultFilterJoin,
): T[] {
  const quick = normalize(quickFilter);
  const activeFilters = activeResultFilters(filters);
  if (!quick && activeFilters.length === 0) {
    return [...rows];
  }
  return rows.filter(
    (row) =>
      rowMatchesQuickFilter(row, quick) &&
      rowMatchesActiveFilters(row, activeFilters, join),
  );
}

export function resultFilterMatches(
  row: ResultGridRowLike,
  rule: ResultFilterRule,
): boolean {
  return filterCells(row, rule).some((cell) =>
    cellMatches(cell, rule.operator, rule.value),
  );
}

function rowMatchesQuickFilter(row: ResultGridRowLike, quick: string): boolean {
  return !quick || row.cells.some((cell) => normalize(cell).includes(quick));
}

function rowMatchesActiveFilters(
  row: ResultGridRowLike,
  filters: readonly ResultFilterRule[],
  join: ResultFilterJoin,
): boolean {
  if (filters.length === 0) {
    return true;
  }
  const matches = (rule: ResultFilterRule) => resultFilterMatches(row, rule);
  return join === "and" ? filters.every(matches) : filters.some(matches);
}

function filterCells(row: ResultGridRowLike, rule: ResultFilterRule): readonly string[] {
  return rule.columnIndex === "any"
    ? row.cells
    : [row.cells[rule.columnIndex] ?? ""];
}

function cellMatches(
  cell: string,
  operator: ResultFilterOperator,
  filterValue: string,
): boolean {
  const text = normalize(cell);
  const value = normalize(filterValue);
  const isNull = cell === "NULL";
  const isEmpty = cell === "";

  switch (operator) {
    case "contains":
      return text.includes(value);
    case "not_contains":
      return !text.includes(value);
    case "equals":
      return text === value;
    case "not_equals":
      return text !== value;
    case "starts_with":
      return text.startsWith(value);
    case "ends_with":
      return text.endsWith(value);
    case "gt":
      return compareGridCells(cell, filterValue) > 0;
    case "gte":
      return compareGridCells(cell, filterValue) >= 0;
    case "lt":
      return compareGridCells(cell, filterValue) < 0;
    case "lte":
      return compareGridCells(cell, filterValue) <= 0;
    case "is_null":
      return isNull;
    case "is_not_null":
      return !isNull;
    case "is_empty":
      return isEmpty;
    case "is_not_empty":
      return !isEmpty;
    case "regex":
      return regexMatches(cell, filterValue);
  }
}

function regexMatches(cell: string, filterValue: string): boolean {
  try {
    return new RegExp(filterValue, "i").test(cell);
  } catch {
    return false;
  }
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}
