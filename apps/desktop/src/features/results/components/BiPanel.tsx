import { BarChart3, X } from "lucide-react";
import type { QueryResultSet } from "@/generated/irodori-api";
import { buildBiResultSummary } from "../bi-result";
import type { ChartResultModel } from "../chart-result";
import { ChartResultView } from "./ChartResultView";

type BiPanelProps = {
  result: QueryResultSet | null;
  chartModel: ChartResultModel | null;
  chartAvailable: boolean;
  onOpenChartMode: () => void;
  onClose: () => void;
};

export function BiPanel({
  result,
  chartModel,
  chartAvailable,
  onOpenChartMode,
  onClose,
}: BiPanelProps) {
  const summary = buildBiResultSummary(result, chartModel);
  const visibleProfiles = summary?.profiles.slice(0, 12) ?? [];
  const hiddenProfileCount = summary
    ? Math.max(0, summary.profiles.length - visibleProfiles.length)
    : 0;

  return (
    <section className="bi-panel" aria-label="BI">
      <div className="bi-panel-header">
        <div>
          <strong>BI</strong>
          <span>{summary?.statusLabel ?? "No active result"}</span>
        </div>
        <button
          type="button"
          title="Close BI"
          aria-label="Close BI"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <div className="bi-panel-body">
        {summary ? (
          <div className="bi-summary" aria-label="BI result summary">
            <div>
              <strong>{summary.rowCountLabel}</strong>
              <span>{summary.columnCountLabel}</span>
            </div>
            <div>
              <strong>{summary.elapsedLabel}</strong>
              <span>{summary.sampleLabel ?? "not sampled"}</span>
            </div>
          </div>
        ) : null}
        {chartModel ? (
          <>
            <ChartResultView model={chartModel} />
            <div className="bi-field-list" aria-label="BI fields">
              <strong>Fields</strong>
              {visibleProfiles.map((profile) => (
                <div
                  className="bi-field-row"
                  key={`${profile.index}-${profile.name}`}
                >
                  <span>{profile.name}</span>
                  <small>{profile.role}</small>
                  <em>
                    {profile.kindLabel}
                    {" · "}
                    {profile.filledLabel}
                    {profile.distinctLabel ? ` · ${profile.distinctLabel}` : ""}
                  </em>
                </div>
              ))}
              {hiddenProfileCount > 0 ? (
                <div className="bi-field-more">
                  +{hiddenProfileCount.toLocaleString()} more fields
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="bi-panel-empty">
            <BarChart3 size={18} />
            <strong>
              {result ? "No chartable result" : "No active result"}
            </strong>
            <span>
              {result
                ? "Use a result with numeric, date, or low-cardinality fields."
                : "Run a tabular query to build a local BI view."}
            </span>
            {chartAvailable ? (
              <button
                className="text-button"
                type="button"
                onClick={onOpenChartMode}
              >
                Open Chart
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
