export type ChartKind = "bar" | "line" | "scatter";

export type ChartColumnKind = "category" | "date" | "number";

export type ChartAggregation = "sum" | "avg" | "min" | "max" | "count";

export type ChartSort = "source" | "x" | "yDesc" | "yAsc";

export type ChartResultColumn = {
  index: number;
  name: string;
  kind: ChartColumnKind;
  filledCount: number;
  numberCount: number;
  dateCount: number;
  distinctCount: number;
};

export type ChartResultRow = {
  cells: ChartCellValue[];
};

export type ChartCellValue = {
  label: string;
  number: number | null;
  timestamp: number | null;
};

export type ChartResultSelection = {
  kind: ChartKind;
  xColumnIndex: number | null;
  yColumnIndex: number | null;
  aggregation: ChartAggregation;
  sort: ChartSort;
  limit: number;
  /** User-picked series color (`#rrggbb`), or null to use the theme default. */
  color?: string | null;
};

export type ChartResultModel = {
  columns: ChartResultColumn[];
  rows: ChartResultRow[];
  sourceRows: number;
  sampledRows: number;
  truncated: boolean;
  defaultSelection: ChartResultSelection | null;
};

export type ChartResultPoint = {
  key: string;
  label: string;
  x: number;
  y: number;
};

export type ChartResultSeries = {
  kind: ChartKind;
  aggregation: ChartAggregation;
  xLabel: string;
  yLabel: string;
  points: ChartResultPoint[];
  xDomain: [number, number];
  yDomain: [number, number];
  truncated: boolean;
};

const maxChartRows = 5_000;
const maxSeriesPoints = 200;
export const defaultChartLimit = 50;

export function buildChartResultModel(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
): ChartResultModel {
  const sampled = rows.slice(0, maxChartRows);
  const distinctByColumn = columns.map(() => new Set<string>());
  const stats = columns.map(() => ({
    filledCount: 0,
    numberCount: 0,
    dateCount: 0,
  }));
  const chartRows: ChartResultRow[] = sampled.map((row) => {
    const cells = columns.map((_, columnIndex) => {
      const cell = parseChartCell(row[columnIndex]);
      if (cell.label) {
        stats[columnIndex].filledCount += 1;
        if (distinctByColumn[columnIndex].size < 1_000) {
          distinctByColumn[columnIndex].add(cell.label);
        }
      }
      if (cell.number !== null) {
        stats[columnIndex].numberCount += 1;
      }
      if (cell.timestamp !== null) {
        stats[columnIndex].dateCount += 1;
      }
      return cell;
    });
    return { cells };
  });
  const chartColumns = columns.map((name, index): ChartResultColumn => {
    const columnStats = stats[index];
    return {
      index,
      name,
      kind: inferColumnKind(columnStats),
      filledCount: columnStats.filledCount,
      numberCount: columnStats.numberCount,
      dateCount: columnStats.dateCount,
      distinctCount: distinctByColumn[index].size,
    };
  });
  return {
    columns: chartColumns,
    rows: chartRows,
    sourceRows: rows.length,
    sampledRows: sampled.length,
    truncated: sampled.length < rows.length,
    defaultSelection: defaultSelection(chartColumns),
  };
}

export function buildChartResultSeries(
  model: ChartResultModel,
  selection: ChartResultSelection,
): ChartResultSeries {
  const yColumn =
    selection.yColumnIndex === null
      ? null
      : model.columns[selection.yColumnIndex];
  const xColumn =
    selection.xColumnIndex === null
      ? null
      : model.columns[selection.xColumnIndex];
  const rawPoints =
    selection.kind === "scatter"
      ? buildScatterPoints(model, selection, xColumn)
      : buildGroupedPoints(model, selection, xColumn);
  const sortedPoints = sortChartPoints(rawPoints, selection.sort);
  const ordinalX = selection.kind !== "scatter" && xColumn?.kind !== "date";
  const points = ordinalX
    ? sortedPoints.map((point, index) => ({ ...point, x: index }))
    : sortedPoints;
  const limit = clampLimit(selection.limit);
  const limitedPoints = points.slice(0, limit);
  const xDomain = domain(
    limitedPoints.map((point) => point.x),
    selection.kind !== "scatter",
  );
  const yDomain = domain(
    limitedPoints.map((point) => point.y),
    true,
  );
  return {
    kind: selection.kind,
    aggregation: selection.aggregation,
    xLabel: xColumn?.name ?? "Row",
    yLabel: metricLabel(selection.aggregation, yColumn?.name),
    points: limitedPoints,
    xDomain,
    yDomain,
    truncated: model.truncated || limitedPoints.length < points.length,
  };
}

