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

/** Format a raw cell value for the detail panel, pretty-printing JSON containers. */
export function formatDetailValue(value: unknown): DetailValue {
  if (value === null || value === undefined) {
    return { text: "NULL", json: false };
  }
  if (typeof value === "object") {
    return { text: JSON.stringify(value, null, 2), json: true };
  }
  return { text: String(value), json: false };
}

/** Case-insensitive identifier comparison (most SQL engines fold unquoted names). */
function eqId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function stripIdentQuotes(raw: string): string {
  const value = raw.trim();
  if (value.length < 2) {
    return value;
  }
  const first = value[0];
  const last = value[value.length - 1];
  if (first === '"' && last === '"') {
    return value.slice(1, -1).replace(/""/g, '"');
  }
  if (first === "`" && last === "`") {
    return value.slice(1, -1).replace(/``/g, "`");
  }
  if (first === "[" && last === "]") {
    return value.slice(1, -1).replace(/]]/g, "]");
  }
  return value;
}

/**
 * Parse the first `FROM <schema.>?<table>` reference from a SQL statement.
 *
 * Intentionally simple: it handles the common single-table SELECT (the case where
 * FK navigation is meaningful) across quoting styles. For joins or expressions it may
 * return the first table or null; callers validate the result against live metadata and
 * fall back to column matching, so a wrong guess degrades gracefully.
 */
export function parseSourceTable(sql: string): { schema?: string; table: string } | null {
  const match = /\bfrom\s+([`"[]?[\w$]+[`"\]]?)\s*(?:\.\s*([`"[]?[\w$]+[`"\]]?))?/i.exec(sql);
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
function columnsSuperset(table: DbObjectMetadata, resultColumns: string[]): boolean {
  if (resultColumns.length === 0) {
    return false;
  }
  const names = new Set(table.columns.map((column) => column.name.toLowerCase()));
  return resultColumns.every((column) => names.has(column.toLowerCase()));
}

/**
 * Resolve which table a result set came from. Prefers the table named in the query's
 * FROM clause; otherwise falls back to the unique table whose columns are a superset of
 * the result columns. Returns null when the source is ambiguous (e.g. a join).
 */
export function findTableMetadata(
  metadata: DatabaseMetadata | undefined,
  source: { schema?: string; table: string } | null,
  resultColumns: string[],
): DbObjectMetadata | null {
  if (!metadata) {
    return null;
  }
  const tables = allTables(metadata);
  if (source) {
    const matches = tables.filter(
      (table) =>
        eqId(table.name, source.table) &&
        (source.schema === undefined || eqId(table.schema, source.schema)),
    );
    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      return matches.find((table) => columnsSuperset(table, resultColumns)) ?? matches[0];
    }
  }
  const supersets = tables.filter((table) => columnsSuperset(table, resultColumns));
  return supersets.length === 1 ? supersets[0] : null;
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
  resultColumns: string[],
): Map<number, ColumnForeignKey> {
  const map = new Map<number, ColumnForeignKey>();
  if (!table) {
    return map;
  }
  const lower = resultColumns.map((column) => column.toLowerCase());
  for (const fk of table.foreignKeys) {
    const columnIndexes = fk.columns.map((column) => lower.indexOf(column.toLowerCase()));
    if (columnIndexes.some((index) => index < 0)) {
      continue;
    }
    const binding: ColumnForeignKey = { fk, columnIndexes };
    for (const index of columnIndexes) {
      map.set(index, binding);
    }
  }
  return map;
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
  const target = fk.referencesSchema
    ? `${quoteIdent(fk.referencesSchema, engine)}.${quoteIdent(fk.referencesTable, engine)}`
    : quoteIdent(fk.referencesTable, engine);
  const conditions = fk.referencesColumns.map(
    (column, index) => `${quoteIdent(column, engine)} = :fk${index}`,
  );
  const sql = `SELECT * FROM ${target} WHERE ${conditions.join(" AND ")}`;
  const params: QueryParameterInput[] = values.map((value, index) => ({
    key: { kind: "name", name: `fk${index}` },
    value: value as never,
  }));
  return { sql, params };
}
