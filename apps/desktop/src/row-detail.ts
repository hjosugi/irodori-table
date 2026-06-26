// Pure helpers for the row-detail sidebar and clickable foreign-key navigation.
// Kept free of React/Tauri so they can be unit-tested directly (see row-detail.test.ts).

import type {
  DatabaseMetadata,
  DbEngine,
  DbObjectMetadata,
  ForeignKey,
  QueryParameterInput,
} from "./generated/irodori-api";

export type DetailValue = {
  /** Display text for the value (JSON pretty-printed when applicable). */
  text: string;
  /** True when the value is a JSON object/array worth rendering in a code block. */
  json: boolean;
};

export type RowJsonObject = Record<string, unknown>;

export type JsonTreeNode = {
  key: string;
  path: string;
  type: string;
  preview: string;
  value: unknown;
  children: JsonTreeNode[];
};

export type SourceTableRef = { schema?: string; table: string };

type IdentifierQuoteStyle = {
  open: string;
  close: string;
  escapedClose: RegExp;
};

const identifierQuoteStyles: readonly IdentifierQuoteStyle[] = [
  { open: '"', close: '"', escapedClose: /""/g },
  { open: "`", close: "`", escapedClose: /``/g },
  { open: "[", close: "]", escapedClose: /\]\]/g },
];

const sourceTablePattern =
  /\bfrom\s+([`"[]?[\w$]+[`"\]]?)\s*(?:\.\s*([`"[]?[\w$]+[`"\]]?))?/i;

/** Format a raw cell value for the detail panel, pretty-printing JSON containers. */
export function formatDetailValue(value: unknown): DetailValue {
  if (value === null || value === undefined) {
    return { text: "NULL", json: false };
  }
  if (typeof value === "bigint") {
    return { text: value.toString(), json: false };
  }
  if (typeof value === "object") {
    return { text: JSON.stringify(toJsonSafeValue(value), null, 2), json: true };
  }
  return { text: String(value), json: false };
}

/** Convert result columns + values into a full-row JSON object without losing duplicates. */
export function rowToJsonObject(
  columns: readonly string[],
  values: readonly unknown[],
): RowJsonObject {
  const counts = new Map<string, number>();
  const used = new Set<string>();
  const row: RowJsonObject = {};
  columns.forEach((column, index) => {
    const base = column.length > 0 ? column : `column_${index + 1}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    let key = count === 1 ? base : `${base}_${count}`;
    while (used.has(key)) {
      const next = (counts.get(base) ?? count) + 1;
      counts.set(base, next);
      key = `${base}_${next}`;
    }
    used.add(key);
    row[key] = toJsonSafeValue(values[index]);
  });
  return row;
}

/** Pretty-print a complete selected row as JSON. */
export function formatRowAsJson(
  columns: readonly string[],
  values: readonly unknown[],
): string {
  return JSON.stringify(rowToJsonObject(columns, values), null, 2);
}

/** Make unknown DB values safe for JSON.stringify and the tree viewer. */
export function toJsonSafeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const array = value.map((item) => toJsonSafeValue(item, seen));
    seen.delete(value);
    return array;
  }
  if (value instanceof Map) {
    const object: RowJsonObject = {};
    for (const [key, mapValue] of value) {
      object[String(key)] = toJsonSafeValue(mapValue, seen);
    }
    seen.delete(value);
    return object;
  }
  if (value instanceof Set) {
    const array = [...value].map((item) => toJsonSafeValue(item, seen));
    seen.delete(value);
    return array;
  }
  const object: RowJsonObject = {};
  for (const [key, objectValue] of Object.entries(value as Record<string, unknown>)) {
    object[key] = toJsonSafeValue(objectValue, seen);
  }
  seen.delete(value);
  return object;
}

/** Build a browsable JSON tree from a row JSON value. */
export function buildJsonTree(value: unknown, key = "$", path = "$"): JsonTreeNode {
  const safeValue = toJsonSafeValue(value);
  return {
    key,
    path,
    type: jsonValueType(safeValue),
    preview: jsonPreview(safeValue),
    value: safeValue,
    children: jsonChildren(safeValue, path),
  };
}

