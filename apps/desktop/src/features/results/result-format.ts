import type { QueryHistoryResultSnapshot } from "@/features/query-history";
import { currentAppLocale } from "@/features/preferences";
import type { QueryResult } from "@/generated/irodori-api";
import type { ResultSelectionSummary } from "./result-selection";

/** Format a count in the app locale (not the OS locale). */
export function toCount(
  value: bigint | number,
  locale: string = currentAppLocale(),
) {
  return Number(value).toLocaleString(locale);
}

function formatSelectionNumber(value: number, locale: string) {
  return value.toLocaleString(locale, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 6,
  });
}

export function formatResultSelectionStatus(
  summary: ResultSelectionSummary,
  locale: string = currentAppLocale(),
) {
  const parts = [
    `${toCount(summary.cellCount, locale)} cells`,
    `${toCount(summary.rowCount, locale)}x${toCount(summary.columnCount, locale)}`,
  ];
  if (summary.numericCount > 0) {
    parts.push(`sum ${formatSelectionNumber(summary.sum ?? 0, locale)}`);
    parts.push(`avg ${formatSelectionNumber(summary.average ?? 0, locale)}`);
    parts.push(`min ${formatSelectionNumber(summary.min ?? 0, locale)}`);
    parts.push(`max ${formatSelectionNumber(summary.max ?? 0, locale)}`);
  }
  if (summary.nullCount > 0) {
    parts.push(`null ${toCount(summary.nullCount, locale)}`);
  }
  if (summary.textCount > 0 && summary.numericCount === 0) {
    parts.push(`text ${toCount(summary.textCount, locale)}`);
  }
  if (summary.truncated) {
    parts.push(`sampled ${toCount(summary.sampledCellCount, locale)}`);
  }
  return parts.join(" · ");
}

export function historySnapshotToQueryResult(
  snapshot: QueryHistoryResultSnapshot,
): QueryResult {
  const message = snapshot.retentionTruncated
    ? `history preview retained ${toCount(snapshot.retainedRows)} of ${toCount(
        snapshot.rowCount,
      )} rows`
    : snapshot.message;
  const resultSets =
    snapshot.resultSets && snapshot.resultSets.length > 1
      ? snapshot.resultSets.map((set) => ({
          statementIndex: set.statementIndex,
          statement: set.statement,
          columns: set.columns,
          rows: set.rows,
          rowCount: BigInt(set.retainedRows),
          elapsedMs: BigInt(set.elapsedMs),
          truncated: set.truncated || set.retentionTruncated,
          message: set.retentionTruncated
            ? `history preview retained ${toCount(set.retainedRows)} of ${toCount(
                set.rowCount,
              )} rows`
            : set.message,
        }))
      : undefined;
  return {
    columns: snapshot.columns,
    rows: snapshot.rows,
    rowCount: BigInt(snapshot.retainedRows),
    elapsedMs: BigInt(snapshot.elapsedMs),
    truncated: snapshot.truncated || snapshot.retentionTruncated,
    message,
    resultSets,
  };
}
