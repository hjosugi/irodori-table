import { describe, expect, it } from "vitest";
import { isSqlLinterId, lintSqlDocument } from "@/sql/linter";

function messages(sql: string) {
  return lintSqlDocument(sql, "postgres").map((diagnostic) => diagnostic.message);
}

describe("gentle SQL linter", () => {
  it("validates persisted linter ids", () => {
    expect(isSqlLinterId("gentle")).toBe(true);
    expect(isSqlLinterId("disabled")).toBe(true);
    expect(isSqlLinterId("strict")).toBe(false);
    expect(isSqlLinterId(null)).toBe(false);
  });

  it("warns before broad row-changing statements", () => {
    expect(messages("update customers set active = false;")).toContain(
      "UPDATE without WHERE can affect every row. Add a WHERE clause or run intentionally.",
    );
    expect(messages("delete from customers;")).toContain(
      "DELETE without WHERE can affect every row. Add a WHERE clause or run intentionally.",
    );
  });

  it("does not warn for scoped row-changing statements", () => {
    expect(messages("update customers set active = false where id = 1;")).toEqual(
      [],
    );
    expect(messages("delete from customers where id = 1;")).toEqual([]);
  });

  it("does not treat a subquery WHERE as a top-level update filter", () => {
    expect(
      messages(
        "update customers set lifetime_value = (select max(total) from orders where customer_id = 1);",
      ),
    ).toContain(
      "UPDATE without WHERE can affect every row. Add a WHERE clause or run intentionally.",
    );
  });

  it("ignores keywords inside strings and comments", () => {
    expect(
      messages("select 'delete from customers' as sample; -- update x set y = 1"),
    ).toEqual([]);
  });

  it("reports unclosed SQL delimiters", () => {
    expect(messages("select 'open")).toContain("Unclosed string literal.");
    expect(messages("select /* open")).toContain("Unclosed block comment.");
    expect(messages("select (1 + 2")).toContain("Unclosed opening parenthesis.");
  });

  it("flags destructive DDL explicitly", () => {
    expect(messages("drop table customers;")).toContain(
      "DROP is destructive. Run intentionally.",
    );
    expect(messages("truncate table customers;")).toContain(
      "TRUNCATE is destructive. Run intentionally.",
    );
  });
});
