import { currentAppLocale } from "@/features/preferences";
import type { QueryResultSet } from "@/generated/irodori-api";
import type { ChartResultColumn, ChartResultModel } from "./chart-result";
import { toCount } from "./result-format";

export const biColumnRoles = ["dimension", "measure", "time", "field"] as const;

export type BiColumnRole = (typeof biColumnRoles)[number];

export type BiColumnProfile = {
  index: number;
  name: string;
  role: BiColumnRole;
  filledLabel: string;
  distinctLabel: string | null;
  kindLabel: string;
};

export type BiResultSummary = {
  rowCountLabel: string;
  columnCountLabel: string;
  elapsedLabel: string;
  sampleLabel: string | null;
  statusLabel: string;
  profiles: BiColumnProfile[];
};

export function buildBiResultSummary(
  result: QueryResultSet | null,
  chartModel: ChartResultModel | null,
  locale: string = currentAppLocale(),
): BiResultSummary | null {
  if (!result) {
    return null;
  }

  const profiles = chartModel
    ? chartModel.columns.map((column) => profileFromChartColumn(column, locale))
    : result.columns.map((name, index) => ({
        index,
        name,
        role: "field" as const,
        filledLabel: "not sampled",
        distinctLabel: null,
        kindLabel: "field",
      }));

  return {
    rowCountLabel: `${toCount(result.rowCount, locale)} rows`,
    columnCountLabel: `${toCount(result.columns.length, locale)} columns`,
    elapsedLabel: formatElapsed(result.elapsedMs, locale),
    sampleLabel: chartModel
      ? `${toCount(chartModel.sampledRows, locale)} sampled${
          chartModel.truncated
            ? ` of ${toCount(chartModel.sourceRows, locale)}`
            : ""
        }`
      : null,
    statusLabel: result.truncated ? "truncated result" : "current result",
    profiles,
  };
}

function profileFromChartColumn(
  column: ChartResultColumn,
  locale: string,
): BiColumnProfile {
  return {
    index: column.index,
    name: column.name,
    role: roleFromChartColumn(column),
    filledLabel: `${toCount(column.filledCount, locale)} filled`,
    distinctLabel:
      column.kind === "category"
        ? `${toCount(column.distinctCount, locale)} distinct`
        : null,
    kindLabel: column.kind,
  };
}

function roleFromChartColumn(column: ChartResultColumn): BiColumnRole {
  if (column.kind === "number") {
    return "measure";
  }
  if (column.kind === "date") {
    return "time";
  }
  return "dimension";
}

function formatElapsed(elapsedMs: bigint, locale: string) {
  const elapsed = Number(elapsedMs);
  if (!Number.isFinite(elapsed)) {
    return "elapsed unknown";
  }
  if (elapsed < 1_000) {
    return `${elapsed.toLocaleString(locale)} ms`;
  }
  return `${(elapsed / 1_000).toLocaleString(locale, {
    maximumFractionDigits: 2,
  })} s`;
}
