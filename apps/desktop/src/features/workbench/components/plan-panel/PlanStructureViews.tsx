import { Flame, Network, Table2, TreePine, Zap } from "lucide-react";
import type { CSSProperties } from "react";
import type {
  QueryPlanAnalysis,
  QueryPlanNode,
} from "@/generated/irodori-api";
import {
  formatMaybe,
  formatPercent,
  nodeMetricLine,
} from "./plan-format";

type SelectNode = (nodeId: string | undefined) => void;

export function TreeView({
  nodes,
  selectedNodeId,
  onSelectNode,
}: {
  nodes: QueryPlanNode[];
  selectedNodeId: string | null;
  onSelectNode: SelectNode;
}) {
  return (
    <section className="plan-section flush">
      <div className="plan-section-title">
        <TreePine size={14} />
        <span>Tree</span>
      </div>
      <div className="plan-tree">
        {nodes.map((node) => (
          <PlanTreeNode
            node={node}
            active={node.id === selectedNodeId}
            onSelectNode={onSelectNode}
            key={node.id}
          />
        ))}
      </div>
    </section>
  );
}

function PlanTreeNode({
  node,
  active,
  onSelectNode,
}: {
  node: QueryPlanNode;
  active: boolean;
  onSelectNode: SelectNode;
}) {
  const heat = Math.max(0, Math.min(1, node.impactScore));
  return (
    <button
      type="button"
      className={`plan-tree-node${active ? " active" : ""}`}
      onClick={() => onSelectNode(node.id)}
      style={
        {
          paddingLeft: `${6 + Math.min(node.depth, 6) * 12}px`,
          "--heat": heat,
        } as CSSProperties
      }
    >
      <strong>{node.operation}</strong>
      <span>{node.object ?? node.label}</span>
      <small>{nodeMetricLine(node)}</small>
    </button>
  );
}

export function TableView({
  nodes,
  selectedNodeId,
  onSelectNode,
}: {
  nodes: QueryPlanNode[];
  selectedNodeId: string | null;
  onSelectNode: SelectNode;
}) {
  return (
    <section className="plan-section flush">
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
              <th>Impact</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <tr
                key={node.id}
                className={node.id === selectedNodeId ? "active" : ""}
                tabIndex={0}
                onClick={() => onSelectNode(node.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectNode(node.id);
                  }
                }}
              >
                <td>{node.operation}</td>
                <td>{node.object ?? ""}</td>
                <td>{formatMaybe(node.actualRows ?? node.estimatedRows)}</td>
                <td>{formatMaybe(node.totalCost)}</td>
                <td>{formatMaybe(node.actualTotalMs)}</td>
                <td>{formatPercent(node.impactScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function GraphView({
  plan,
  nodes,
  nodeById,
  selectedNodeId,
  onSelectNode,
}: {
  plan: QueryPlanAnalysis;
  nodes: QueryPlanNode[];
  nodeById: Map<string, QueryPlanNode>;
  selectedNodeId: string | null;
  onSelectNode: SelectNode;
}) {
  return (
    <section className="plan-section flush">
      <div className="plan-section-title">
        <Network size={14} />
        <span>Graph</span>
      </div>
      <div className="plan-diagram">
        {nodes.map((node) => (
          <button
            type="button"
            className={`plan-diagram-node${node.id === selectedNodeId ? " active" : ""}`}
            key={node.id}
            onClick={() => onSelectNode(node.id)}
          >
            <strong>{node.operation}</strong>
            <span>{node.object ?? node.label}</span>
            <small>{formatPercent(node.impactScore)} impact</small>
          </button>
        ))}
      </div>
      {plan.edges.length > 0 ? (
        <div className="plan-edge-list">
          {plan.edges.slice(0, 12).map((edge) => (
            <button
              type="button"
              key={`${edge.from}:${edge.to}:${edge.label}`}
              onClick={() => onSelectNode(edge.to)}
            >
              <span>{nodeById.get(edge.from)?.operation ?? edge.from}</span>
              <b>{edge.label || "feeds"}</b>
              <span>{nodeById.get(edge.to)?.operation ?? edge.to}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function FlameView({
  plan,
  hotNodes,
  selectedNodeId,
  onSelectNode,
}: {
  plan: QueryPlanAnalysis;
  hotNodes: QueryPlanNode[];
  selectedNodeId: string | null;
  onSelectNode: SelectNode;
}) {
  const rows =
    plan.flameGraph.length > 0
      ? plan.flameGraph.map((frame) => ({
          id: frame.id,
          label: frame.label,
          depth: frame.depth,
          ratio: frame.ratio,
          value: `${formatMaybe(frame.value)} ${frame.unit}`,
        }))
      : hotNodes.map((node) => ({
          id: node.id,
          label: node.label,
          depth: node.depth,
          ratio: node.impactScore,
          value: formatPercent(node.impactScore),
        }));

  return (
    <section className="plan-section flush">
      <div className="plan-section-title">
        <Flame size={14} />
        <span>Flame</span>
      </div>
      <div className="plan-flame-list">
        {rows.map((row) => (
          <button
            type="button"
            className={`plan-flame-row${row.id === selectedNodeId ? " active" : ""}`}
            key={row.id}
            onClick={() => onSelectNode(row.id)}
          >
            <span style={{ paddingLeft: `${Math.min(row.depth, 5) * 12}px` }}>
              {row.label}
            </span>
            <i>
              <b style={{ width: `${Math.max(6, row.ratio * 100)}%` }} />
            </i>
            <small>{row.value}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

export function GuideView({ plan }: { plan: QueryPlanAnalysis }) {
  return (
    <section className="plan-section flush">
      <div className="plan-section-title">
        <Zap size={14} />
        <span>Guide</span>
      </div>
      <div className="plan-guide-list">
        {plan.metricGuide.map((guide) => (
          <article key={guide.key}>
            <strong>{guide.label}</strong>
            <span>{guide.meaning}</span>
            <small>Good: {guide.good}</small>
            <small>Watch: {guide.warning}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
