// Engine → SQL dialect / formatter-language / lightweight completion mapping.
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
  sql,
  type SQLConfig,
  type SQLDialect,
} from "@codemirror/lang-sql";
import type { Completion, CompletionResult } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type {
  ColumnMetadata,
  DatabaseMetadata,
  DbEngine,
  DbObjectMetadata,
  SchemaMetadata,
} from "../generated/irodori-api";
import { statementDelimiters } from "./statements";

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

const MAX_METADATA_COMPLETIONS = 50;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;
const RELATION_KINDS = new Set(["table", "view"]);
const ROUTINE_KINDS = new Set(["function", "procedure"]);
const RELATION_STARTERS = new Set([
  "from",
  "join",
  "update",
  "into",
  "describe",
  "desc",
  "truncate",
  "table",
]);
const RELATION_BLOCKERS = new Set([
  "where",
  "on",
  "using",
  "group",
  "order",
  "having",
  "limit",
  "offset",
  "union",
  "except",
  "intersect",
  "returning",
  "values",
  "set",
]);
const RESERVED_ALIAS_WORDS = new Set([
  ...RELATION_STARTERS,
  ...RELATION_BLOCKERS,
  "as",
  "by",
  "cross",
  "full",
  "inner",
  "left",
  "natural",
  "right",
  "select",
  "with",
]);

interface CompletionPrefix {
  from: number;
  text: string;
}

interface StatementSlice {
  from: number;
  to: number;
  text: string;
  cursor: number;
}

interface RelationBinding {
  schema: SchemaMetadata;
  object: DbObjectMetadata;
  qualifier: string;
}

interface ShallowToken {
  text: string;
  lower: string;
}

interface ResolvedObject {
  schema: SchemaMetadata;
  object: DbObjectMetadata;
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
): Extension {
  const config = buildSqlConfig(engine, metadata);
  const dialect = config.dialect ?? StandardSQL;
  return [
    sql(config),
    dialect.language.data.of({
      autocomplete: metadataCompletionSource(metadata),
    }),
  ];
}

export function metadataCompletionsForSql(
  sqlText: string,
  cursor: number,
  metadata: DatabaseMetadata | undefined,
  explicit = false,
): CompletionResult | null {
  if (!metadata || metadata.schemas.length === 0) return null;

  const statement = currentStatementSlice(sqlText, cursor);
  const masked = maskSqlLiterals(statement.text);
  if (isMaskedAt(masked, statement.cursor)) return null;

  const prefix = identifierPrefix(masked, statement.cursor);
  const dot = qualifiedPartsBefore(masked, prefix.from);
  if (!explicit && prefix.text === "" && !dot) return null;

  const defaultSchema = metadata.schemas[0];
  const aliases = relationBindings(masked, metadata);

  if (dot) {
    const qualified = completeQualified(dot.parts, prefix, metadata, aliases);
    return result(statement.from + prefix.from, qualified);
  }

  if (isRelationContext(masked, prefix.from)) {
    return result(
      statement.from + prefix.from,
      relationCompletions(metadata, defaultSchema, prefix.text),
    );
  }

  const bindings = aliasesFromCurrentStatement(aliases);
  if (bindings.length > 0) {
    return result(
      statement.from + prefix.from,
      columnCompletions(bindings, prefix.text, bindings.length > 1),
    );
  }

  return result(
    statement.from + prefix.from,
    routineCompletions(metadata, defaultSchema, prefix.text),
  );
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
