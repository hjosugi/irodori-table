import type { KeybindingScope } from "@/keybindings";

export type CompletionHint = {
  label: string;
  detail: string;
  insertText: string;
};

export type PanelResizeKind = "sidebar" | "inspector" | "results" | "editorSplit";

export type WorkbenchKeyScope = KeybindingScope;