function jsonChildren(value: unknown, path: string): JsonTreeNode[] {
  if (Array.isArray(value)) {
    return value.map((child, index) => buildJsonTree(child, String(index), `${path}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, child]) =>
      buildJsonTree(child, key, `${path}${jsonPathSegment(key)}`),
    );
  }
  return [];
}

function jsonPathSegment(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function jsonValueType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function jsonPreview(value: unknown): string {
  if (Array.isArray(value)) {
    return `${value.length} items`;
  }
  if (value !== null && typeof value === "object") {
    const count = Object.keys(value as Record<string, unknown>).length;
    return `${count} keys`;
  }
  if (typeof value === "string") {
    return truncate(JSON.stringify(value));
  }
  return String(value);
}

function truncate(value: string, max = 120): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function normalizeId(value: string): string {
  return value.toLowerCase();
}

/** Case-insensitive identifier comparison (most SQL engines fold unquoted names). */
function eqId(a: string, b: string): boolean {
  return normalizeId(a) === normalizeId(b);
}

function stripIdentQuotes(raw: string): string {
  const value = raw.trim();
  if (value.length < 2) {
    return value;
  }
  const quoteStyle = identifierQuoteStyles.find(
    ({ open, close }) => value.startsWith(open) && value.endsWith(close),
  );
  return quoteStyle
    ? value.slice(1, -1).replace(quoteStyle.escapedClose, quoteStyle.close)
    : value;
}

/**
 * Parse the first `FROM <schema.>?<table>` reference from a SQL statement.
 *
 * Intentionally simple: it handles the common single-table SELECT (the case where
 * FK navigation is meaningful) across quoting styles. For joins or expressions it may
 * return the first table or null; callers validate the result against live metadata and
 * fall back to column matching, so a wrong guess degrades gracefully.
 */
export function parseSourceTable(sql: string): SourceTableRef | null {
  const match = sourceTablePattern.exec(sql);
  if (!match) {
    return null;
  }
  const first = stripIdentQuotes(match[1]);
  if (match[2]) {
    return { schema: first, table: stripIdentQuotes(match[2]) };
  }
  return { table: first };
}

function allTables(metadata: DatabaseMetadata): DbObjectMetadata[] {
  return metadata.schemas
    .flatMap((schema) => schema.objects)
    .filter((object) => object.kind === "table" || object.kind === "view");
}

/** Whether every result column is present in the table (table is a superset). */
function columnsSuperset(table: DbObjectMetadata, resultColumns: readonly string[]): boolean {
  if (resultColumns.length === 0) {
    return false;
  }
  const names = new Set(table.columns.map((column) => normalizeId(column.name)));
  return resultColumns.every((column) => names.has(normalizeId(column)));
}

type TableCandidateScore = {
  table: DbObjectMetadata;
  sourceMatch: boolean;
  resultColumnsCovered: boolean;
};

function tableMatchesSource(table: DbObjectMetadata, source: SourceTableRef | null): boolean {
  return (
    source !== null &&
    eqId(table.name, source.table) &&
    (source.schema === undefined || eqId(table.schema, source.schema))
  );
}

function scoreTableCandidate(
  table: DbObjectMetadata,
  source: SourceTableRef | null,
  resultColumns: readonly string[],
): TableCandidateScore {
  return {
    table,
    sourceMatch: tableMatchesSource(table, source),
    resultColumnsCovered: columnsSuperset(table, resultColumns),
  };
}

function pickSourceCandidate(candidates: TableCandidateScore[]): DbObjectMetadata | null {
  const sourceMatches = candidates.filter((candidate) => candidate.sourceMatch);
  if (sourceMatches.length === 0) {
    return null;
  }
  if (sourceMatches.length === 1) {
    return sourceMatches[0].table;
  }
  return (
    sourceMatches.find((candidate) => candidate.resultColumnsCovered) ?? sourceMatches[0]
  ).table;
}

function pickUniqueResultColumnCandidate(
  candidates: TableCandidateScore[],
): DbObjectMetadata | null {
  const resultColumnMatches = candidates.filter((candidate) => candidate.resultColumnsCovered);
  return resultColumnMatches.length === 1 ? resultColumnMatches[0].table : null;
}

/**
 * Resolve which table a result set came from. Prefers the table named in the query's
 * FROM clause; otherwise falls back to the unique table whose columns are a superset of
 * the result columns. Returns null when the source is ambiguous (e.g. a join).
 */
export function findTableMetadata(
  metadata: DatabaseMetadata | undefined,
  source: SourceTableRef | null,
  resultColumns: readonly string[],
): DbObjectMetadata | null {
  if (!metadata) {
    return null;
  }
  const candidates = allTables(metadata).map((table) =>
    scoreTableCandidate(table, source, resultColumns),
  );
  return pickSourceCandidate(candidates) ?? pickUniqueResultColumnCandidate(candidates);
}

/** Look up a referenced table's metadata by (optional) schema and name. */
export function findTableByName(
  metadata: DatabaseMetadata | undefined,
  schema: string | undefined,
  table: string,
): DbObjectMetadata | null {
  if (!metadata) {
    return null;
  }
  return (
    allTables(metadata).find(
      (object) =>
        eqId(object.name, table) && (schema === undefined || eqId(object.schema, schema)),
    ) ?? null
  );
}

export type ColumnForeignKey = {
  fk: ForeignKey;
  /** Result-column indexes for the FK's local columns, in `fk.columns` order. */
  columnIndexes: number[];
};

/**
 * Map result-column indexes to the foreign key they participate in. Only FKs whose every
 * local column appears in the result are included (so composite keys navigate correctly).
 */
export function foreignKeyColumns(
  table: DbObjectMetadata | null,
  resultColumns: readonly string[],
): Map<number, ColumnForeignKey> {
  if (!table) {
    return new Map();
  }
  const lowerResultColumns = resultColumns.map(normalizeId);
  const entries = table.foreignKeys.flatMap((fk) =>
    foreignKeyColumnEntries(fk, lowerResultColumns),
  );
  return new Map(entries);
}

function foreignKeyColumnEntries(
  fk: ForeignKey,
  lowerResultColumns: readonly string[],
): Array<[number, ColumnForeignKey]> {
  const columnIndexes = foreignKeyResultColumnIndexes(fk, lowerResultColumns);
  if (!columnIndexes) {
    return [];
  }
  const binding: ColumnForeignKey = { fk, columnIndexes };
  return columnIndexes.map((index) => [index, binding]);
}

function foreignKeyResultColumnIndexes(
  fk: ForeignKey,
  lowerResultColumns: readonly string[],
): number[] | null {
  const columnIndexes = fk.columns.map((column) =>
    lowerResultColumns.indexOf(normalizeId(column)),
  );
  return columnIndexes.some((index) => index < 0) ? null : columnIndexes;
}

/** Quote a SQL identifier for the given engine. */
export function quoteIdent(name: string, engine: DbEngine): string {
  switch (engine) {
    case "mysql":
    case "mariadb":
    case "tidb":
      return "`" + name.replace(/`/g, "``") + "`";
    case "sqlserver":
      return "[" + name.replace(/]/g, "]]") + "]";
    default:
      return '"' + name.replace(/"/g, '""') + '"';
  }
}

/**
 * Build a parameterized lookup for the row a foreign key references.
 *
 * Identifiers are quoted for the engine here; values are passed through the existing
 * `:name` parameter mechanism so the backend binds them with dialect-native placeholders.
 */
export function buildForeignKeyLookup(
  fk: ForeignKey,
  values: unknown[],
  engine: DbEngine,
): { sql: string; params: QueryParameterInput[] } {
  const target = foreignKeyTarget(fk, engine);
  const conditions = fk.referencesColumns.map((column, index) =>
    foreignKeyCondition(column, index, engine),
  );
  const sql = `SELECT * FROM ${target} WHERE ${conditions.join(" AND ")}`;
  const params = values.map(foreignKeyLookupParam);
  return { sql, params };
}

function foreignKeyTarget(fk: ForeignKey, engine: DbEngine): string {
  return fk.referencesSchema
    ? `${quoteIdent(fk.referencesSchema, engine)}.${quoteIdent(fk.referencesTable, engine)}`
    : quoteIdent(fk.referencesTable, engine);
}

function foreignKeyCondition(column: string, index: number, engine: DbEngine): string {
  return `${quoteIdent(column, engine)} = :fk${index}`;
}

function foreignKeyLookupParam(value: unknown, index: number): QueryParameterInput {
  return {
    key: { kind: "name", name: `fk${index}` },
    value: value as never,
  };
}
