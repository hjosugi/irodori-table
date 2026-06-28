import { memo } from "react";
import type { QueryPlanAnalysis } from "@/generated/irodori-api";
import { sourceLabel } from "./plan-format";

export const PlanSummary = memo(function PlanSummary({
  plan,
}: {
  plan: QueryPlanAnalysis;
}) {
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
});
