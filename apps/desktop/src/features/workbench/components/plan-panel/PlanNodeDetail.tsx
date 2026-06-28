import { Copy } from "lucide-react";
import type {
  QueryPlanCopyFormat,
  QueryPlanFinding,
  QueryPlanNode,
} from "@/generated/irodori-api";
import {
  formatMaybe,
  formatMs,
  formatPercent,
  nodeCopyFormat,
} from "./plan-format";

type PlanNodeDetailProps = {
  node: QueryPlanNode;
  findings: QueryPlanFinding[];
  onCopyFormat: (format: QueryPlanCopyFormat) => void;
};

export function PlanNodeDetail({
  node,
  findings,
  onCopyFormat,
}: PlanNodeDetailProps) {
  const rows: Array<[string, string]> = [
    ["Operation", node.operation],
    ["Object", node.object ?? ""],
    ["Estimated rows", formatMaybe(node.estimatedRows)],
    ["Actual rows", formatMaybe(node.actualRows)],
    ["Startup cost", formatMaybe(node.startupCost)],
    ["Total cost", formatMaybe(node.totalCost)],
    ["Startup time", formatMs(node.actualStartupMs)],
    ["Total time", formatMs(node.actualTotalMs)],
    ["Loops", formatMaybe(node.loops)],
    ["Width", formatMaybe(node.width)],
    ["Impact", formatPercent(node.impactScore)],
  ];
  const visibleRows = rows.filter(([, value]) => value !== "");

  return (
    <aside className="plan-node-detail" aria-label="Selected plan node">
      <div className="plan-node-detail-header">
        <div>
          <strong>{node.operation}</strong>
          <span>{node.object ?? node.label}</span>
        </div>
        <button
          type="button"
          title="Copy selected node"
          onClick={() => onCopyFormat(nodeCopyFormat(node, findings))}
        >
          <Copy size={13} />
        </button>
      </div>

      <dl className="plan-node-kv">
        {visibleRows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {findings.length > 0 ? (
        <div className="plan-node-block">
          <strong>Findings</strong>
          {findings.map((finding, index) => (
            <span
              className={`plan-node-finding ${finding.severity}`}
              key={`${finding.title}:${index}`}
            >
              {finding.title}: {finding.action}
            </span>
          ))}
        </div>
      ) : null}

      {node.notes && node.notes.length > 0 ? (
        <div className="plan-node-block">
          <strong>Notes</strong>
          {node.notes.map((note, index) => (
            <span key={`${note}:${index}`}>{note}</span>
          ))}
        </div>
      ) : null}

      {node.properties && node.properties.length > 0 ? (
        <div className="plan-node-block">
          <strong>Properties</strong>
          {node.properties.map((property) => (
            <span key={`${property.name}:${property.value}`}>
              {property.name}: {property.value}
            </span>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
