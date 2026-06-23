import { describe, expect, it } from "vitest";
import {
  dollarTagAt,
  selectedOrCurrentStatement,
  statementDelimiters,
} from "./statements";

describe("dollarTagAt", () => {
  it("matches $$ and $tag$ dollar quotes", () => {
    expect(dollarTagAt("$$body$$", 0)).toBe("$$");
    expect(dollarTagAt("$func$ x", 0)).toBe("$func$");
  });
  it("returns undefined when there is no tag", () => {
    expect(dollarTagAt("select 1", 0)).toBeUndefined();
    expect(dollarTagAt("amount $ 5", 7)).toBeUndefined();
  });
});

describe("statementDelimiters", () => {
  it("finds top-level semicolons", () => {
    expect(statementDelimiters("select 1; select 2;")).toEqual([8, 18]);
  });
  it("ignores semicolons inside single-quoted strings", () => {
    expect(statementDelimiters("select ';'; select 2")).toEqual([10]);
  });
  it("ignores semicolons inside line comments", () => {
    expect(statementDelimiters("select 1 -- a;b\n; select 2")).toEqual([16]);
  });
  it("ignores semicolons inside block comments", () => {
    expect(statementDelimiters("select /* a;b */ 1; x")).toEqual([18]);
  });
  it("ignores semicolons inside dollar-quoted bodies", () => {
    const sql =
      "create function f() returns void as $$ begin; end; $$ language plpgsql; select 1";
    expect(statementDelimiters(sql)).toHaveLength(1);
  });
});

describe("selectedOrCurrentStatement", () => {
  const sql = "select 1;\nselect 2;\nselect 3";

  it("returns the trimmed selection when one exists", () => {
    expect(selectedOrCurrentStatement(0, 8, sql)).toBe("select 1");
  });
  it("returns the statement under the caret when there is no selection", () => {
    expect(selectedOrCurrentStatement(12, 12, sql)).toBe("select 2;");
  });
  it("returns the last statement for a caret past the final delimiter", () => {
    expect(selectedOrCurrentStatement(22, 22, sql)).toBe("select 3");
  });
  it("falls back to the whole buffer when there are no delimiters", () => {
    expect(selectedOrCurrentStatement(0, 0, "select 42")).toBe("select 42");
  });
});
