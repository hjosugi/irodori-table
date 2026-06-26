import type { KeybindingScope } from "@/keybindings";

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
  "git",
] as const;

export type WorkbenchViewId = (typeof workbenchViewIds)[number];

export type WorkbenchViewPlacements = Record<WorkbenchViewId, WorkbenchSide>;

export type WorkbenchViewVisibility = Record<WorkbenchViewId, boolean>;

export const defaultWorkbenchViewPlacements: WorkbenchViewPlacements = {
  objectBrowser: "left",
  completion: "right",
  queryHistory: "right",
  git: "right",
};

export const defaultWorkbenchViewVisibility: WorkbenchViewVisibility = {
  objectBrowser: true,
  completion: true,
  queryHistory: true,
  git: true,
};
