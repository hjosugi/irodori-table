import { describe, expect, it } from "vitest";
import { formatSqlDocument, isSqlFormatterId } from "./formatter";

describe("SQL formatter hook", () => {
  it("formats through the configured sql-formatter hook", () => {
    expect(
      formatSqlDocument("select * from customers", "postgres", "sql-formatter"),
    ).toBe("select\n  *\nfrom\n  customers");
  });

  it("can disable formatting through configuration", () => {
    expect(() => formatSqlDocument("select 1", "postgres", "disabled")).toThrow(
      "SQL formatter is disabled",
    );
  });

  it("validates persisted formatter ids", () => {
    expect(isSqlFormatterId("sql-formatter")).toBe(true);
    expect(isSqlFormatterId("disabled")).toBe(true);
    expect(isSqlFormatterId("prettier")).toBe(false);
  });
});
