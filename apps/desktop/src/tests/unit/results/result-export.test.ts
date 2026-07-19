import { describe, expect, it } from "vitest";
import {
  buildResultExport,
  resultExportFileName,
  resultExportFormats,
  unsupportedResultExportFormatMessage,
  type ResultLike,
} from "@/features/results/result-export";

const result: ResultLike = {
  columns: ["id", "name", "note"],
  rows: [
    [1, "Alice", "plain"],
    [2, "Bob, Jr.", "line\nbreak"],
    [3n, "O'Hara", { active: true }],
  ],
};

describe("result exports", () => {
  it("advertises the implemented export formats", () => {
    expect(resultExportFormats.map(({ id, label }) => [id, label])).toEqual([
      ["csv", "CSV"],
      ["tsv", "TSV"],
      ["json", "JSON"],
      ["jsonl", "JSONL"],
      ["sql", "SQL"],
      ["xlsx", "Excel"],
      ["excel", "Excel-compatible"],
      ["markdown", "Markdown"],
    ]);
    expect(
      resultExportFormats.find((format) => format.id === "excel")?.title,
    ).toBe("HTML workbook readable by Excel");
  });

  it("reports unsupported export formats with clear errors", () => {
    expect(() => buildResultExport(result, "parquet")).toThrow(
      "Parquet export is not supported.",
    );
    expect(() =>
      resultExportFileName(
        "local",
        "avro",
        new Date("2026-06-25T00:00:00.000Z"),
      ),
    ).toThrow("Avro export is not supported.");
    expect(unsupportedResultExportFormatMessage("xml")).toBe(
      'Unsupported export format "xml". Supported export formats: CSV, TSV, JSON, JSONL, SQL, Excel (.xlsx), Excel-compatible HTML, Markdown.',
    );
  });

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
    expect(
      buildResultExport(result, "jsonl").content.trim().split("\n"),
    ).toHaveLength(3);
  });

  it("exports JSON with date-safe nested values", () => {
    const exported = buildResultExport(
      {
        columns: ["created_at", "payload"],
        rows: [
          [
            new Date("2026-06-25T00:00:00.000Z"),
            { sentAt: new Date("2026-06-25T01:02:03.000Z"), count: 2n },
          ],
        ],
      },
      "json",
    );

    expect(exported.content).toContain(
      '"created_at": "2026-06-25T00:00:00.000Z"',
    );
    expect(exported.content).toContain('"sentAt": "2026-06-25T01:02:03.000Z"');
    expect(exported.content).toContain('"count": "2"');
  });

  it("exports SQL insert statements", () => {
    expect(buildResultExport(result, "sql", "people").content).toContain(
      `INSERT INTO "people" ("id", "name", "note") VALUES (3, 'O''Hara', '{"active":true}');`,
    );
  });

  it("escapes SQL identifiers and literals", () => {
    const exported = buildResultExport(
      {
        columns: ['strange "id"', "payload"],
        rows: [
          [true, "O'Hara"],
          [Number.NaN, { name: "O'Hara" }],
        ],
      },
      "sql",
      'people "archive"',
    );

    expect(exported.content).toContain(
      `INSERT INTO "people ""archive""" ("strange ""id""", "payload") VALUES (TRUE, 'O''Hara');`,
    );
    expect(exported.content).toContain(
      `INSERT INTO "people ""archive""" ("strange ""id""", "payload") VALUES (NULL, '{"name":"O''Hara"}');`,
    );
  });

  it("exports empty SQL results as a comment", () => {
    expect(
      buildResultExport({ columns: ["id"], rows: [] }, "sql", "empty table")
        .content,
    ).toBe('-- No rows to export for "empty table".\n');
  });

  it("exports Markdown tables with escaped pipes, backslashes, and newlines", () => {
    const exported = buildResultExport(
      { columns: ["a|b", "path"], rows: [["x|y", "C:\\tmp\nnext"]] },
      "markdown",
    );
    expect(exported.content).toBe(
      "| a\\|b | path |\n| --- | --- |\n| x\\|y | C:\\\\tmp<br>next |\n",
    );
  });

  it("exports an escaped Excel-compatible workbook", () => {
    const exported = buildResultExport(
      { columns: ['na"me', "html"], rows: [["<Alice & Bob>", '"quoted"']] },
      "excel",
    );
    expect(exported.extension).toBe("xls");
    expect(exported.content).toContain("<th>na&quot;me</th>");
    expect(exported.content).toContain("&lt;Alice &amp; Bob&gt;");
    expect(exported.content).toContain("&quot;quoted&quot;");
  });

  it("uses the export extension in download names", () => {
    expect(
      resultExportFileName(
        "local",
        "jsonl",
        new Date("2026-06-25T00:00:00.000Z"),
      ),
    ).toBe("irodori-local-2026-06-25T00-00-00-000Z.jsonl");
    expect(
      resultExportFileName(
        "local",
        "excel",
        new Date("2026-06-25T00:00:00.000Z"),
      ),
    ).toBe("irodori-local-2026-06-25T00-00-00-000Z.xls");
  });
});

// The copy menu offered `xlsx`, whose serializer is `() => ""` because its
// bytes come from buildXlsxBlob — so Copy as Excel put an empty string on the
// clipboard and still showed a success toast. Copying a format is only
// meaningful if its serializer produces text, so assert that directly rather
// than pinning the one id that happened to be wrong.
describe("clipboard-capable export formats", () => {
  it("produces non-empty text for every format except the binary workbook", () => {
    for (const format of resultExportFormats) {
      const { content } = buildResultExport(result, format.id);
      if (format.id === "xlsx") {
        expect(content).toBe("");
      } else {
        expect(content.length, `${format.id} serialized empty`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("keeps excel serializing real content, since it is the copyable one", () => {
    const { content } = buildResultExport(result, "excel");
    expect(content).toContain("<table");
    expect(content).toContain("id");
  });
});
