import { describe, expect, it } from "vitest";
import {
  buildResultExport,
  resultExportFileName,
  type ResultLike,
} from "./result-export";

const result: ResultLike = {
  columns: ["id", "name", "note"],
  rows: [
    [1, "Alice", "plain"],
    [2, "Bob, Jr.", "line\nbreak"],
    [3n, "O'Hara", { active: true }],
  ],
};

describe("result exports", () => {
  it("exports quoted CSV", () => {
    expect(buildResultExport(result, "csv").content).toBe(
      'id,name,note\r\n1,Alice,plain\r\n2,"Bob, Jr.","line\nbreak"\r\n3,O\'Hara,"{""active"":true}"',
    );
  });

  it("exports TSV with tab quoting", () => {
    const exported = buildResultExport(
      { columns: ["a", "b"], rows: [["one\ttwo", "three"]] },
      "tsv",
    );
    expect(exported.extension).toBe("tsv");
    expect(exported.content).toBe('a\tb\r\n"one\ttwo"\tthree');
  });

  it("exports JSON and JSONL with bigint-safe values", () => {
    expect(buildResultExport(result, "json").content).toContain('"id": "3"');
    expect(buildResultExport(result, "jsonl").content.trim().split("\n")).toHaveLength(3);
  });

  it("exports SQL insert statements", () => {
    expect(buildResultExport(result, "sql", "people").content).toContain(
      `INSERT INTO "people" ("id", "name", "note") VALUES (3, 'O''Hara', '{"active":true}');`,
    );
  });

  it("exports Markdown tables with escaped pipes", () => {
    const exported = buildResultExport(
      { columns: ["a|b"], rows: [["x|y"]] },
      "markdown",
    );
    expect(exported.content).toBe("| a\\|b |\n| --- |\n| x\\|y |\n");
  });

  it("exports an Excel-compatible workbook", () => {
    const exported = buildResultExport(
      { columns: ["name"], rows: [["<Alice>"]] },
      "excel",
    );
    expect(exported.extension).toBe("xls");
    expect(exported.content).toContain("&lt;Alice&gt;");
  });

  it("uses the export extension in download names", () => {
    expect(
      resultExportFileName("local", "jsonl", new Date("2026-06-25T00:00:00.000Z")),
    ).toBe("irodori-local-2026-06-25T00-00-00-000Z.jsonl");
    expect(
      resultExportFileName("local", "excel", new Date("2026-06-25T00:00:00.000Z")),
    ).toBe("irodori-local-2026-06-25T00-00-00-000Z.xls");
  });
});
