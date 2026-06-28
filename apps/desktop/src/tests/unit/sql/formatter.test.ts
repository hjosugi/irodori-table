import { describe, expect, it } from "vitest";
import { formatSqlDocument, isSqlFormatterId } from "@/sql/formatter";

describe("SQL formatter hook", () => {
  it("formats through the configured sql-formatter hook", async () => {
    await expect(
      formatSqlDocument("select * from customers", "postgres", "sql-formatter"),
    ).resolves.toBe("select\n  *\nfrom\n  customers");
  });

  it("can disable formatting through configuration", async () => {
    await expect(
      formatSqlDocument("select 1", "postgres", "disabled"),
    ).rejects.toThrow("SQL formatter is disabled");
  });

  it("validates persisted formatter ids", () => {
    expect(isSqlFormatterId("sql-formatter")).toBe(true);
    expect(isSqlFormatterId("disabled")).toBe(true);
    expect(isSqlFormatterId("prettier")).toBe(false);
  });
});
