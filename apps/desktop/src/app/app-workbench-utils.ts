import type { JobList } from "@/generated/irodori-api";
import type { KeybindingScope } from "@/core";
import type {
  ResultFilterRule,
  ResultGridDraftCell as GridCellDraft,
  ResultSortRule,
} from "@/features/results";
import {
  defaultThemeForKind,
  type ThemeKind,
} from "@/theme";

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function keyScopeFromTarget(
  target: EventTarget | null,
  fallback: KeybindingScope,
): KeybindingScope {
  if (!(target instanceof HTMLElement)) {
    return fallback;
  }
  if (target.closest(".cm-host")) {
    return "editor";
  }
  if (target.closest(".result-grid")) {
    return "grid";
  }
  return "global";
}

export function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function isCellEditorClipboardShortcut(
  event: KeyboardEvent,
  target: HTMLElement | null,
): boolean {
  return (
    !!target?.closest(".cell-editor") &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    ["c", "x", "v", "z"].includes(event.key.toLowerCase())
  );
}

export function parseClipboardTable(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const delimiter = rows.some((row) => row.includes("\t")) ? "\t" : ",";
  return rows.map((row) => row.split(delimiter));
}

export const emptyJobList: JobList = { active: [], history: [] };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function builtInTheme(kind: ThemeKind, preferredThemeId?: string | null) {
  return defaultThemeForKind(kind, preferredThemeId);
}

export function tauriRuntimeError() {
  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }
  ).__TAURI_INTERNALS__;
  if (typeof internals?.invoke === "function") {
    return null;
  }
  return "Tauri desktop runtime is not available. Open the Tauri app window, not the Vite browser URL.";
}

export const GRID_ROW_HEIGHT = 27;
export const GRID_OVERSCAN = 8;
export const GRID_COLUMN_WIDTH = 148;
export const GRID_COLUMN_OVERSCAN = 2;
export const GRID_GUTTER_WIDTH = 34;
export const GRID_WINDOWED_ROW_THRESHOLD = 50_000;
export const GRID_WINDOWED_CELL_THRESHOLD = 250_000;

export const RESULT_WINDOW_PAGE_SIZE = 1_000;
export const RESULT_WINDOW_MAX_RESIDENT_PAGES = 24;

export const EMPTY_CELL_EDITS: ReadonlyMap<string, GridCellDraft> = new Map();
export const EMPTY_NEW_ROWS: readonly (readonly GridCellDraft[])[] = [];
export const EMPTY_DELETED_ROWS: ReadonlySet<number> = new Set();
export const EMPTY_FILTER_RULES: readonly ResultFilterRule[] = [];
export const EMPTY_SORT_RULES: readonly ResultSortRule[] = [];
export const GRID_COPY_ROW_LIMIT = 50_000;
