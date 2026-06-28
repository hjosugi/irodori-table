import { Network } from "lucide-react";
import type { QueryPlanEdge, QueryPlanNode } from "@/generated/irodori-api";
import { formatPercent } from "./plan-format";
import type { PlanNodeSelector } from "./plan-types";

export function GraphView({
  nodes,
  edges,
  nodeById,
  selectedNodeId,
  onSelectNode,
}: {
  nodes: QueryPlanNode[];
  edges: QueryPlanEdge[];
  nodeById: Map<string, QueryPlanNode>;
  selectedNodeId: string | null;
  onSelectNode: PlanNodeSelector;
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
      {edges.length > 0 ? (
        <div className="plan-edge-list">
          {edges.map((edge) => (
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
