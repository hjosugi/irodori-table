import type { DbEngine } from "@/generated/irodori-api";
import type { ResultExportFormat } from "@/features/results";

export type QueryMagicAction =
  | {
      kind: "sql";
      command: "describe" | "explain";
      sql: string;
      preview: string;
    }
  | {
      kind: "erd";
      search: string;
      preview: string;
    }
  | {
      kind: "export";
      format: ResultExportFormat;
      preview: string;
    }
  | {
      kind: "params";
      sql: string;
      preview: string;
    }
  | {
      kind: "error";
      message: string;
    };

const exportFormats = new Set<ResultExportFormat>([
  "csv",
  "tsv",
  "json",
  "jsonl",
  "sql",
  "excel",
  "markdown",
]);

export function parseQueryMagic(
  input: string,
  engine: DbEngine,
): QueryMagicAction | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("\\")) {
    return null;
  }
  const match = trimmed.match(/^\\([A-Za-z]+)\b[ \t]*/);
  if (!match) {
    return {
      kind: "error",
      message: "Unknown query magic. Use \\describe, \\explain, \\export, \\erd, or \\params.",
    };
  }

  const command = match[1].toLowerCase();
  const rest = trimmed.slice(match[0].length).trim();
  switch (command) {
    case "describe":
    case "desc":
    case "d":
      return describeMagic(rest, engine);
    case "explain":
      return explainMagic(rest, engine);
    case "erd":
      return {
        kind: "erd",
        search: rest,
        preview: rest ? `Open ERD filtered by "${rest}"` : "Open ERD for active connection",
      };
    case "export":
      return exportMagic(rest);
    case "params":
      return rest
        ? {
            kind: "params",
            sql: rest,
            preview: "Prompt for query parameters",
          }
        : {
            kind: "error",
            message: "\\params needs SQL after the command.",
          };
    default:
      return {
        kind: "error",
        message: `Unknown query magic \\${command}. Use \\describe, \\explain, \\export, \\erd, or \\params.`,
      };
  }
}

function describeMagic(rest: string, engine: DbEngine): QueryMagicAction {
  const target = firstToken(rest);
  if (!target) {
    return { kind: "error", message: "\\describe needs a table or view name." };
  }
  const sql = describeSql(target, engine);
  return {
    kind: "sql",
    command: "describe",
    sql,
    preview: `Describe ${target}`,
  };
}

function explainMagic(rest: string, engine: DbEngine): QueryMagicAction {
  if (!rest) {
    return { kind: "error", message: "\\explain needs SQL after the command." };
  }
  return {
    kind: "sql",
    command: "explain",
    sql: explainSql(rest, engine),
    preview: "Run explain plan",
  };
}

function exportMagic(rest: string): QueryMagicAction {
  const format = firstToken(rest).toLowerCase();
  if (!exportFormats.has(format as ResultExportFormat)) {
    return {
      kind: "error",
      message: "\\export needs one of: csv, tsv, json, jsonl, sql, excel, markdown.",
    };
  }
  return {
    kind: "export",
    format: format as ResultExportFormat,
    preview: `Export current result as ${format.toUpperCase()}`,
  };
}

function explainSql(sql: string, engine: DbEngine): string {
  const trimmed = trimTrailingSemicolon(sql);
  switch (engine) {
    case "sqlserver":
      return `SET SHOWPLAN_TEXT ON;\n${trimmed};\nSET SHOWPLAN_TEXT OFF;`;
    case "oracle":
      return `EXPLAIN PLAN FOR ${trimmed};`;
    default:
      return `EXPLAIN ${trimmed};`;
  }
}

function describeSql(target: string, engine: DbEngine): string {
  const parsed = parseTarget(target);
  switch (engine) {
    case "sqlite":
    case "duckdb":
      return `PRAGMA table_info(${quotedSqliteIdentifier(parsed.table)});`;
    case "mysql":
    case "mariadb":
    case "tidb":
      return [
        "SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default",
        "FROM information_schema.columns",
        `WHERE table_name = ${sqlString(parsed.table)}`,
        parsed.schema
          ? `  AND table_schema = ${sqlString(parsed.schema)}`
          : "  AND table_schema = database()",
        "ORDER BY ordinal_position;",
      ].join("\n");
    case "sqlserver":
      return [
        "SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default",
        "FROM information_schema.columns",
        `WHERE table_name = ${sqlString(parsed.table)}`,
        parsed.schema ? `  AND table_schema = ${sqlString(parsed.schema)}` : "",
        "ORDER BY ordinal_position;",
      ]
        .filter(Boolean)
        .join("\n");
    case "oracle":
      return [
        "SELECT owner, table_name, column_name, data_type, nullable, data_default",
        "FROM all_tab_columns",
        `WHERE table_name = upper(${sqlString(parsed.table)})`,
        parsed.schema ? `  AND owner = upper(${sqlString(parsed.schema)})` : "",
        "ORDER BY column_id;",
      ]
        .filter(Boolean)
        .join("\n");
    default:
      return [
        "SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default",
        "FROM information_schema.columns",
        `WHERE table_name = ${sqlString(parsed.table)}`,
        parsed.schema ? `  AND table_schema = ${sqlString(parsed.schema)}` : "",
        "ORDER BY ordinal_position;",
      ]
        .filter(Boolean)
        .join("\n");
  }
}

function parseTarget(target: string) {
  const clean = stripIdentifierQuotes(target);
  const parts = clean.split(".").filter(Boolean);
  return {
    schema: parts.length > 1 ? parts[parts.length - 2] : "",
    table: parts[parts.length - 1] || clean,
  };
}

function stripIdentifierQuotes(value: string) {
  return value.replace(/^[`"[]|[`"\]]$/g, "");
}

function firstToken(value: string) {
  return value.trim().split(/\s+/)[0] ?? "";
}

function trimTrailingSemicolon(sql: string) {
  return sql.trim().replace(/;+\s*$/, "");
}

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function quotedSqliteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
