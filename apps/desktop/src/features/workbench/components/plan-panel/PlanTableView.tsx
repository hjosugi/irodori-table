import { Table2 } from "lucide-react";
import type { QueryPlanNode } from "@/generated/irodori-api";
import { formatMaybe, formatPercent } from "./plan-format";
import type { PlanNodeSelector } from "./plan-types";

export function TableView({
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
