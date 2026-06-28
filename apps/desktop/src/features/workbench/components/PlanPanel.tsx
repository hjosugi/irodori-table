import { AlertTriangle, Play, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  QueryPlanAnalysis,
  QueryPlanCopyFormat,
  QueryPlanNode,
} from "@/generated/irodori-api";
import { PlanAiExplanation } from "./plan-panel/PlanAiExplanation";
import { PlanNodeDetail } from "./plan-panel/PlanNodeDetail";
import {
  CopyView,
  FlameView,
  GraphView,
  GuideView,
  OverviewView,
  PlanSummary,
  TableView,
  TreeView,
  planViews,
  type PlanView,
} from "./plan-panel/PlanViews";
import { severityRank } from "./plan-panel/plan-format";

type PlanPanelProps = {
  plan: QueryPlanAnalysis | null;
  loading: boolean;
  error: string | null;
  activeConnectionOpen: boolean;
  activeConnectionName: string;
  onExplainPlan: () => void;
  onExplainAnalyze: () => void;
  onCopyFormat: (format: QueryPlanCopyFormat) => void;
  onClose: () => void;
};

export function PlanPanel({
  plan,
  loading,
  error,
  activeConnectionOpen,
  activeConnectionName,
  onExplainPlan,
  onExplainAnalyze,
  onCopyFormat,
  onClose,
}: PlanPanelProps) {
  const [activeView, setActiveView] = useState<PlanView>("overview");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const sortedFindings = useMemo(
    () =>
      [...(plan?.findings ?? [])].sort(
        (left, right) =>
          severityRank[left.severity] - severityRank[right.severity],
      ),
    [plan],
  );
  const hotNodes = useMemo(
    () =>
      [...(plan?.nodes ?? [])]
        .sort((left, right) => right.impactScore - left.impactScore)
        .slice(0, 8),
    [plan],
  );
  const nodeById = useMemo(
    () => new Map((plan?.nodes ?? []).map((node) => [node.id, node])),
    [plan],
  );
  const selectedNode = selectedNodeId
    ? (nodeById.get(selectedNodeId) ?? null)
    : null;
  const selectedNodeFindings = selectedNode
    ? sortedFindings.filter((finding) => finding.nodeId === selectedNode.id)
    : [];

  useEffect(() => {
    if (!plan || plan.nodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }

    setSelectedNodeId((current) => {
      if (current && hasNode(plan.nodes, current)) {
        return current;
      }
      return preferredPlanNodeId(plan, sortedFindings, hotNodes);
    });
  }, [hotNodes, plan, sortedFindings]);

  const selectNode = (nodeId: string | undefined) => {
    if (nodeId && nodeById.has(nodeId)) {
      setSelectedNodeId(nodeId);
    }
  };

  return (
    <section className="plan-panel" aria-label="Explain plan">
      <div className="plan-panel-header">
        <div>
          <strong>Plan</strong>
          <span>{activeConnectionName}</span>
        </div>
        <button
          type="button"
          title="Close Plan"
          aria-label="Close Plan"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>

      <div className="plan-actions">
        <button
          type="button"
          onClick={onExplainPlan}
          disabled={!activeConnectionOpen || loading}
          title="Explain Plan"
        >
          <Play size={14} />
          <span>Plan</span>
        </button>
        <button
          type="button"
          onClick={onExplainAnalyze}
          disabled={!activeConnectionOpen || loading}
          title="Explain Analyse"
        >
          <Zap size={14} />
          <span>Analyse</span>
        </button>
      </div>

      {!activeConnectionOpen ? (
        <div className="plan-empty">Connect to inspect execution plans.</div>
      ) : loading ? (
        <div className="plan-empty loading">Reading execution plan</div>
      ) : error ? (
        <div className="plan-error">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      ) : !plan ? (
        <div className="plan-empty">
          Run Plan or Analyse for the selected SQL/current statement.
        </div>
      ) : (
        <>
          <PlanSummary plan={plan} />
          <PlanAiExplanation plan={plan} />
          <PlanViewTabs activeView={activeView} onChange={setActiveView} />

          <div className="plan-analysis-grid">
            <div className="plan-main-view">
              <ActivePlanView
                activeView={activeView}
                plan={plan}
                sortedFindings={sortedFindings}
                hotNodes={hotNodes}
                nodeById={nodeById}
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
      )}
    </section>
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
  sortedFindings,
  hotNodes,
  nodeById,
  selectedNodeId,
  selectedNode,
  selectedNodeFindings,
  onSelectNode,
  onCopyFormat,
}: {
  activeView: PlanView;
  plan: QueryPlanAnalysis;
  sortedFindings: QueryPlanAnalysis["findings"];
  hotNodes: QueryPlanNode[];
  nodeById: Map<string, QueryPlanNode>;
  selectedNodeId: string | null;
  selectedNode: QueryPlanNode | null;
  selectedNodeFindings: QueryPlanAnalysis["findings"];
  onSelectNode: (nodeId: string | undefined) => void;
  onCopyFormat: (format: QueryPlanCopyFormat) => void;
}) {
  switch (activeView) {
    case "overview":
      return (
        <OverviewView
          plan={plan}
          findings={sortedFindings}
          hotNodes={hotNodes}
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
          plan={plan}
          nodes={hotNodes.length > 0 ? hotNodes : plan.nodes.slice(0, 8)}
          nodeById={nodeById}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      );
    case "flame":
      return (
        <FlameView
          plan={plan}
          hotNodes={hotNodes}
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

function preferredPlanNodeId(
  plan: QueryPlanAnalysis,
  findings: QueryPlanAnalysis["findings"],
  hotNodes: QueryPlanNode[],
) {
  return (
    findings.find((finding) => finding.nodeId)?.nodeId ??
    hotNodes[0]?.id ??
    plan.nodes[0]?.id ??
    null
  );
}

function hasNode(nodes: QueryPlanNode[], nodeId: string) {
  return nodes.some((node) => node.id === nodeId);
}
