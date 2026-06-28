import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  QueryPlanAnalysis,
  QueryPlanCopyFormat,
  QueryPlanNode,
} from "@/generated/irodori-api";
import { PlanAiExplanation } from "./PlanAiExplanation";
import { CopyView } from "./PlanCopyView";
import { FlameView } from "./PlanFlameView";
import { GraphView } from "./PlanGraphView";
import { PlanNodeDetail } from "./PlanNodeDetail";
import { OverviewView } from "./PlanOverview";
import { PlanSummary } from "./PlanSummary";
import { TableView } from "./PlanTableView";
import { TreeView } from "./PlanTreeView";
import { GuideView } from "./PlanGuideView";
import { buildPlanModel, type PlanModel } from "./plan-model";
import { planViews, type PlanNodeSelector, type PlanView } from "./plan-types";

type PlanAnalysisProps = {
  plan: QueryPlanAnalysis;
  onCopyFormat: (format: QueryPlanCopyFormat) => void;
};

export function PlanAnalysis({ plan, onCopyFormat }: PlanAnalysisProps) {
  const [activeView, setActiveView] = useState<PlanView>("overview");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const model = useMemo(() => buildPlanModel(plan), [plan]);
  const selectedNode = selectedNodeId
    ? (model.nodeById.get(selectedNodeId) ?? null)
    : null;
  const selectedNodeFindings = selectedNode
    ? (model.findingsByNodeId.get(selectedNode.id) ?? [])
    : [];

  useEffect(() => {
    if (plan.nodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }

    setSelectedNodeId((current) => {
      if (current && model.nodeById.has(current)) {
        return current;
      }
      return model.defaultNodeId;
    });
  }, [model, plan.nodes.length]);

  const selectNode = useCallback<PlanNodeSelector>(
    (nodeId) => {
      if (nodeId && model.nodeById.has(nodeId)) {
        setSelectedNodeId(nodeId);
      }
    },
    [model],
  );

  return (
    <>
      <PlanSummary plan={plan} />
      <PlanAiExplanation plan={plan} />
      <PlanViewTabs activeView={activeView} onChange={setActiveView} />

      <div className="plan-analysis-grid">
        <div className="plan-main-view">
          <ActivePlanView
            activeView={activeView}
            plan={plan}
            model={model}
            selectedNodeId={selectedNodeId}
            selectedNode={selectedNode}
            selectedNodeFindings={selectedNodeFindings}
            onSelectNode={selectNode}
            onCopyFormat={onCopyFormat}
          />
        </div>

        {selectedNode ? (
          <PlanNodeDetail
            node={selectedNode}
            findings={selectedNodeFindings}
            onCopyFormat={onCopyFormat}
          />
        ) : null}
      </div>
    </>
  );
}

function PlanViewTabs({
  activeView,
  onChange,
}: {
  activeView: PlanView;
  onChange: (view: PlanView) => void;
}) {
  return (
    <div
      className="plan-view-tabs"
      role="tablist"
      aria-label="Plan analysis views"
    >
      {planViews.map((view) => (
        <button
          type="button"
          key={view.id}
          role="tab"
          aria-selected={activeView === view.id}
          className={activeView === view.id ? "active" : ""}
          onClick={() => onChange(view.id)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}

function ActivePlanView({
  activeView,
  plan,
  model,
  selectedNodeId,
  selectedNode,
  selectedNodeFindings,
  onSelectNode,
  onCopyFormat,
}: {
  activeView: PlanView;
  plan: QueryPlanAnalysis;
  model: PlanModel;
  selectedNodeId: string | null;
  selectedNode: QueryPlanNode | null;
  selectedNodeFindings: QueryPlanAnalysis["findings"];
  onSelectNode: PlanNodeSelector;
  onCopyFormat: (format: QueryPlanCopyFormat) => void;
}) {
  switch (activeView) {
    case "overview":
      return (
        <OverviewView
          plan={plan}
          findings={model.sortedFindings}
          hotNodes={model.hotNodes}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      );
    case "tree":
      return (
        <TreeView
          nodes={plan.nodes}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      );
    case "table":
      return (
        <TableView
          nodes={plan.nodes}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      );
    case "graph":
      return (
        <GraphView
          nodes={model.graphNodes}
          edges={model.graphEdges}
          nodeById={model.nodeById}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      );
    case "flame":
      return (
        <FlameView
          rows={model.flameRows}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      );
    case "guide":
      return <GuideView plan={plan} />;
    case "copy":
      return (
        <CopyView
          plan={plan}
          selectedNode={selectedNode}
          selectedNodeFindings={selectedNodeFindings}
          onCopyFormat={onCopyFormat}
        />
      );
  }
}
