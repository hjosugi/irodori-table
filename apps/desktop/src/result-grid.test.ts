import { describe, expect, it } from "vitest";
import {
  applyResultFilters,
  applyResultSort,
  cycleResultSortRules,
  type ResultGridRowLike,
} from "./result-grid";

const rows: ResultGridRowLike[] = [
  { cells: ["2", "Aster", "Tokyo", "900"] },
  { cells: ["1", "Kawase", "Osaka", "1200"] },
  { cells: ["3", "Kawase", "Tokyo", "NULL"] },
  { cells: ["4", "", "Kyoto", "12"] },
];

describe("result grid model", () => {
  it("sorts by multiple columns with numeric cell comparison", () => {
    const sorted = applyResultSort(rows, [
      { columnIndex: 1, direction: "asc" },
      { columnIndex: 3, direction: "desc" },
    ]);

    expect(sorted.map((row) => row.cells[0])).toEqual(["4", "2", "1", "3"]);
  });

  it("cycles additive and replacement sort rules", () => {
    expect(cycleResultSortRules([], 1, false)).toEqual([
      { columnIndex: 1, direction: "asc" },
    ]);
    expect(
      cycleResultSortRules([{ columnIndex: 1, direction: "asc" }], 2, true),
    ).toEqual([
      { columnIndex: 1, direction: "asc" },
      { columnIndex: 2, direction: "asc" },
    ]);
    expect(
      cycleResultSortRules([{ columnIndex: 1, direction: "desc" }], 1, false),
    ).toEqual([]);
  });

  it("filters with quick text, column rules, and join modes", () => {
    expect(applyResultFilters(rows, [], "tok", "and")).toHaveLength(2);
    expect(
      applyResultFilters(
        rows,
        [
          {
            id: "city",
            columnIndex: 2,
            operator: "equals",
            value: "tokyo",
            enabled: true,
          },
          {
            id: "name",
            columnIndex: 1,
            operator: "equals",
            value: "kawase",
            enabled: true,
          },
        ],
        "",
        "and",
      ).map((row) => row.cells[0]),
    ).toEqual(["3"]);
    expect(
      applyResultFilters(
        rows,
        [
          {
            id: "null",
            columnIndex: 3,
            operator: "is_null",
            value: "",
            enabled: true,
          },
          {
            id: "empty",
            columnIndex: 1,
            operator: "is_empty",
            value: "",
            enabled: true,
          },
        ],
        "",
        "or",
      ).map((row) => row.cells[0]),
    ).toEqual(["3", "4"]);
  });

  it("treats invalid regex filters as no matches", () => {
    expect(
      applyResultFilters(
        rows,
        [
          {
            id: "bad-regex",
            columnIndex: "any",
            operator: "regex",
            value: "[",
            enabled: true,
          },
        ],
        "",
        "and",
      ),
    ).toHaveLength(0);
  });
});
