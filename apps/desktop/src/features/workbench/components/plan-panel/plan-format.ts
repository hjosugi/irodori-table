import { currentAppLocale } from "@/features/preferences";
import type {
  QueryPlanAnalysis,
  QueryPlanCopyFormat,
  QueryPlanFinding,
  QueryPlanNode,
} from "@/generated/irodori-api";

export const severityRank: Record<QueryPlanFinding["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function nodeMetricLine(node: QueryPlanNode) {
  return [
    node.estimatedRows !== undefined
      ? `est ${formatMaybe(node.estimatedRows)}`
      : "",
    node.actualRows !== undefined
      ? `actual ${formatMaybe(node.actualRows)}`
      : "",
    node.totalCost !== undefined ? `cost ${formatMaybe(node.totalCost)}` : "",
    node.actualTotalMs !== undefined
      ? `${formatMaybe(node.actualTotalMs)} ms`
      : "",
    `impact ${formatPercent(node.impactScore)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function nodeCopyFormat(
  node: QueryPlanNode,
  findings: QueryPlanFinding[],
): QueryPlanCopyFormat {
  const lines = [
    `# ${node.operation}`,
    "",
    `- Label: ${node.label}`,
    node.object ? `- Object: ${node.object}` : "",
    `- Impact: ${formatPercent(node.impactScore)}`,
    nodeMetricLine(node) ? `- Metrics: ${nodeMetricLine(node)}` : "",
  ].filter(Boolean);

  if (findings.length > 0) {
    lines.push("", "## Findings");
    findings.forEach((finding) => {
      lines.push(`- ${finding.title}: ${finding.action}`);
    });
  }

  if (node.properties && node.properties.length > 0) {
    lines.push("", "## Properties");
    node.properties.forEach((property) => {
      lines.push(`- ${property.name}: ${property.value}`);
    });
  }

  if (node.notes && node.notes.length > 0) {
    lines.push("", "## Notes");
    node.notes.forEach((note) => lines.push(`- ${note}`));
  }

  return {
    label: "Selected Node",
    mimeType: "text/markdown",
    content: lines.join("\n"),
  };
}

export function sourceLabel(source: QueryPlanAnalysis["source"]) {
  switch (source) {
    case "native":
      return "Native";
    case "nativeWithStaticAnalysis":
      return "Native + static checks";
    case "staticAnalysis":
      return "Static fallback";
  }
}

/** Format a plan metric in the app locale (not the OS locale). */
export function formatMaybe(
  value: number | undefined,
  locale: string = currentAppLocale(),
) {
  if (value === undefined || Number.isNaN(value)) {
    return "";
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(locale, { maximumFractionDigits: 1 });
  }
  return value.toLocaleString(locale, { maximumFractionDigits: 3 });
}

export function formatMs(
  value: number | undefined,
  locale: string = currentAppLocale(),
) {
  const formatted = formatMaybe(value, locale);
  return formatted ? `${formatted} ms` : "";
}

export function formatPercent(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) {
    return "";
  }
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}
