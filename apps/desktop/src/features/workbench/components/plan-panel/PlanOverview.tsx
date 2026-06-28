import { AlertTriangle, Flame, Table2 } from "lucide-react";
import type {
  QueryPlanAnalysis,
  QueryPlanFinding,
  QueryPlanMetric,
  QueryPlanNode,
} from "@/generated/irodori-api";

type SelectNode = (nodeId: string | undefined) => void;

export function OverviewView({
  plan,
  findings,
  hotNodes,
  selectedNodeId,
  onSelectNode,
}: {
  plan: QueryPlanAnalysis;
  findings: QueryPlanFinding[];
  hotNodes: QueryPlanNode[];
  selectedNodeId: string | null;
  onSelectNode: SelectNode;
}) {
  return (
    <>
      <section className="plan-section compact">
        <div className="plan-section-title">
          <AlertTriangle size={14} />
          <span>Findings</span>
        </div>
        <FindingList
          findings={findings}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      </section>

      <section className="plan-section compact">
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

      <section className="plan-section compact">
        <div className="plan-section-title">
          <Flame size={14} />
          <span>Hot Path</span>
        </div>
        <HotNodeList
          nodes={hotNodes}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      </section>
    </>
  );
}

function FindingList({
  findings,
  selectedNodeId,
  onSelectNode,
}: {
  findings: QueryPlanFinding[];
  selectedNodeId: string | null;
  onSelectNode: SelectNode;
}) {
  if (findings.length === 0) {
    return (
      <div className="plan-empty-card">No risky plan pattern was detected.</div>
    );
  }

  return (
    <div className="plan-finding-list">
      {findings.map((finding, index) => {
        const active = Boolean(
          finding.nodeId && finding.nodeId === selectedNodeId,
        );
        return (
          <button
            type="button"
            className={`plan-finding ${finding.severity}${active ? " active" : ""}`}
            key={`${finding.title}:${index}`}
            onClick={() => onSelectNode(finding.nodeId)}
            disabled={!finding.nodeId}
          >
            <strong>{finding.title}</strong>
            <span>{finding.detail}</span>
            <small>{finding.action}</small>
          </button>
        );
      })}
    </div>
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

function HotNodeList({
  nodes,
  selectedNodeId,
  onSelectNode,
}: {
  nodes: QueryPlanNode[];
  selectedNodeId: string | null;
  onSelectNode: SelectNode;
}) {
  if (nodes.length === 0) {
    return <div className="plan-empty-card">No plan nodes are available.</div>;
  }

  return (
    <div className="plan-hot-list">
      {nodes.map((node, index) => (
        <button
          type="button"
          className={`plan-hot-node${node.id === selectedNodeId ? " active" : ""}`}
          key={node.id}
          onClick={() => onSelectNode(node.id)}
        >
          <b>{index + 1}</b>
          <span>
            <strong>{node.operation}</strong>
            <small>{node.object ?? node.label}</small>
          </span>
          <i style={{ width: `${Math.max(6, node.impactScore * 100)}%` }} />
        </button>
      ))}
    </div>
  );
}
