import { describe, expect, it } from "vitest";
import { sqlMayWrite } from "@/sql/read-only";

describe("sql read-only guard", () => {
  it("allows selects with write-like text in strings and quoted identifiers", () => {
    expect(sqlMayWrite("select 'delete from users' as sql_text")).toBe(false);
    expect(sqlMayWrite('select "update" as quoted_identifier')).toBe(false);
    expect(sqlMayWrite("select $$create table fake$$")).toBe(false);
  });

  it("detects write statements across statement forms", () => {
    expect(
      sqlMayWrite(
        "with changed as (select 1) insert into audit_log select * from changed",
      ),
    ).toBe(true);
    expect(sqlMayWrite("/* maintenance */ vacuum; analyze users")).toBe(true);
    expect(sqlMayWrite("call refresh_rollups()")).toBe(true);
  });
});
