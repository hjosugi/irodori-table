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

// Sort comparator for grid cells: numeric when both sides parse as finite
// numbers, otherwise a locale-aware string compare. "NULL" sorts first.
export function compareGridCells(a: string, b: string) {
  if (a === b) {
    return 0;
  }
  if (a === "NULL") {
    return -1;
  }
  if (b === "NULL") {
    return 1;
  }
  const left = Number(a);
  const right = Number(b);
  if (
    a.trim() !== "" &&
    b.trim() !== "" &&
    Number.isFinite(left) &&
    Number.isFinite(right)
  ) {
    return left - right;
  }
  return a.localeCompare(b);
}

export function applyResultSort<T extends ResultGridRowLike>(
  rows: readonly T[],
  sortRules: readonly ResultSortRule[],
) {
  if (sortRules.length === 0) {
    return [...rows];
  }
  return [...rows].sort((left, right) => {
    for (const rule of sortRules) {
      const comparison =
        compareGridCells(
          left.cells[rule.columnIndex] ?? "",
          right.cells[rule.columnIndex] ?? "",
        ) * (rule.direction === "asc" ? 1 : -1);
      if (comparison !== 0) {
        return comparison;
      }
    }
    return 0;
  });
}

export function cycleResultSortRules(
  current: readonly ResultSortRule[],
  columnIndex: number,
  additive: boolean,
) {
  const existing = current.find((rule) => rule.columnIndex === columnIndex);
  const nextDirection: ResultSortDirection | null =
    existing?.direction === "asc" ? "desc" : existing?.direction === "desc" ? null : "asc";

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

export function applyResultFilters<T extends ResultGridRowLike>(
  rows: readonly T[],
  filters: readonly ResultFilterRule[],
  quickFilter: string,
  join: ResultFilterJoin,
) {
  const quick = normalize(quickFilter);
  const activeFilters = activeResultFilters(filters);
  if (!quick && activeFilters.length === 0) {
    return [...rows];
  }
  return rows.filter((row) => {
    if (quick && !row.cells.some((cell) => normalize(cell).includes(quick))) {
      return false;
    }
    if (activeFilters.length === 0) {
      return true;
    }
    const matches = activeFilters.map((rule) => resultFilterMatches(row, rule));
    return join === "and"
      ? matches.every(Boolean)
      : matches.some(Boolean);
  });
}

export function resultFilterMatches(
  row: ResultGridRowLike,
  rule: ResultFilterRule,
) {
  const cells =
    rule.columnIndex === "any"
      ? row.cells
      : [row.cells[rule.columnIndex] ?? ""];
  return cells.some((cell) => cellMatches(cell, rule.operator, rule.value));
}

function cellMatches(
  cell: string,
  operator: ResultFilterOperator,
  filterValue: string,
) {
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
      try {
        return new RegExp(filterValue, "i").test(cell);
      } catch {
        return false;
      }
  }
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}
