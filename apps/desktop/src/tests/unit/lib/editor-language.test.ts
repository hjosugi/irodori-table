import { describe, expect, it } from "vitest";
import { editorLanguageForTabLabel } from "@/lib/editor-language";

describe("editorLanguageForTabLabel", () => {
  it("routes known extensions to their language", () => {
    expect(editorLanguageForTabLabel("scratch.sql")).toBe("sql");
    expect(editorLanguageForTabLabel("orders.csv")).toBe("csv");
    expect(editorLanguageForTabLabel("orders.tsv")).toBe("tsv");
    expect(editorLanguageForTabLabel("orders.tab")).toBe("tsv");
    expect(editorLanguageForTabLabel("server.log")).toBe("log");
    expect(editorLanguageForTabLabel("notes.txt")).toBe("text");
    expect(editorLanguageForTabLabel("notes.text")).toBe("text");
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(editorLanguageForTabLabel("ORDERS.CSV")).toBe("csv");
    expect(editorLanguageForTabLabel("  app.Log  ")).toBe("log");
  });

  it("keeps the historical SQL fallback for everything else", () => {
    expect(editorLanguageForTabLabel("scratch")).toBe("sql");
    expect(editorLanguageForTabLabel("")).toBe("sql");
    expect(editorLanguageForTabLabel("query-2")).toBe("sql");
    expect(editorLanguageForTabLabel("report.md")).toBe("sql");
    expect(editorLanguageForTabLabel("csv")).toBe("sql");
  });

  it("uses only the final extension of dotted names", () => {
    expect(editorLanguageForTabLabel("export.csv.sql")).toBe("sql");
    expect(editorLanguageForTabLabel("backup.sql.csv")).toBe("csv");
  });
});
