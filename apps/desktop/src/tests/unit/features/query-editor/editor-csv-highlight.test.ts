import { describe, expect, it } from "vitest";
import {
  tokenizeDelimited,
  type DelimitedField,
} from "@/features/query-editor/editor-csv-highlight";

function fieldText(text: string, field: DelimitedField): string {
  return text.slice(field.from, field.to);
}

describe("tokenizeDelimited", () => {
  it("splits plain CSV into per-record columns with a header record", () => {
    const text = "id,name,city\n1,Alice,Berlin\n";
    const fields = tokenizeDelimited(text, ",");
    expect(
      fields.map((field) => [
        fieldText(text, field),
        field.column,
        field.record,
      ]),
    ).toEqual([
      ["id", 0, 0],
      ["name", 1, 0],
      ["city", 2, 0],
      ["1", 0, 1],
      ["Alice", 1, 1],
      ["Berlin", 2, 1],
    ]);
  });

  it("keeps quoted delimiters and escaped quotes inside one field", () => {
    const text = 'a,"x, y",\"he said \"\"hi\"\"\",b';
    const fields = tokenizeDelimited(text, ",");
    expect(fields.map((field) => fieldText(text, field))).toEqual([
      "a",
      '"x, y"',
      '"he said ""hi"""',
      "b",
    ]);
    expect(fields.map((field) => field.column)).toEqual([0, 1, 2, 3]);
  });

  it("keeps newlines inside quoted fields in the same record", () => {
    const text = 'a,"line one\nline two",c\nnext,row,here';
    const fields = tokenizeDelimited(text, ",");
    expect(fields.map((field) => [field.column, field.record])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(fieldText(text, fields[1])).toBe('"line one\nline two"');
  });

  it("supports tab-delimited text with commas as plain content", () => {
    const text = "id\tnote\n1\tuses, commas";
    const fields = tokenizeDelimited(text, "\t");
    expect(fields.map((field) => fieldText(text, field))).toEqual([
      "id",
      "note",
      "1",
      "uses, commas",
    ]);
    expect(fields.map((field) => field.column)).toEqual([0, 1, 0, 1]);
  });

  it("reports empty fields and handles CRLF line breaks", () => {
    const text = "a,,c\r\nd,e,";
    const fields = tokenizeDelimited(text, ",");
    expect(
      fields.map((field) => [
        fieldText(text, field),
        field.column,
        field.record,
      ]),
    ).toEqual([
      ["a", 0, 0],
      ["", 1, 0],
      ["c", 2, 0],
      ["d", 0, 1],
      ["e", 1, 1],
      ["", 2, 1],
    ]);
  });
});
