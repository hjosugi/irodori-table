import type {
  ResultGridDisplayRow,
  ResultGridViewModel,
} from "@/result-view-model";
import type { ResultCellRange, ResultCellRangeBounds } from "./types";

export const RESULT_SELECTION_SUMMARY_CELL_LIMIT = 100_000;

export type ResultSelectionSummary = {
  cellCount: number;
  sampledCellCount: number;
  rowCount: number;
  columnCount: number;
  numericCount: number;
  nullCount: number;
  textCount: number;
  sum: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
  truncated: boolean;
};

export function normalizeResultCellRange(
  view: Pick<ResultGridViewModel, "displayIndexForKey">,
  range: ResultCellRange,
): ResultCellRangeBounds {
  if (!range) {
    return null;
  }
  const anchorRow = view.displayIndexForKey(range.anchor.key);
  const focusRow = view.displayIndexForKey(range.focus.key);
  if (anchorRow < 0 || focusRow < 0) {
    return null;
  }
  const rowStart = Math.min(anchorRow, focusRow);
  const rowEnd = Math.max(anchorRow, focusRow);
  const colStart = Math.min(range.anchor.col, range.focus.col);
  const colEnd = Math.max(range.anchor.col, range.focus.col);
  const rowCount = rowEnd - rowStart + 1;
  const columnCount = colEnd - colStart + 1;
  return {
    rowStart,
    rowEnd,
    colStart,
    colEnd,
    rowCount,
    columnCount,
    cellCount: rowCount * columnCount,
  };
}

export function resultCellInRange(
  rowIndex: number,
  columnIndex: number,
  bounds: ResultCellRangeBounds,
): boolean {
  return Boolean(
    bounds &&
      rowIndex >= bounds.rowStart &&
      rowIndex <= bounds.rowEnd &&
      columnIndex >= bounds.colStart &&
      columnIndex <= bounds.colEnd,
  );
}

export function readResultCellRangeRows(
  view: Pick<ResultGridViewModel, "rowAt">,
  bounds: Exclude<ResultCellRangeBounds, null>,
): string[][] {
  const rows: string[][] = [];
  for (let rowIndex = bounds.rowStart; rowIndex <= bounds.rowEnd; rowIndex += 1) {
    const row = view.rowAt(rowIndex);
    if (!row) {
      continue;
    }
    rows.push(readCellsInBounds(row, bounds));
  }
  return rows;
}

export function summarizeResultCellRange(
  view: Pick<ResultGridViewModel, "rowAt">,
  bounds: ResultCellRangeBounds,
  limit = RESULT_SELECTION_SUMMARY_CELL_LIMIT,
): ResultSelectionSummary | null {
  if (!bounds) {
    return null;
  }
  const sampleLimit = Math.max(1, Math.floor(limit));
  let sampledCellCount = 0;
  let numericCount = 0;
  let nullCount = 0;
  let textCount = 0;
  let sum = 0;
  let min: number | null = null;
  let max: number | null = null;

  for (
    let rowIndex = bounds.rowStart;
    rowIndex <= bounds.rowEnd && sampledCellCount < sampleLimit;
    rowIndex += 1
  ) {
    const row = view.rowAt(rowIndex);
    if (!row) {
      continue;
    }
    for (
      let colIndex = bounds.colStart;
      colIndex <= bounds.colEnd && sampledCellCount < sampleLimit;
      colIndex += 1
    ) {
      sampledCellCount += 1;
      const value = row.cells[colIndex] ?? "";
      if (value === "NULL") {
        nullCount += 1;
        continue;
      }
      const numeric = parseSelectionNumber(value);
      if (numeric === null) {
        textCount += 1;
        continue;
      }
      numericCount += 1;
      sum += numeric;
      min = min === null ? numeric : Math.min(min, numeric);
      max = max === null ? numeric : Math.max(max, numeric);
    }
  }

  return {
    cellCount: bounds.cellCount,
    sampledCellCount,
    rowCount: bounds.rowCount,
    columnCount: bounds.columnCount,
    numericCount,
    nullCount,
    textCount,
    sum: numericCount > 0 ? sum : null,
    average: numericCount > 0 ? sum / numericCount : null,
    min,
    max,
    truncated: sampledCellCount < bounds.cellCount,
  };
}

function readCellsInBounds(
  row: ResultGridDisplayRow,
  bounds: Exclude<ResultCellRangeBounds, null>,
): string[] {
  const cells: string[] = [];
  for (let colIndex = bounds.colStart; colIndex <= bounds.colEnd; colIndex += 1) {
    cells.push(row.cells[colIndex] ?? "");
  }
  return cells;
}

function parseSelectionNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed.replace(/,/g, "");
  if (!/^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
    return null;
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}
