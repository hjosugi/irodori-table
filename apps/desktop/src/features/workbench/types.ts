import type { KeybindingScope } from "@/core/keybindings";

export type CompletionHint = {
  label: string;
  detail: string;
  insertText: string;
};

export type WorkbenchKeyScope = KeybindingScope;

export type WorkbenchSide = "left" | "right";

export const workbenchViewIds = [
  "objectBrowser",
  "completion",
  "queryHistory",
  "plan",
  "lakehouse",
  "bi",
  "git",
  "aiChat",
  "searchReplace",
] as const;

export type WorkbenchViewId = (typeof workbenchViewIds)[number];

export type WorkbenchViewPlacements = Record<WorkbenchViewId, WorkbenchSide>;

export type WorkbenchViewVisibility = Record<WorkbenchViewId, boolean>;

export const defaultWorkbenchViewPlacements: WorkbenchViewPlacements = {
  objectBrowser: "left",
  completion: "left",
  queryHistory: "left",
  plan: "right",
  lakehouse: "right",
  bi: "right",
  git: "left",
  aiChat: "right",
  searchReplace: "left",
};

export const defaultWorkbenchViewVisibility: WorkbenchViewVisibility = {
  objectBrowser: true,
  completion: false,
  queryHistory: false,
  plan: false,
  lakehouse: false,
  bi: false,
  git: false,
  aiChat: false,
  searchReplace: false,
};

export function activeWorkbenchView(
  visibility: WorkbenchViewVisibility,
): WorkbenchViewId {
  return (
    workbenchViewIds.find(
      (viewId) => viewId !== "objectBrowser" && visibility[viewId],
    ) ?? "objectBrowser"
  );
}

export function workbenchViewsForSide(
  placements: WorkbenchViewPlacements,
  side: WorkbenchSide,
): WorkbenchViewId[] {
  return workbenchViewIds.filter((viewId) => placements[viewId] === side);
}

export function activeWorkbenchViewForSide(
  visibility: WorkbenchViewVisibility,
  placements: WorkbenchViewPlacements,
  side: WorkbenchSide,
): WorkbenchViewId {
  return (
    workbenchViewIds.find(
      (viewId) => placements[viewId] === side && visibility[viewId],
    ) ??
    workbenchViewsForSide(placements, side)[0] ??
    (side === "left" ? "objectBrowser" : "plan")
  );
}
