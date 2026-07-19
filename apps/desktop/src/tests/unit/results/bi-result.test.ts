import { describe, expect, it } from "vitest";
import { buildChartResultModel } from "@/features/results/chart-result";
import { buildBiResultSummary } from "@/features/results/bi-result";
import type { QueryResultSet } from "@/generated/irodori-api";

function resultSet(): QueryResultSet {
  return {
    statementIndex: 0,
    statement: "select day, region, revenue from daily_revenue",
    columns: ["day", "region", "revenue"],
    rows: [
      ["2026-06-20", "east", 1200],
      ["2026-06-21", "west", 900],
      ["2026-06-22", "east", 1500],
    ],
    rowCount: 3n,
    elapsedMs: 42n,
    truncated: false,
  };
}

describe("BI result summary", () => {
  it("classifies BI fields from the chart model", () => {
    const result = resultSet();
    const chart = buildChartResultModel(result.columns, result.rows);
    const summary = buildBiResultSummary(result, chart);

    expect(summary).toMatchObject({
      rowCountLabel: "3 rows",
      columnCountLabel: "3 columns",
      elapsedLabel: "42 ms",
      statusLabel: "current result",
    });
    expect(
      summary?.profiles.map((profile) => [profile.name, profile.role]),
    ).toEqual([
      ["day", "time"],
      ["region", "dimension"],
      ["revenue", "measure"],
    ]);
  });

  it("formats summary numbers in the requested app locale", () => {
    const result = { ...resultSet(), rowCount: 1234567n, elapsedMs: 1500n };
    const summary = buildBiResultSummary(result, null, "de-DE");

    expect(summary?.rowCountLabel).toBe("1.234.567 rows");
    expect(summary?.elapsedLabel).toBe("1,5 s");
  });

  it("keeps raw field profiles when no chart model exists", () => {
    const summary = buildBiResultSummary(resultSet(), null);

    expect(summary?.sampleLabel).toBeNull();
    expect(summary?.profiles).toEqual([
      expect.objectContaining({ name: "day", role: "field" }),
      expect.objectContaining({ name: "region", role: "field" }),
      expect.objectContaining({ name: "revenue", role: "field" }),
    ]);
  });
});
