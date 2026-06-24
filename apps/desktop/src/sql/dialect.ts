// Engine → SQL dialect / formatter-language / completion-schema mapping.
//
// Pure (no DOM, no React) so it can be unit-tested. `@codemirror/lang-sql` is
// safe to import here — it pulls in the parser/highlight packages, not the
// DOM-bound `@codemirror/view`.

import {
  MSSQL,
  MariaSQL,
  MySQL,
  PLSQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  type SQLConfig,
  type SQLDialect,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import type { Completion } from "@codemirror/autocomplete";
import type { DatabaseMetadata, DbEngine } from "../generated/irodori-api";

/** Map an Irodori engine onto a CodeMirror SQL dialect (Postgres-wire siblings share one). */
export function cmDialect(engine: DbEngine): SQLDialect {
  switch (engine) {
    case "mysql":
    case "tidb":
      return MySQL;
    case "mariadb":
      return MariaSQL;
    case "sqlite":
      return SQLite;
    case "sqlserver":
      return MSSQL;
    case "oracle":
      return PLSQL;
    case "postgres":
    case "cockroachdb":
    case "yugabytedb":
    case "redshift":
    case "timescaledb":
    case "neon":
    case "h2":
    case "duckdb":
      return PostgreSQL;
    default:
      return StandardSQL;
  }
}

/** Map an Irodori engine onto a sql-formatter language. */
export function formatterLanguage(engine: DbEngine): string {
  switch (engine) {
    case "mysql":
      return "mysql";
    case "tidb":
      return "tidb";
    case "mariadb":
      return "mariadb";
    case "sqlite":
      return "sqlite";
    case "sqlserver":
      return "transactsql";
    case "oracle":
      return "plsql";
    case "redshift":
      return "redshift";
    case "duckdb":
      return "duckdb";
    case "clickhouse":
      return "clickhouse";
    case "snowflake":
      return "snowflake";
    case "bigquery":
      return "bigquery";
    case "postgres":
    case "cockroachdb":
    case "yugabytedb":
    case "timescaledb":
    case "neon":
    case "h2":
      return "postgresql";
    default:
      return "sql";
  }
}

/**
 * Convert Irodori introspection metadata into a CodeMirror SQL completion schema:
 * `{ schema: { table: { self, children: columns } } }`. Indexes are skipped — only
 * relations (tables/views) and their columns are completable.
 */
export function metadataToNamespace(
  metadata: DatabaseMetadata | undefined,
): SQLNamespace | undefined {
  if (!metadata || metadata.schemas.length === 0) return undefined;
  const namespace: Record<string, SQLNamespace> = {};
  for (const schema of metadata.schemas) {
    const tables: Record<string, SQLNamespace> = {};
    for (const object of schema.objects) {
      if (object.kind === "index") continue;
      const columns: Completion[] = object.columns
        .slice()
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((column) => ({
          label: column.name,
          type: "property",
          detail: column.nullable ? column.dataType : `${column.dataType} not null`,
        }));
      tables[object.name] = {
        self: { label: object.name, type: object.kind === "view" ? "type" : "class" },
        children: columns,
      };
    }
    namespace[schema.name] = tables;
  }
  return namespace;
}

export function buildSqlConfig(
  engine: DbEngine,
  metadata: DatabaseMetadata | undefined,
): SQLConfig {
  const schema = metadataToNamespace(metadata);
  return {
    dialect: cmDialect(engine),
    upperCaseKeywords: false,
    ...(schema ? { schema, defaultSchema: metadata?.schemas[0]?.name } : {}),
  };
}
