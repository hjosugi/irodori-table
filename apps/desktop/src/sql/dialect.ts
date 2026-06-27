// Engine -> SQL dialect / formatter-language / editor SQL extension mapping.
//
// Pure (no DOM, no React) so it can be unit-tested. `@codemirror/lang-sql` is
// safe to import here; the lightweight metadata completion source lives in
// `completion.ts` and is wired as language data beside the SQL parser support.

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
} from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";
import type { DatabaseMetadata, DbEngine } from "../generated/irodori-api";
import {
  lightweightSqlCompletionLanguageData,
  type SqlSnippetDefinition,
} from "./completion";

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
    case "questdb":
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
    case "questdb":
      return "postgresql";
    default:
      return "sql";
  }
}

export function buildSqlConfig(
  engine: DbEngine,
  _metadata: DatabaseMetadata | undefined,
): SQLConfig {
  return {
    dialect: cmDialect(engine),
    upperCaseKeywords: false,
  };
}

export function buildSqlExtensions(
  engine: DbEngine,
  metadata: DatabaseMetadata | undefined,
  snippets?: readonly SqlSnippetDefinition[],
): Extension {
  const config = buildSqlConfig(engine, metadata);
  const dialect = config.dialect ?? StandardSQL;
  return [
    dialect.extension,
    lightweightSqlCompletionLanguageData(dialect, engine, metadata, snippets),
  ];
}
