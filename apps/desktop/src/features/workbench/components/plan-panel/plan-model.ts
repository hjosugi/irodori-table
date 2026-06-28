import type {
  QueryPlanAnalysis,
  QueryPlanFinding,
  QueryPlanNode,
} from "@/generated/irodori-api";
import { formatMaybe, formatPercent, severityRank } from "./plan-format";

const HOT_NODE_LIMIT = 8;
const GRAPH_EDGE_LIMIT = 12;

export type PlanFlameRow = {
  id: string;
  label: string;
  depth: number;
  ratio: number;
  value: string;
};

export type PlanModel = {
  sortedFindings: QueryPlanFinding[];
  hotNodes: QueryPlanNode[];
  graphNodes: QueryPlanNode[];
  graphEdges: QueryPlanAnalysis["edges"];
  flameRows: PlanFlameRow[];
  nodeById: Map<string, QueryPlanNode>;
  findingsByNodeId: Map<string, QueryPlanFinding[]>;
  defaultNodeId: string | null;
};

export function buildPlanModel(plan: QueryPlanAnalysis): PlanModel {
  const nodeById = new Map<string, QueryPlanNode>();
  const hotNodes: QueryPlanNode[] = [];

  for (const node of plan.nodes) {
    nodeById.set(node.id, node);
    insertHotNode(hotNodes, node);
  }

  const sortedFindings = [...plan.findings].sort(
    (left, right) => severityRank[left.severity] - severityRank[right.severity],
  );
  const findingsByNodeId = new Map<string, QueryPlanFinding[]>();
  let firstFindingNodeId: string | null = null;

  for (const finding of sortedFindings) {
    if (!finding.nodeId || !nodeById.has(finding.nodeId)) {
      continue;
    }
    firstFindingNodeId ??= finding.nodeId;
    const bucket = findingsByNodeId.get(finding.nodeId);
    if (bucket) {
      bucket.push(finding);
    } else {
      findingsByNodeId.set(finding.nodeId, [finding]);
    }
  }

  return {
    sortedFindings,
    hotNodes,
    graphNodes:
      hotNodes.length > 0 ? hotNodes : plan.nodes.slice(0, HOT_NODE_LIMIT),
    graphEdges: plan.edges.slice(0, GRAPH_EDGE_LIMIT),
    flameRows: flameRowsFromPlan(plan, hotNodes),
    nodeById,
    findingsByNodeId,
    defaultNodeId:
      firstFindingNodeId ?? hotNodes[0]?.id ?? plan.nodes[0]?.id ?? null,
  };
}

function insertHotNode(hotNodes: QueryPlanNode[], node: QueryPlanNode) {
  const index = hotNodes.findIndex(
    (candidate) => node.impactScore > candidate.impactScore,
  );
  if (index === -1) {
    if (hotNodes.length < HOT_NODE_LIMIT) {
      hotNodes.push(node);
    }
    return;
  }

  hotNodes.splice(index, 0, node);
  if (hotNodes.length > HOT_NODE_LIMIT) {
    hotNodes.pop();
  }
}

function flameRowsFromPlan(
  plan: QueryPlanAnalysis,
  hotNodes: QueryPlanNode[],
): PlanFlameRow[] {
  if (plan.flameGraph.length > 0) {
    return plan.flameGraph.map((frame) => ({
      id: frame.id,
      label: frame.label,
      depth: frame.depth,
      ratio: frame.ratio,
      value: `${formatMaybe(frame.value)} ${frame.unit}`,
    }));
  }

  return hotNodes.map((node) => ({
    id: node.id,
    label: node.label,
    depth: node.depth,
    ratio: node.impactScore,
    value: formatPercent(node.impactScore),
  }));
}
