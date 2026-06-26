import type { KeybindingScope } from "@/keybindings";

export type CompletionHint = {
  label: string;
  detail: string;
  insertText: string;
};

export type PanelResizeKind = "sidebar" | "inspector" | "results" | "editorSplit";

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

export const defaultWorkbenchViewPlacements: WorkbenchViewPlacements = {
  objectBrowser: "left",
  completion: "right",
  queryHistory: "right",
  git: "right",
};
