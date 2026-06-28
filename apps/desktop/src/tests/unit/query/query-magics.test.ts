import { describe, expect, it } from "vitest";
import { parseQueryMagic } from "@/features/query-editor/query-magics";

describe("parseQueryMagic", () => {
  it("ignores normal SQL", () => {
    expect(parseQueryMagic("select 1", "postgres")).toBeNull();
  });

  it("expands explain without using analyze by default", () => {
    expect(
      parseQueryMagic("\\explain select * from orders;", "postgres"),
    ).toMatchObject({
      kind: "sql",
      command: "explain",
      sql: "EXPLAIN select * from orders;",
    });
  });

  it("uses Oracle explain-plan syntax", () => {
    expect(
      parseQueryMagic("\\explain select * from users", "oracle"),
    ).toMatchObject({
      kind: "sql",
      command: "explain",
      sql: "EXPLAIN PLAN FOR select * from users;",
    });
  });

  it("describes information_schema columns for Postgres-style engines", () => {
    const action = parseQueryMagic("\\describe sales.orders", "postgres");
    expect(action).toMatchObject({ kind: "sql", command: "describe" });
    expect(action?.kind === "sql" ? action.sql : "").toContain(
      "FROM information_schema.columns",
    );
    expect(action?.kind === "sql" ? action.sql : "").toContain(
      "table_schema = 'sales'",
    );
    expect(action?.kind === "sql" ? action.sql : "").toContain(
      "table_name = 'orders'",
    );
  });

  it("uses pragma table_info for SQLite", () => {
    expect(parseQueryMagic("\\d users", "sqlite")).toMatchObject({
      kind: "sql",
      command: "describe",
      sql: 'PRAGMA table_info("users");',
    });
  });

  it("parses ERD and export actions", () => {
    expect(parseQueryMagic("\\erd sales", "postgres")).toEqual({
      kind: "erd",
      search: "sales",
      preview: 'Open ERD filtered by "sales"',
    });
    expect(parseQueryMagic("\\export jsonl", "postgres")).toEqual({
      kind: "export",
      format: "jsonl",
      preview: "Export current result as JSONL",
    });
  });

  it("returns explicit errors for incomplete commands", () => {
    expect(parseQueryMagic("\\describe", "postgres")).toMatchObject({
      kind: "error",
      message: "\\describe needs a table or view name.",
    });
    expect(parseQueryMagic("\\export parquet", "postgres")).toMatchObject({
      kind: "error",
    });
  });
});
