import type { JsonCell, QueryResult, QueryResultSet } from "../types";

type SqlJsExecResult = {
  columns: string[];
  values: unknown[][];
};

export function normalizeCell(value: unknown): JsonCell {
  if (value == null) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return JSON.stringify(value);
}

function toResultSet(result: SqlJsExecResult, maxRows: number): QueryResultSet {
  const rows = result.values.slice(0, maxRows).map((row) => row.map(normalizeCell));
  return {
    columns: result.columns,
    rows,
    rowCount: result.values.length,
    truncated: result.values.length > rows.length,
  };
}

export function resultFromSqlJsExec(
  execResults: SqlJsExecResult[],
  maxRows: number,
  rowsModified: number,
  elapsedMs: number,
): QueryResult {
  if (execResults.length === 0) {
    return {
      columns: [],
      rows: [],
      rowCount: rowsModified,
      elapsedMs,
      truncated: false,
      message:
        rowsModified === 1
          ? "1 row changed"
          : `${rowsModified.toLocaleString()} rows changed`,
    };
  }

  const resultSets = execResults.map((result) => toResultSet(result, maxRows));
  const last = resultSets[resultSets.length - 1];
  return {
    ...last,
    elapsedMs,
    resultSets: resultSets.length > 1 ? resultSets : undefined,
  };
}

export function emptyQueryResult(message: string, elapsedMs = 0): QueryResult {
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    elapsedMs,
    truncated: false,
    message,
  };
}
