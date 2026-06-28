import { TreePine } from "lucide-react";
import type { CSSProperties } from "react";
import type { QueryPlanNode } from "@/generated/irodori-api";
import { nodeMetricLine } from "./plan-format";
import type { PlanNodeSelector } from "./plan-types";

export function TreeView({
  nodes,
  selectedNodeId,
  onSelectNode,
}: {
  nodes: QueryPlanNode[];
  selectedNodeId: string | null;
  onSelectNode: PlanNodeSelector;
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
  onSelectNode: PlanNodeSelector;
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
