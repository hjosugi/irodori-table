import { describe, expect, it } from "vitest";
import {
  detectImportFileKind,
  generateImportSql,
  inferImportTableName,
  parseImportText,
  sanitizeSqlName,
} from "./importers";

describe("import helpers", () => {
  it("detects supported import file kinds", () => {
    expect(detectImportFileKind("orders.csv")).toBe("csv");
    expect(detectImportFileKind("orders.JSONL")).toBe("jsonl");
    expect(detectImportFileKind("dump.sql")).toBe("sql");
    expect(detectImportFileKind("sheet.xlsx")).toBe("excel");
    expect(detectImportFileKind("notes.txt")).toBeNull();
  });

  it("parses quoted CSV rows", () => {
    const parsed = parseImportText('id,name,note\r\n1,"Bob, Jr.","line\nbreak"\n', "csv");
    expect(parsed.columns).toEqual(["id", "name", "note"]);
    expect(parsed.rows).toEqual([["1", "Bob, Jr.", "line\nbreak"]]);
    expect(parsed.truncated).toBe(false);
  });

  it("parses TSV rows", () => {
    const parsed = parseImportText("id\tname\n1\tAlice\n", "tsv");
    expect(parsed.rows).toEqual([["1", "Alice"]]);
  });

  it("parses JSON object arrays without losing spaced keys", () => {
    const parsed = parseImportText(
      JSON.stringify([{ "first name": "Alice", age: 31 }, { "first name": "Bob" }]),
      "json",
    );
    expect(parsed.columns).toEqual(["first name", "age"]);
    expect(parsed.rows).toEqual([
      ["Alice", 31],
      ["Bob", null],
    ]);
  });

  it("parses JSONL and caps rows", () => {
    const parsed = parseImportText('{"id":1}\n{"id":2}\n{"id":3}\n', "jsonl", 2);
    expect(parsed.rows).toEqual([[1], [2]]);
    expect(parsed.totalRows).toBe(3);
    expect(parsed.truncated).toBe(true);
  });

  it("generates create and insert SQL with sanitized identifiers", () => {
    const sql = generateImportSql(
      "2026 orders",
      ["order id", "total", "paid"],
      [
        ["1", "12.5", "true"],
        ["2", "8.0", "false"],
      ],
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "_2026_orders"');
    expect(sql).toContain('"order_id" INTEGER');
    expect(sql).toContain('"total" REAL');
    expect(sql).toContain('"paid" BOOLEAN');
    expect(sql).toContain("('1', '12.5', 'true')");
  });

  it("can generate insert-only SQL", () => {
    const sql = generateImportSql("people", ["name"], [["O'Hara"]], false);
    expect(sql).not.toContain("CREATE TABLE");
    expect(sql).toBe('INSERT INTO "people" ("name") VALUES\n  (\'O\'\'Hara\');\n');
  });

  it("normalizes duplicate and blank import column names", () => {
    const sql = generateImportSql(
      "people",
      ["Name", "name", "", ""],
      [["Alice", "A.", "1", "2"]],
    );

    expect(sql).toContain('"Name" TEXT');
    expect(sql).toContain('"name_2" TEXT');
    expect(sql).toContain('"column_3" INTEGER');
    expect(sql).toContain('"column_4" INTEGER');
    expect(sql).toContain('INSERT INTO "people" ("Name", "name_2", "column_3", "column_4")');
  });

  it("infers safe table names from files", () => {
    expect(inferImportTableName("/tmp/customer-orders.csv")).toBe("customer_orders");
    expect(sanitizeSqlName("123 bad name")).toBe("_123_bad_name");
  });
});
