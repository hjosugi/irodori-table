import { Zap } from "lucide-react";
import { memo } from "react";
import type { QueryPlanAnalysis } from "@/generated/irodori-api";

export const GuideView = memo(function GuideView({
  plan,
}: {
  plan: QueryPlanAnalysis;
}) {
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
});
