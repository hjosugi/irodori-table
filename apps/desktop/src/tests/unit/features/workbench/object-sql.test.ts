import { describe, expect, it } from "vitest";
import {
  objectKindLabel,
  qualifiedObjectName,
  tablePreviewSql,
} from "@/features/workbench/object-sql";
import type { DbObjectMetadata } from "@/generated/irodori-api";

function object(partial: Partial<DbObjectMetadata>): DbObjectMetadata {
  return {
    schema: "public",
    name: "customers",
    kind: "table",
    columns: [],
    indexes: [],
    primaryKey: [],
    foreignKeys: [],
    ...partial,
  };
}

describe("workbench object SQL helpers", () => {
  it("quotes object names for the active engine", () => {
    expect(qualifiedObjectName("postgres", object({}))).toBe(
      '"public"."customers"',
    );
    expect(qualifiedObjectName("mysql", object({ schema: "sales" }))).toBe(
      "`sales`.`customers`",
    );
  });

  it("builds engine-specific preview SQL", () => {
    expect(tablePreviewSql("postgres", object({}))).toBe(
      'select * from "public"."customers" limit 200;',
    );
    expect(tablePreviewSql("sqlserver", object({ schema: "dbo" }))).toBe(
      'select top (200) * from "dbo"."customers";',
    );
  });

  it("formats object kind labels", () => {
    expect(objectKindLabel(object({ kind: "view" }))).toBe("view");
    expect(objectKindLabel(object({ kind: "procedure" }))).toBe("procedure");
  });
});
