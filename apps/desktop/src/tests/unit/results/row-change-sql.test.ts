import { describe, expect, it } from "vitest";
import {
  buildSelectedRowChangeSql,
  sqlLiteralForResultValue,
} from "@/features/results/row-change-sql";

describe("buildSelectedRowChangeSql", () => {
  it("builds a transaction-wrapped update for a selected row", () => {
    expect(
      buildSelectedRowChangeSql({
        engine: "postgres",
        target: { schema: "public", table: "orders", keyColumns: ["id"] },
        columns: ["id", "status", "total"],
        row: [42, "ready", 19.5],
      }),
    ).toBe(
      [
        "-- Generated from the selected result row. Review before running.",
        "-- Edit the SET values, then run this transaction.",
        "BEGIN;",
        'UPDATE "public"."orders"',
        "SET",
        "  \"status\" = 'ready',",
        '  "total" = 19.5',
        "WHERE",
        '  "id" = 42',
        ";",
        "COMMIT;",
      ].join("\n"),
    );
  });

  it("quotes mysql identifiers and null keys correctly", () => {
    expect(
      buildSelectedRowChangeSql({
        engine: "mysql",
        target: { table: "line`items", keyColumns: ["sku"] },
        columns: ["sku", "label"],
        row: [null, "O'Reilly"],
      }),
    ).toContain(
      "UPDATE `line``items`\nSET\n  `label` = 'O''Reilly'\nWHERE\n  `sku` IS NULL",
    );
  });

  it("uses SQL Server transactions and bracket identifiers", () => {
    expect(
      buildSelectedRowChangeSql({
        engine: "sqlserver",
        target: { schema: "dbo", table: "order items", keyColumns: ["id"] },
        columns: ["id", "name"],
        row: [7, "updated"],
      }),
    ).toContain(
      "BEGIN TRANSACTION;\nUPDATE [dbo].[order items]\nSET\n  [name] = 'updated'",
    );
  });

  it("serializes object values as escaped JSON literals", () => {
    expect(sqlLiteralForResultValue({ label: "O'Reilly", id: 1n })).toBe(
      '\'{"label":"O\'\'Reilly","id":"1"}\'',
    );
  });
});
