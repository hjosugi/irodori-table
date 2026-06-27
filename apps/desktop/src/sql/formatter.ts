import { format as formatSql } from "sql-formatter";
import {
  sqlFormatSnowflake,
  type DbEngine,
} from "../generated/irodori-api";
import { formatterLanguage } from "./dialect";

export type SqlFormatterId = "sql-formatter" | "disabled";

export const formatterOptions: Array<{ id: SqlFormatterId; label: string }> = [
  { id: "sql-formatter", label: "sql-formatter" },
  { id: "disabled", label: "Disabled" },
];

export function isSqlFormatterId(value: string | null): value is SqlFormatterId {
  return value === "sql-formatter" || value === "disabled";
}

export async function formatSqlDocument(
  sql: string,
  engine: DbEngine,
  formatter: SqlFormatterId,
): Promise<string> {
  if (formatter === "disabled") {
    throw new Error("SQL formatter is disabled");
  }

  if (engine === "snowflake") {
    return sqlFormatSnowflake(sql, 100, 4, true);
  }

  return formatSql(sql, {
    language: formatterLanguage(engine),
  } as Parameters<typeof formatSql>[1]);
}
