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
  git: "left",
};

export const defaultWorkbenchViewVisibility: WorkbenchViewVisibility = {
  objectBrowser: true,
  completion: false,
  queryHistory: false,
  lakehouse: false,
  git: false,
};
