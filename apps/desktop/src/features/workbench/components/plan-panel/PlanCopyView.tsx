import { Copy } from "lucide-react";
import type {
  QueryPlanAnalysis,
  QueryPlanCopyFormat,
  QueryPlanFinding,
  QueryPlanNode,
} from "@/generated/irodori-api";
import { nodeCopyFormat } from "./plan-format";

export function CopyView({
  plan,
  selectedNode,
  selectedNodeFindings,
  onCopyFormat,
}: {
  plan: QueryPlanAnalysis;
  selectedNode: QueryPlanNode | null;
  selectedNodeFindings: QueryPlanFinding[];
  onCopyFormat: (format: QueryPlanCopyFormat) => void;
}) {
  return (
    <section className="plan-section flush">
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
        {selectedNode ? (
          <button
            type="button"
            onClick={() =>
              onCopyFormat(nodeCopyFormat(selectedNode, selectedNodeFindings))
            }
          >
            <Copy size={13} />
            <span>Selected Node</span>
          </button>
        ) : null}
      </div>
      <pre className="plan-copy-preview">{plan.sql}</pre>
    </section>
  );
}
