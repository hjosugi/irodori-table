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
  "rowDetail",
  "knowledge",
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
  rowDetail: "right",
  knowledge: "right",
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
  rowDetail: false,
  knowledge: false,
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

export type WorkbenchViewHidden = Record<WorkbenchViewId, boolean>;

export const defaultWorkbenchViewHidden: WorkbenchViewHidden = {
  objectBrowser: false,
  completion: false,
  queryHistory: false,
  plan: false,
  lakehouse: false,
  bi: false,
  git: false,
  aiChat: false,
  searchReplace: false,
  rowDetail: false,
  knowledge: false,
};

function isWorkbenchViewId(value: unknown): value is WorkbenchViewId {
  return workbenchViewIds.includes(value as WorkbenchViewId);
}

// Stored tab order for the sidebar view switchers. Unknown ids are dropped and
// missing ids are appended in their default order, so the list always stays a
// permutation of workbenchViewIds even across app versions.
export function normalizeWorkbenchViewOrder(value: unknown): WorkbenchViewId[] {
  const order: WorkbenchViewId[] = [];
  const seen = new Set<WorkbenchViewId>();
  if (Array.isArray(value)) {
    for (const viewId of value) {
      if (isWorkbenchViewId(viewId) && !seen.has(viewId)) {
        seen.add(viewId);
        order.push(viewId);
      }
    }
  }
  workbenchViewIds.forEach((viewId) => {
    if (!seen.has(viewId)) {
      order.push(viewId);
    }
  });
  return order;
}

// Views hidden at the code level until their workflow is production-ready.
// Everything else about the view (panel, tab metadata, registry entries) is
// kept intact, so re-enabling is a one-line revert: drop the id from this set.
const temporarilyHiddenWorkbenchViews = new Set<WorkbenchViewId>(["lakehouse"]);

export function workbenchViewsForSide(
  placements: WorkbenchViewPlacements,
  side: WorkbenchSide,
  order: readonly WorkbenchViewId[] = workbenchViewIds,
  hidden?: Partial<WorkbenchViewHidden>,
): WorkbenchViewId[] {
  return order.filter(
    (viewId) =>
      placements[viewId] === side &&
      !hidden?.[viewId] &&
      !temporarilyHiddenWorkbenchViews.has(viewId),
  );
}

export function activeWorkbenchViewForSide(
  visibility: WorkbenchViewVisibility,
  placements: WorkbenchViewPlacements,
  side: WorkbenchSide,
  order: readonly WorkbenchViewId[] = workbenchViewIds,
  hidden?: Partial<WorkbenchViewHidden>,
): WorkbenchViewId {
  const views = workbenchViewsForSide(placements, side, order, hidden);
  return (
    views.find((viewId) => visibility[viewId]) ??
    views[0] ??
    (side === "left" ? "objectBrowser" : "plan")
  );
}
