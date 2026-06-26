import type { QueryHistoryResultSnapshot } from "@/features/query-history";
import type { QueryResult } from "@/generated/irodori-api";
import type { ResultSelectionSummary } from "./result-selection";

export function toCount(value: bigint | number) {
  return Number(value).toLocaleString();
}

function formatSelectionNumber(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 6,
  });
}

export function formatResultSelectionStatus(summary: ResultSelectionSummary) {
  const parts = [
    `${toCount(summary.cellCount)} cells`,
    `${toCount(summary.rowCount)}x${toCount(summary.columnCount)}`,
  ];
  if (summary.numericCount > 0) {
    parts.push(`sum ${formatSelectionNumber(summary.sum ?? 0)}`);
    parts.push(`avg ${formatSelectionNumber(summary.average ?? 0)}`);
    parts.push(`min ${formatSelectionNumber(summary.min ?? 0)}`);
    parts.push(`max ${formatSelectionNumber(summary.max ?? 0)}`);
  }
  if (summary.nullCount > 0) {
    parts.push(`null ${toCount(summary.nullCount)}`);
  }
  if (summary.textCount > 0 && summary.numericCount === 0) {
    parts.push(`text ${toCount(summary.textCount)}`);
  }
  if (summary.truncated) {
    parts.push(`sampled ${toCount(summary.sampledCellCount)}`);
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
