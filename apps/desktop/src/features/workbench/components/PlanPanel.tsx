import {
  AlertTriangle,
  Copy,
  Flame,
  Network,
  Play,
  Table2,
  TreePine,
  X,
  Zap,
} from "lucide-react";
import type { CSSProperties } from "react";
import type {
  QueryPlanAnalysis,
  QueryPlanCopyFormat,
  QueryPlanFinding,
  QueryPlanMetric,
  QueryPlanNode,
} from "@/generated/irodori-api";

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

const severityRank: Record<QueryPlanFinding["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
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
  const sortedFindings = [...(plan?.findings ?? [])].sort(
    (left, right) => severityRank[left.severity] - severityRank[right.severity],
  );
  const hotNodes = [...(plan?.nodes ?? [])]
    .sort((left, right) => right.impactScore - left.impactScore)
    .slice(0, 6);
  return (
    <section className="plan-panel" aria-label="Explain plan">
      <div className="plan-panel-header">
        <div>
          <strong>Plan</strong>
          <span>{activeConnectionName}</span>
        </div>
        <button type="button" title="Close Plan" aria-label="Close Plan" onClick={onClose}>
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
        <>
          <div className="plan-summary">
            <div>
              <strong>{plan.headline}</strong>
              <span>{sourceLabel(plan.source)} · {plan.engineFamily}</span>
            </div>
            <p>{plan.summary}</p>
          </div>

          <section className="plan-section">
            <div className="plan-section-title">
              <AlertTriangle size={14} />
              <span>Findings</span>
            </div>
            <div className="plan-finding-list">
              {sortedFindings.map((finding, index) => (
                <article
                  className={`plan-finding ${finding.severity}`}
                  key={`${finding.title}:${index}`}
                >
                  <strong>{finding.title}</strong>
                  <span>{finding.detail}</span>
                  <small>{finding.action}</small>
                </article>
              ))}
            </div>
          </section>

          <section className="plan-section">
            <div className="plan-section-title">
              <Table2 size={14} />
              <span>Metrics</span>
            </div>
            <div className="plan-metric-grid">
              {plan.metrics.map((metric) => (
                <MetricTile metric={metric} key={metric.key} />
              ))}
            </div>
          </section>

          <section className="plan-section">
            <div className="plan-section-title">
              <Flame size={14} />
              <span>Hot Path</span>
            </div>
            <div className="plan-flame-list">
              {(plan.flameGraph.length > 0 ? plan.flameGraph : hotNodes).map((frame) => {
                const ratio = "ratio" in frame ? frame.ratio : frame.impactScore;
                return (
                  <div className="plan-flame-row" key={frame.id}>
                    <span style={{ paddingLeft: `${Math.min(frame.depth, 5) * 12}px` }}>
                      {frame.label}
                    </span>
                    <i>
                      <b style={{ width: `${Math.max(6, ratio * 100)}%` }} />
                    </i>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="plan-section">
            <div className="plan-section-title">
              <TreePine size={14} />
              <span>Tree</span>
            </div>
            <div className="plan-tree">
              {plan.nodes.map((node) => (
                <PlanTreeNode node={node} key={node.id} />
              ))}
            </div>
          </section>

          <section className="plan-section">
            <div className="plan-section-title">
              <Network size={14} />
              <span>Diagram</span>
            </div>
            <div className="plan-diagram">
              {hotNodes.map((node) => (
                <div className="plan-diagram-node" key={node.id}>
                  <strong>{node.operation}</strong>
                  <span>{node.object ?? node.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="plan-section">
            <div className="plan-section-title">
              <Table2 size={14} />
              <span>Table</span>
            </div>
            <div className="plan-table-wrap">
              <table className="plan-table">
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>Object</th>
                    <th>Rows</th>
                    <th>Cost</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.nodes.map((node) => (
                    <tr key={node.id}>
                      <td>{node.operation}</td>
                      <td>{node.object ?? ""}</td>
                      <td>{formatMaybe(node.actualRows ?? node.estimatedRows)}</td>
                      <td>{formatMaybe(node.totalCost)}</td>
                      <td>{formatMaybe(node.actualTotalMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="plan-section">
            <div className="plan-section-title">
              <Copy size={14} />
              <span>Copy</span>
            </div>
            <div className="plan-copy-list">
              {plan.copyFormats.map((format) => (
                <button
                  type="button"
                  key={format.label}
                  onClick={() => onCopyFormat(format)}
                >
                  <Copy size={13} />
                  <span>{format.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="plan-section">
            <div className="plan-section-title">
              <Zap size={14} />
              <span>Guide</span>
            </div>
            <div className="plan-guide-list">
              {plan.metricGuide.map((guide) => (
                <article key={guide.key}>
                  <strong>{guide.label}</strong>
                  <span>{guide.meaning}</span>
                  <small>{guide.warning}</small>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function MetricTile({ metric }: { metric: QueryPlanMetric }) {
  return (
    <div className={`plan-metric ${metric.severity}`}>
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
      <small>{metric.description}</small>
    </div>
  );
}

function PlanTreeNode({ node }: { node: QueryPlanNode }) {
  // Heat-tint each node by its share of the plan's cost so the expensive
  // subtree pops in the structural view (the flame bar already encodes this
  // via width; the tree previously showed no hotness at all).
  const heat = Math.max(0, Math.min(1, node.impactScore));
  return (
    <div
      className="plan-tree-node"
      style={
        {
          paddingLeft: `${Math.min(node.depth, 6) * 12}px`,
          "--heat": heat,
        } as CSSProperties
      }
    >
      <strong>{node.operation}</strong>
      <span>{node.object ?? node.label}</span>
      <small>
        {[
          node.estimatedRows !== undefined ? `est ${formatMaybe(node.estimatedRows)}` : "",
          node.actualRows !== undefined ? `actual ${formatMaybe(node.actualRows)}` : "",
          node.totalCost !== undefined ? `cost ${formatMaybe(node.totalCost)}` : "",
          node.actualTotalMs !== undefined ? `${formatMaybe(node.actualTotalMs)} ms` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </small>
    </div>
  );
}

function sourceLabel(source: QueryPlanAnalysis["source"]) {
  switch (source) {
    case "native":
      return "Native";
    case "nativeWithStaticAnalysis":
      return "Native + static checks";
    case "staticAnalysis":
      return "Static fallback";
  }
}

function formatMaybe(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) {
    return "";
  }
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
