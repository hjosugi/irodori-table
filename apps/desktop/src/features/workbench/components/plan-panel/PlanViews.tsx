import type { QueryPlanAnalysis } from "@/generated/irodori-api";
import { sourceLabel } from "./plan-format";

export type PlanView =
  "overview" | "tree" | "table" | "graph" | "flame" | "guide" | "copy";

export const planViews: Array<{ id: PlanView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "tree", label: "Tree" },
  { id: "table", label: "Table" },
  { id: "graph", label: "Graph" },
  { id: "flame", label: "Flame" },
  { id: "guide", label: "Guide" },
  { id: "copy", label: "Copy" },
];

export { CopyView } from "./PlanCopyView";
export { OverviewView } from "./PlanOverview";
export {
  FlameView,
  GraphView,
  GuideView,
  TableView,
  TreeView,
} from "./PlanStructureViews";

export function PlanSummary({ plan }: { plan: QueryPlanAnalysis }) {
  return (
    <div className="plan-summary">
      <div>
        <strong>{plan.headline}</strong>
        <span>
          {sourceLabel(plan.source)} · {plan.engineFamily} · {plan.mode}
        </span>
      </div>
      <p>{plan.summary}</p>
    </div>
  );
}
