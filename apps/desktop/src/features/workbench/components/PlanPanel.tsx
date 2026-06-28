import { AlertTriangle, Play, X, Zap } from "lucide-react";
import type {
  QueryPlanAnalysis,
  QueryPlanCopyFormat,
} from "@/generated/irodori-api";
import { PlanAnalysis } from "./plan-panel";

type PlanPanelProps = {
  plan: QueryPlanAnalysis | null;
  loading: boolean;
  error: string | null;
  activeConnectionOpen: boolean;
  activeConnectionName: string;
  onExplainPlan: () => void;
  onExplainAnalyze: () => void;
  onCopyFormat: (format: QueryPlanCopyFormat) => void;
  onClose: () => void;
};

export function PlanPanel({
  plan,
  loading,
  error,
  activeConnectionOpen,
  activeConnectionName,
  onExplainPlan,
  onExplainAnalyze,
  onCopyFormat,
  onClose,
}: PlanPanelProps) {
  return (
    <section className="plan-panel" aria-label="Explain plan">
      <div className="plan-panel-header">
        <div>
          <strong>Plan</strong>
          <span>{activeConnectionName}</span>
        </div>
        <button
          type="button"
          title="Close Plan"
          aria-label="Close Plan"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>

      <div className="plan-actions">
        <button
          type="button"
          onClick={onExplainPlan}
          disabled={!activeConnectionOpen || loading}
          title="Explain Plan"
        >
          <Play size={14} />
          <span>Plan</span>
        </button>
        <button
          type="button"
          onClick={onExplainAnalyze}
          disabled={!activeConnectionOpen || loading}
          title="Explain Analyse"
        >
          <Zap size={14} />
          <span>Analyse</span>
        </button>
      </div>

      {!activeConnectionOpen ? (
        <div className="plan-empty">Connect to inspect execution plans.</div>
      ) : loading ? (
        <div className="plan-empty loading">Reading execution plan</div>
      ) : error ? (
        <div className="plan-error">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      ) : !plan ? (
        <div className="plan-empty">
          Run Plan or Analyse for the selected SQL/current statement.
        </div>
      ) : (
        <PlanAnalysis plan={plan} onCopyFormat={onCopyFormat} />
      )}
    </section>
  );
}
