import type { JobList } from "@/generated/irodori-api";
import type { KeybindingScope } from "@/core";
import type { WorkspaceConnection } from "@/features/connections";
import { normalizeUiZoom } from "@/features/preferences";
import type { EditorSelection } from "@/features/query-editor";
import type {
  ResultFilterRule,
  ResultGridDraftCell as GridCellDraft,
  ResultSortRule,
} from "@/features/results";
import { defaultThemeForKind, type ThemeKind } from "@/theme";

// Rendered when no connection is configured yet (fresh install, no samples).
// Keeps `activeConnection` defined so the shell never crashes on an empty
// workspace; querying stays disabled until the user adds a real connection.
export const NO_ACTIVE_CONNECTION: WorkspaceConnection = {
  id: "",
  name: "No connection",
  engine: "",
  status: "idle",
  latencyMs: 0,
  proxy: "direct",
  objects: [],
};

export function scaledUiPixels(value: number, zoom: number) {
  return Math.max(1, Math.round(value * zoom));
}

function scaledUiFont(value: number, zoom: number) {
  return `${Math.round(value * zoom * 100) / 100}px`;
}

export function uiZoomStyleVariables(zoom: number): Record<string, string> {
  const normalized = normalizeUiZoom(zoom);
  return {
    "--ui-zoom": normalized.toFixed(2),
    // Keep in step with the UI type scale defined in styles/base.css: these
    // inline values win over the stylesheet, so the two have to agree or the
    // whole app renders a step off. `md` is the default/body size.
    "--font-ui-xs": scaledUiFont(10, normalized),
    "--font-ui-sm": scaledUiFont(11, normalized),
    "--font-ui-md": scaledUiFont(12, normalized),
    "--font-ui-lg": scaledUiFont(13, normalized),
    "--font-ui-xl": scaledUiFont(15, normalized),
    // The code font stays integer-px: fractional sizes make glyph advances
    // round differently between CodeMirror's measurements and the renderer,
    // drifting the caret off the character it edits.
    "--font-code": `${scaledUiPixels(13, normalized)}px`,
    "--editor-line-height": `${scaledUiPixels(20, normalized)}px`,
    "--control-xxs": `${scaledUiPixels(22, normalized)}px`,
    "--control-xs": `${scaledUiPixels(24, normalized)}px`,
    "--control-sm": `${scaledUiPixels(25, normalized)}px`,
    "--control-md": `${scaledUiPixels(27, normalized)}px`,
    "--bar-sm": `${scaledUiPixels(31, normalized)}px`,
    "--bar-md": `${scaledUiPixels(33, normalized)}px`,
    "--status-height": `${scaledUiPixels(22, normalized)}px`,
    "--tab-min-width": `${scaledUiPixels(120, normalized)}px`,
  };
}

export function formatUiZoom(zoom: number) {
  return `${Math.round(normalizeUiZoom(zoom) * 100)}%`;
}

export function sqlDownloadFileName(label: string) {
  const base = label
    .replace(/\.sql$/i, "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "query"}.sql`;
}

export function selectedSqlFromSelections(
  sql: string,
  selections: readonly EditorSelection[],
) {
  return selections
    .filter((selection) => selection.from !== selection.to)
    .map((selection) =>
      sql
        .slice(
          Math.min(selection.from, selection.to),
          Math.max(selection.from, selection.to),
        )
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}

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

export function isEditableTarget(
  target: EventTarget | null,
): target is HTMLElement {
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

export function builtInTheme(
  kind: ThemeKind,
  preferredThemeId?: string | null,
) {
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
