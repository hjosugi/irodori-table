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
  "lakehouse",
  "bi",
  "git",
] as const;

export type WorkbenchViewId = (typeof workbenchViewIds)[number];

export type WorkbenchViewPlacements = Record<WorkbenchViewId, WorkbenchSide>;

export type WorkbenchViewVisibility = Record<WorkbenchViewId, boolean>;

export const defaultWorkbenchViewPlacements: WorkbenchViewPlacements = {
  objectBrowser: "left",
  completion: "left",
  queryHistory: "left",
  lakehouse: "right",
  bi: "right",
  git: "left",
};

export const defaultWorkbenchViewVisibility: WorkbenchViewVisibility = {
  objectBrowser: true,
  completion: false,
  queryHistory: false,
  lakehouse: false,
  bi: false,
  git: false,
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
