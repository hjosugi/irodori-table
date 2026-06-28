import { useEffect, useMemo, useState } from "react";
import { Maximize2 } from "lucide-react";
import {
  buildChartResultSeries,
  chartSelectionIsValid,
  defaultChartLimit,
  type ChartAggregation,
  type ChartResultColumn,
  type ChartKind,
  type ChartResultModel,
  type ChartResultPoint,
  type ChartResultSelection,
  type ChartResultSeries,
  type ChartSort,
} from "../chart-result";

const svgWidth = 920;
const svgHeight = 380;
const margin = { top: 24, right: 28, bottom: 62, left: 64 };
const plotWidth = svgWidth - margin.left - margin.right;
const plotHeight = svgHeight - margin.top - margin.bottom;

export function ChartResultView({ model }: { model: ChartResultModel }) {
  const [selection, setSelection] = useState<ChartResultSelection | null>(
    model.defaultSelection,
  );
  const [windowOpen, setWindowOpen] = useState(false);

  useEffect(() => {
    setSelection(model.defaultSelection);
  }, [model]);

  const effectiveSelection = chartSelectionIsValid(model, selection)
    ? selection
    : model.defaultSelection;
  const series = useMemo(
    () =>
      effectiveSelection
        ? buildChartResultSeries(model, effectiveSelection)
        : null,
    [effectiveSelection, model],
  );
  const numericColumns = model.columns.filter(
    (column) => column.kind === "number",
  );
  const xColumns =
    effectiveSelection?.kind === "scatter"
      ? numericColumns
      : model.columns.filter(
          (column) => column.index !== effectiveSelection?.yColumnIndex,
        );

  function updateSelection(patch: Partial<ChartResultSelection>) {
    const base = effectiveSelection ?? model.defaultSelection;
    if (!base) {
      return;
    }
    const next = normalizeSelection(model, { ...base, ...patch });
    setSelection(next);
  }

  if (!effectiveSelection || !series) {
    return (
      <div className="chart-result-empty">
        No numeric columns available for charting
      </div>
    );
  }

  return (
    <div className="chart-result-view">
      <ChartToolbar
        model={model}
        series={series}
        selection={effectiveSelection}
        numericColumns={numericColumns}
        xColumns={xColumns}
        onUpdateSelection={updateSelection}
        onOpenWindow={() => setWindowOpen(true)}
      />
      <ChartCanvas series={series} />
      {windowOpen ? (
        <div
          className="palette-overlay chart-window-overlay"
          onClick={() => setWindowOpen(false)}
          role="presentation"
        >
          <div
            className="chart-window"
            role="dialog"
            aria-label="Chart window"
            onClick={(event) => event.stopPropagation()}
          >
            <ChartToolbar
              model={model}
              series={series}
              selection={effectiveSelection}
              numericColumns={numericColumns}
              xColumns={xColumns}
              onUpdateSelection={updateSelection}
              onCloseWindow={() => setWindowOpen(false)}
              windowed
            />
            <ChartCanvas series={series} windowed />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChartToolbar({
  model,
  series,
  selection,
  numericColumns,
  xColumns,
  windowed = false,
  onUpdateSelection,
  onOpenWindow,
  onCloseWindow,
}: {
  model: ChartResultModel;
  series: ChartResultSeries;
  selection: ChartResultSelection;
  numericColumns: ChartResultColumn[];
  xColumns: ChartResultColumn[];
  windowed?: boolean;
  onUpdateSelection: (patch: Partial<ChartResultSelection>) => void;
  onOpenWindow?: () => void;
  onCloseWindow?: () => void;
}) {
  return (
    <div
      className={
        windowed
          ? "chart-result-toolbar chart-window-toolbar"
          : "chart-result-toolbar"
      }
    >
      <strong>{windowed ? "Chart Window" : "Chart"}</strong>
      <div
        className="segmented-control chart-kind-toggle"
        aria-label="Chart type"
      >
        {(["bar", "line", "scatter"] as const).map((kind) => (
          <button
            type="button"
            key={kind}
            className={selection.kind === kind ? "active" : undefined}
            disabled={kind === "scatter" && numericColumns.length === 0}
            onClick={() => onUpdateSelection({ kind })}
          >
            {chartKindLabel(kind)}
          </button>
        ))}
      </div>
      <label>
        <span>X</span>
        <select
          value={selection.xColumnIndex ?? "row"}
          onChange={(event) =>
            onUpdateSelection({
              xColumnIndex:
                event.currentTarget.value === "row"
                  ? null
                  : Number(event.currentTarget.value),
            })
          }
        >
          <option value="row">Row</option>
          {xColumns.map((column) => (
            <option key={column.index} value={column.index}>
              {column.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{selection.kind === "scatter" ? "Y" : "Metric"}</span>
        <select
          value={
            selection.aggregation === "count"
              ? "count"
              : (selection.yColumnIndex ?? "count")
          }
          onChange={(event) =>
            onUpdateSelection(
              event.currentTarget.value === "count"
                ? { aggregation: "count", yColumnIndex: null }
                : {
                    aggregation:
                      selection.aggregation === "count"
                        ? "sum"
                        : selection.aggregation,
                    yColumnIndex: Number(event.currentTarget.value),
                  },
            )
          }
        >
          {selection.kind !== "scatter" ? (
            <option value="count">Count rows</option>
          ) : null}
          {numericColumns.map((column) => (
            <option key={column.index} value={column.index}>
              {column.name}
            </option>
          ))}
        </select>
      </label>
      {selection.kind !== "scatter" ? (
        <label>
          <span>Agg</span>
          <select
            value={selection.aggregation}
            disabled={selection.aggregation === "count"}
            onChange={(event) =>
              onUpdateSelection({
                aggregation: event.currentTarget.value as ChartAggregation,
              })
            }
          >
            <option value="sum">Sum</option>
            <option value="avg">Avg</option>
            <option value="min">Min</option>
            <option value="max">Max</option>
          </select>
        </label>
      ) : null}
      <label>
        <span>Sort</span>
        <select
          value={selection.sort}
          onChange={(event) =>
            onUpdateSelection({ sort: event.currentTarget.value as ChartSort })
          }
        >
          <option value="source">Source</option>
          <option value="x">X</option>
          <option value="yDesc">Y desc</option>
          <option value="yAsc">Y asc</option>
        </select>
      </label>
      <label>
        <span>Limit</span>
        <select
          value={selection.limit}
          onChange={(event) =>
            onUpdateSelection({ limit: Number(event.currentTarget.value) })
          }
        >
          {[10, 25, 50, 100, 200].map((limit) => (
            <option key={limit} value={limit}>
              {limit}
            </option>
          ))}
        </select>
      </label>
      <span>
        {model.sampledRows.toLocaleString()} rows
        {model.truncated
          ? ` sampled of ${model.sourceRows.toLocaleString()}`
          : ""}
        {series.truncated ? " · series limited" : ""}
      </span>
      {windowed ? (
        <button className="text-button" type="button" onClick={onCloseWindow}>
          Close
        </button>
      ) : (
        <button
          className="text-button"
          type="button"
          onClick={onOpenWindow}
          title="Open chart window"
        >
          <Maximize2 size={13} />
          <span>Open</span>
        </button>
      )}
    </div>
  );
}

function ChartCanvas({
  series,
  windowed = false,
}: {
  series: ChartResultSeries;
  windowed?: boolean;
}) {
  return (
    <div
      className={
        windowed
          ? "chart-result-canvas chart-window-canvas"
          : "chart-result-canvas"
      }
    >
      <svg
        className="chart-result-svg"
        role="img"
        aria-label={`${chartKindLabel(series.kind)} chart of ${series.yLabel} by ${series.xLabel}`}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      >
        <ChartAxes series={series} />
        {series.kind === "bar" ? <BarSeries series={series} /> : null}
        {series.kind === "line" ? <LineSeries series={series} /> : null}
        {series.kind === "scatter" ? <ScatterSeries series={series} /> : null}
      </svg>
    </div>
  );
}

function normalizeSelection(
  model: ChartResultModel,
  selection: ChartResultSelection,
): ChartResultSelection {
  const numericColumns = model.columns.filter(
    (column) => column.kind === "number",
  );
  const limit = normalizeLimit(selection.limit);
  const sort = selection.sort ?? defaultSort(selection.kind);
  if (selection.kind === "scatter") {
    const yColumn = numericColumns.some(
      (column) => column.index === selection.yColumnIndex,
    )
      ? selection.yColumnIndex
      : numericColumns[0]?.index;
    if (yColumn === undefined) {
      return { ...selection, aggregation: "sum", limit, sort };
    }
    const xColumn = model.columns[selection.xColumnIndex ?? -1];
    return {
      ...selection,
      aggregation: "sum",
      xColumnIndex:
        !xColumn || xColumn.kind === "number" ? selection.xColumnIndex : null,
      yColumnIndex: yColumn,
      limit,
      sort,
    };
  }
  if (selection.aggregation === "count") {
    return { ...selection, yColumnIndex: null, limit, sort };
  }
  const yColumn = numericColumns.some(
    (column) => column.index === selection.yColumnIndex,
  )
    ? selection.yColumnIndex
    : numericColumns[0]?.index;
  if (yColumn === undefined) {
    return {
      ...selection,
      aggregation: "count",
      yColumnIndex: null,
      limit,
      sort,
    };
  }
  return {
    ...selection,
    yColumnIndex: yColumn,
    limit,
    sort,
  };
}

function normalizeLimit(value: number) {
  return [10, 25, 50, 100, 200].includes(value) ? value : defaultChartLimit;
}

function defaultSort(kind: ChartKind): ChartSort {
  return kind === "line" ? "x" : "source";
}

function ChartAxes({ series }: { series: ChartResultSeries }) {
  const yTicks = ticks(series.yDomain, 4);
  const xTicks = axisPoints(series);
  return (
    <g className="chart-result-axes">
      {yTicks.map((tick) => {
        const y = scale(
          tick,
          series.yDomain,
          margin.top + plotHeight,
          margin.top,
        );
        return (
          <g key={tick} transform={`translate(0 ${round(y)})`}>
            <line x1={margin.left} x2={margin.left + plotWidth} />
            <text x={margin.left - 10} y="4">
              {formatCompact(tick)}
            </text>
          </g>
        );
      })}
      <line
        className="chart-result-axis-line"
        x1={margin.left}
        y1={margin.top + plotHeight}
        x2={margin.left + plotWidth}
        y2={margin.top + plotHeight}
      />
      <line
        className="chart-result-axis-line"
        x1={margin.left}
        y1={margin.top}
        x2={margin.left}
        y2={margin.top + plotHeight}
      />
      {xTicks.map(({ point, index }) => {
        const x = xPosition(series, point, index);
        return (
          <text
            className="chart-result-x-label"
            key={`${point.key}:${index}`}
            x={round(x)}
            y={margin.top + plotHeight + 24}
          >
            {truncate(point.label, 14)}
          </text>
        );
      })}
      <text className="chart-result-axis-title" x={margin.left} y={18}>
        {series.yLabel}
      </text>
      <text
        className="chart-result-axis-title"
        x={margin.left + plotWidth}
        y={svgHeight - 12}
      >
        {series.xLabel}
      </text>
    </g>
  );
}

function BarSeries({ series }: { series: ChartResultSeries }) {
  const baseline = scale(
    0,
    series.yDomain,
    margin.top + plotHeight,
    margin.top,
  );
  const step = plotWidth / Math.max(1, series.points.length);
  const barWidth = Math.max(3, Math.min(44, step * 0.68));
  return (
    <g className="chart-result-bars">
      {series.points.map((point, index) => {
        const x = xPosition(series, point, index) - barWidth / 2;
        const y = scale(
          point.y,
          series.yDomain,
          margin.top + plotHeight,
          margin.top,
        );
        const top = Math.min(y, baseline);
        const height = Math.max(1, Math.abs(baseline - y));
        return (
          <rect
            key={point.key}
            x={round(x)}
            y={round(top)}
            width={round(barWidth)}
            height={round(height)}
          >
            <title>{`${point.label}: ${formatCompact(point.y)}`}</title>
          </rect>
        );
      })}
    </g>
  );
}

function LineSeries({ series }: { series: ChartResultSeries }) {
  const path = series.points
    .map((point, index) => {
      const x = xPosition(series, point, index);
      const y = scale(
        point.y,
        series.yDomain,
        margin.top + plotHeight,
        margin.top,
      );
      return `${index === 0 ? "M" : "L"} ${round(x)} ${round(y)}`;
    })
    .join(" ");
  return (
    <g className="chart-result-line-series">
      <path d={path} />
      {series.points.map((point, index) => (
        <circle
          key={point.key}
          cx={round(xPosition(series, point, index))}
          cy={round(
            scale(point.y, series.yDomain, margin.top + plotHeight, margin.top),
          )}
          r="3.5"
        >
          <title>{`${point.label}: ${formatCompact(point.y)}`}</title>
        </circle>
      ))}
    </g>
  );
}

function ScatterSeries({ series }: { series: ChartResultSeries }) {
  return (
    <g className="chart-result-scatter-series">
      {series.points.map((point, index) => (
        <circle
          key={point.key}
          cx={round(xPosition(series, point, index))}
          cy={round(
            scale(point.y, series.yDomain, margin.top + plotHeight, margin.top),
          )}
          r="4"
        >
          <title>{`${series.xLabel}: ${formatCompact(point.x)}, ${series.yLabel}: ${formatCompact(point.y)}`}</title>
        </circle>
      ))}
    </g>
  );
}

function xPosition(
  series: ChartResultSeries,
  point: ChartResultPoint,
  index: number,
) {
  if (series.kind === "scatter") {
    return scale(point.x, series.xDomain, margin.left, margin.left + plotWidth);
  }
  if (series.points.length <= 1) {
    return margin.left + plotWidth / 2;
  }
  if (series.xDomain[1] - series.xDomain[0] > series.points.length * 2) {
    return scale(point.x, series.xDomain, margin.left, margin.left + plotWidth);
  }
  return margin.left + ((index + 0.5) / series.points.length) * plotWidth;
}

function axisPoints(series: ChartResultSeries) {
  const maxLabels = 8;
  const step = Math.max(1, Math.ceil(series.points.length / maxLabels));
  return series.points
    .map((point, index) => ({ point, index }))
    .filter((_, index) => index % step === 0);
}

function ticks(domain: [number, number], count: number) {
  const [min, max] = domain;
  const step = (max - min) / Math.max(1, count);
  return Array.from({ length: count + 1 }, (_, index) => min + step * index);
}

function scale(
  value: number,
  domain: [number, number],
  rangeStart: number,
  rangeEnd: number,
) {
  const span = domain[1] - domain[0] || 1;
  const ratio = (value - domain[0]) / span;
  return rangeStart + ratio * (rangeEnd - rangeStart);
}

function chartKindLabel(kind: ChartKind) {
  switch (kind) {
    case "line":
      return "Line";
    case "scatter":
      return "Scatter";
    default:
      return "Bar";
  }
}

function formatCompact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${round(value / 1_000_000)}M`;
  }
  if (abs >= 1_000) {
    return `${round(value / 1_000)}k`;
  }
  return String(round(value));
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 3)}...`
    : value;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
