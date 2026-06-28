export type PlanView =
  "overview" | "tree" | "table" | "graph" | "flame" | "guide" | "copy";

export type PlanNodeSelector = (nodeId: string | undefined) => void;

export const planViews: Array<{ id: PlanView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "tree", label: "Tree" },
  { id: "table", label: "Table" },
  { id: "graph", label: "Graph" },
  { id: "flame", label: "Flame" },
  { id: "guide", label: "Guide" },
  { id: "copy", label: "Copy" },
];