export function chartSelectionIsValid(
  model: ChartResultModel,
  selection: ChartResultSelection | null,
): selection is ChartResultSelection {
  if (!selection) {
    return false;
  }
  const yColumn =
    selection.yColumnIndex === null
      ? null
      : model.columns[selection.yColumnIndex];
  const xColumn =
    selection.xColumnIndex === null
      ? null
      : model.columns[selection.xColumnIndex];
  if (selection.xColumnIndex !== null && !xColumn) {
    return false;
  }
  if (selection.kind === "scatter") {
    if (!yColumn || yColumn.kind !== "number") {
      return false;
    }
    if (xColumn && xColumn.kind !== "number") {
      return false;
    }
    return true;
  }
  if (
    selection.aggregation !== "count" &&
    (!yColumn || yColumn.kind !== "number")
  ) {
    return false;
  }
  return true;
}

function parseChartCell(value: unknown): ChartCellValue {
  const label = formatCellLabel(value);
  return {
    label,
    number: parseFiniteNumber(value),
    timestamp: parseTimestamp(value),
  };
}

function formatCellLabel(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || /^null$/i.test(trimmed)) {
    return null;
  }
  const normalized = trimmed.replace(/,/g, "");
  if (!/^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
    return null;
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (
    !text ||
    !/[/-]|T|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(
      text,
    )
  ) {
    return null;
  }
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function inferColumnKind(stats: {
  filledCount: number;
  numberCount: number;
  dateCount: number;
}): ChartColumnKind {
  const threshold = Math.max(2, Math.ceil(stats.filledCount * 0.7));
  if (stats.numberCount >= threshold) {
    return "number";
  }
  if (stats.dateCount >= threshold) {
    return "date";
  }
  return "category";
}

function defaultSelection(
  columns: readonly ChartResultColumn[],
): ChartResultSelection | null {
  if (columns.length === 0) {
    return null;
  }
  const measures = columns.filter((column) => column.kind === "number");
  const timeDimension = columns.find((column) => column.kind === "date");
  const categoryDimension = columns.find(
    (column) => column.kind === "category" && column.distinctCount <= 80,
  );
  if (timeDimension) {
    return {
      kind: "line",
      xColumnIndex: timeDimension.index,
      yColumnIndex: measures[0]?.index ?? null,
      aggregation: measures[0] ? "sum" : "count",
      sort: "x",
      limit: defaultChartLimit,
    };
  }
  if (categoryDimension) {
    return {
      kind: "bar",
      xColumnIndex: categoryDimension.index,
      yColumnIndex: measures[0]?.index ?? null,
      aggregation: measures[0] ? "sum" : "count",
      sort: "yDesc",
      limit: defaultChartLimit,
    };
  }
  if (measures.length > 1) {
    return {
      kind: "scatter",
      xColumnIndex: measures[0].index,
      yColumnIndex: measures[1].index,
      aggregation: "sum",
      sort: "source",
      limit: defaultChartLimit,
    };
  }
  return {
    kind: "bar",
    xColumnIndex: null,
    yColumnIndex: measures[0]?.index ?? null,
    aggregation: measures[0] ? "sum" : "count",
    sort: "source",
    limit: defaultChartLimit,
  };
}

function buildScatterPoints(
  model: ChartResultModel,
  selection: ChartResultSelection,
  xColumn: ChartResultColumn | null,
): ChartResultPoint[] {
  return model.rows.flatMap((row, rowIndex): ChartResultPoint[] => {
    const y =
      selection.yColumnIndex === null
        ? null
        : row.cells[selection.yColumnIndex]?.number;
    const x = xColumn ? row.cells[xColumn.index]?.number : rowIndex + 1;
    if (x === null || x === undefined || y === null || y === undefined) {
      return [];
    }
    return [
      {
        key: String(rowIndex),
        label: xColumn
          ? row.cells[xColumn.index]?.label || String(rowIndex + 1)
          : String(rowIndex + 1),
        x,
        y,
      },
    ];
  });
}

function buildGroupedPoints(
  model: ChartResultModel,
  selection: ChartResultSelection,
  xColumn: ChartResultColumn | null,
): ChartResultPoint[] {
  if (!xColumn) {
    return model.rows.flatMap((row, rowIndex): ChartResultPoint[] => {
      const y = rowMetricValue(row, selection);
      if (y === null || y === undefined) {
        return [];
      }
      return [
        {
          key: String(rowIndex),
          label: String(rowIndex + 1),
          x: rowIndex,
          y,
        },
      ];
    });
  }

  const groups = new Map<
    string,
    {
      label: string;
      sortValue: number;
      sourceIndex: number;
      sum: number;
      count: number;
      min: number;
      max: number;
    }
  >();
  model.rows.forEach((row, rowIndex) => {
    const y = rowMetricValue(row, selection);
    if (y === null || y === undefined) {
      return;
    }
    const xCell = row.cells[xColumn.index];
    const label = xCell?.label || "(blank)";
    const sortValue =
      xColumn.kind === "date" &&
      xCell?.timestamp !== null &&
      xCell?.timestamp !== undefined
        ? xCell.timestamp
        : groups.size;
    const current = groups.get(label);
    if (current) {
      current.sum += y;
      current.count += 1;
      current.min = Math.min(current.min, y);
      current.max = Math.max(current.max, y);
      return;
    }
    groups.set(label, {
      label,
      sortValue: xColumn.kind === "date" ? sortValue : rowIndex,
      sourceIndex: rowIndex,
      sum: y,
      count: 1,
      min: y,
      max: y,
    });
  });
  return [...groups.entries()].map(([key, group], index) => ({
    key,
    label: group.label,
    x: xColumn.kind === "date" ? group.sortValue : index,
    y: aggregateGroup(group, selection.aggregation),
    sourceIndex: group.sourceIndex,
  }));
}

function rowMetricValue(
  row: ChartResultRow,
  selection: ChartResultSelection,
): number | null {
  if (selection.aggregation === "count") {
    return 1;
  }
  if (selection.yColumnIndex === null) {
    return null;
  }
  return row.cells[selection.yColumnIndex]?.number ?? null;
}

function aggregateGroup(
  group: { sum: number; count: number; min: number; max: number },
  aggregation: ChartAggregation,
) {
  switch (aggregation) {
    case "avg":
      return group.count === 0 ? 0 : group.sum / group.count;
    case "min":
      return group.min;
    case "max":
      return group.max;
    case "count":
      return group.count;
    default:
      return group.sum;
  }
}

function sortChartPoints(
  points: readonly (ChartResultPoint & { sourceIndex?: number })[],
  sort: ChartSort,
): ChartResultPoint[] {
  const sorted = [...points];
  switch (sort) {
    case "x":
      sorted.sort((left, right) => left.x - right.x);
      break;
    case "yDesc":
      sorted.sort((left, right) => right.y - left.y);
      break;
    case "yAsc":
      sorted.sort((left, right) => left.y - right.y);
      break;
    default:
      sorted.sort(
        (left, right) => (left.sourceIndex ?? 0) - (right.sourceIndex ?? 0),
      );
      break;
  }
  return sorted.map(({ sourceIndex: _sourceIndex, ...point }) => point);
}

function metricLabel(aggregation: ChartAggregation, columnName?: string) {
  if (aggregation === "count") {
    return "Count";
  }
  const name = columnName ?? "Value";
  switch (aggregation) {
    case "avg":
      return `Avg ${name}`;
    case "min":
      return `Min ${name}`;
    case "max":
      return `Max ${name}`;
    default:
      return `Sum ${name}`;
  }
}

function clampLimit(value: number) {
  if (!Number.isFinite(value)) {
    return defaultChartLimit;
  }
  return Math.min(maxSeriesPoints, Math.max(1, Math.floor(value)));
}

function domain(
  values: readonly number[],
  includeZero: boolean,
): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return includeZero ? [0, 1] : [0, 1];
  }
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    const pad = Math.abs(min || 1) * 0.1;
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}
