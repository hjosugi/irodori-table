import type { DbEngine } from "@/generated/irodori-api";
import type { ResultEditTarget } from "./result-edit-target";
import { quoteIdent } from "./row-detail";

export type BuildSelectedRowChangeSqlInput = {
  engine: DbEngine;
  target: ResultEditTarget;
  columns: readonly string[];
  row: readonly unknown[];
};

export function buildSelectedRowChangeSql({
  engine,
  target,
  columns,
  row,
}: BuildSelectedRowChangeSqlInput) {
  const keyLookup = new Set(
    target.keyColumns.map((column) => column.toLowerCase()),
  );
  const setLines = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !keyLookup.has(column.toLowerCase()))
    .map(
      ({ column, index }) =>
        `  ${quoteIdent(column, engine)} = ${sqlLiteralForResultValue(row[index])}`,
    );
  const whereLines = target.keyColumns.map((column) => {
    const value = row[resultColumnIndex(columns, column)];
    const quoted = quoteIdent(column, engine);
    return value === null || value === undefined
      ? `  ${quoted} IS NULL`
      : `  ${quoted} = ${sqlLiteralForResultValue(value)}`;
  });
  const begin = engine === "sqlserver" ? "BEGIN TRANSACTION;" : "BEGIN;";
  return [
    "-- Generated from the selected result row. Review before running.",
    "-- Edit the SET values, then run this transaction.",
    begin,
    `UPDATE ${qualifiedTargetName(target, engine)}`,
    "SET",
    setLines.length > 0
      ? setLines.join(",\n")
      : "  -- TODO: add columns to update",
    "WHERE",
    whereLines.join("\n  AND "),
    ";",
    "COMMIT;",
  ].join("\n");
}

export function sqlLiteralForResultValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  const text =
    typeof value === "object"
      ? JSON.stringify(jsonSafeSqlValue(value))
      : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

function qualifiedTargetName(target: ResultEditTarget, engine: DbEngine) {
  return target.schema
    ? `${quoteIdent(target.schema, engine)}.${quoteIdent(target.table, engine)}`
    : quoteIdent(target.table, engine);
}

function resultColumnIndex(columns: readonly string[], column: string) {
  return columns.findIndex(
    (candidate) => candidate.toLowerCase() === column.toLowerCase(),
  );
}

function jsonSafeSqlValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafeSqlValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        jsonSafeSqlValue(nested),
      ]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
