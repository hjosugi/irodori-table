import { describe, expect, it } from "vitest";
import {
  buildChartResultModel,
  buildChartResultSeries,
  chartSelectionIsValid,
} from "@/features/results/chart-result";

describe("chart result model", () => {
  it("selects a line chart for time-series numeric results", () => {
    const model = buildChartResultModel(
      ["day", "revenue"],
      [
        ["2026-06-01", 120],
        ["2026-06-02", 180],
        ["2026-06-03", 140],
      ],
    );

    expect(model.columns.map((column) => column.kind)).toEqual([
      "date",
      "number",
    ]);
    expect(model.defaultSelection).toEqual({
      kind: "line",
      xColumnIndex: 0,
      yColumnIndex: 1,
    });

    const series = buildChartResultSeries(model, model.defaultSelection!);
    expect(series.points.map((point) => point.y)).toEqual([120, 180, 140]);
    expect(series.xLabel).toBe("day");
    expect(series.yLabel).toBe("revenue");
  });

  it("aggregates numeric measures by category for bar charts", () => {
    const model = buildChartResultModel(
      ["region", "sales"],
      [
        ["Tokyo", "1,200"],
        ["Osaka", 900],
        ["Tokyo", 300],
        ["", null],
      ],
    );

    expect(model.defaultSelection?.kind).toBe("bar");
    const series = buildChartResultSeries(model, model.defaultSelection!);
    expect(series.points).toEqual([
      expect.objectContaining({ label: "Tokyo", y: 1_500 }),
      expect.objectContaining({ label: "Osaka", y: 900 }),
    ]);
  });

  it("uses scatter defaults when a result has multiple measures only", () => {
    const model = buildChartResultModel(
      ["orders", "revenue"],
      [
        [1, 12],
        [2, 19],
        [3, 21],
      ],
    );

    expect(model.defaultSelection).toEqual({
      kind: "scatter",
      xColumnIndex: 0,
      yColumnIndex: 1,
    });
    expect(chartSelectionIsValid(model, model.defaultSelection)).toBe(true);
    expect(
      chartSelectionIsValid(model, {
        kind: "scatter",
        xColumnIndex: 99,
        yColumnIndex: 1,
      }),
    ).toBe(false);
  });
});
