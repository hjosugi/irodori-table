import { describe, expect, it } from "vitest";
import { normalizeCell, resultFromSqlJsExec } from "./result";

describe("normalizeCell", () => {
  it("keeps primitive cells and renders bytes as hex", () => {
    expect(normalizeCell("a")).toBe("a");
    expect(normalizeCell(12)).toBe(12);
    expect(normalizeCell(null)).toBeNull();
    expect(normalizeCell(new Uint8Array([1, 10, 255]))).toBe("0x010aff");
  });
});

describe("resultFromSqlJsExec", () => {
  it("returns the last result set and marks truncation", () => {
    const result = resultFromSqlJsExec(
      [
        { columns: ["a"], values: [[1]] },
        {
          columns: ["id", "name"],
          values: [
            [1, "one"],
            [2, "two"],
            [3, "three"],
          ],
        },
      ],
      2,
      0,
      12,
    );

    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([
      [1, "one"],
      [2, "two"],
    ]);
    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.resultSets).toHaveLength(2);
  });
});
