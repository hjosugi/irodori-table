import { describe, expect, it } from "vitest";
import {
  findSqlFile,
  hasDraggedFiles,
  isSqlFileName,
} from "@/features/query-editor/drag-drop";

describe("query editor SQL file drag/drop", () => {
  it("accepts SQL files by filename extension", () => {
    expect(isSqlFileName("query.sql")).toBe(true);
    expect(isSqlFileName("query.SQL")).toBe(true);
    expect(isSqlFileName("backup.query.Sql")).toBe(true);
  });

  it("rejects non-SQL filenames", () => {
    expect(isSqlFileName("query.sql.txt")).toBe(false);
    expect(isSqlFileName("query")).toBe(false);
    expect(isSqlFileName("")).toBe(false);
  });

  it("finds the first SQL file candidate", () => {
    const files = [
      { name: "notes.txt" },
      { name: "statement.sql" },
      { name: "other.sql" },
    ];

    expect(findSqlFile(files)).toBe(files[1]);
  });

  it("detects dragged files from data transfer items or types", () => {
    expect(
      hasDraggedFiles({
        items: [{ kind: "file" }],
        types: [],
      } as unknown as DataTransfer),
    ).toBe(true);
    expect(
      hasDraggedFiles({
        items: [],
        types: ["Files"],
      } as unknown as DataTransfer),
    ).toBe(true);
    expect(
      hasDraggedFiles({
        items: [{ kind: "string" }],
        types: ["text/plain"],
      } as unknown as DataTransfer),
    ).toBe(false);
  });
});
