import { create } from "zustand";

export type EditorSplitMode = "single" | "right" | "down";

type ValueUpdater<T> = T | ((current: T) => T);

type WorkbenchState = {
  sidebarOpen: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  resultsHeight: number;
  editorSplitMode: EditorSplitMode;
  editorSplitPercent: number;
  setSidebarOpen: (value: ValueUpdater<boolean>) => void;
  setSidebarWidth: (value: ValueUpdater<number>) => void;
  setInspectorWidth: (value: ValueUpdater<number>) => void;
  setResultsHeight: (value: ValueUpdater<number>) => void;
  setEditorSplitMode: (value: ValueUpdater<EditorSplitMode>) => void;
  setEditorSplitPercent: (value: ValueUpdater<number>) => void;
};

const sidebarStorageKey = "irodori.sidebar.open.v1";
const sidebarWidthStorageKey = "irodori.sidebar.width.v1";
const inspectorWidthStorageKey = "irodori.inspector.width.v1";
const resultsHeightStorageKey = "irodori.results.height.v1";
const editorSplitModeStorageKey = "irodori.editor.splitMode.v1";
const editorSplitSizeStorageKey = "irodori.editor.splitSize.v1";

const sidebarWidthDefault = 300;
const sidebarWidthMin = 220;
const sidebarWidthMax = 420;
const inspectorWidthDefault = 300;
const inspectorWidthMin = 220;
const inspectorWidthMax = 420;
const resultsHeightDefault = 240;
const resultsHeightMin = 160;
const resultsHeightMax = 520;
const editorSplitPercentDefault = 50;
const editorSplitPercentMin = 28;
const editorSplitPercentMax = 72;

function resolveValue<T>(current: T, value: ValueUpdater<T>): T {
  return typeof value === "function"
    ? (value as (current: T) => T)(current)
    : value;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function loadStoredNumber(
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const stored = Number(window.localStorage.getItem(key));
  return Number.isFinite(stored) ? clampNumber(stored, min, max) : fallback;
}

function loadSidebarOpen() {
  return window.localStorage.getItem(sidebarStorageKey) !== "false";
}

function loadEditorSplitMode(): EditorSplitMode {
  const stored = window.localStorage.getItem(editorSplitModeStorageKey);
  return stored === "right" || stored === "down" ? stored : "single";
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  sidebarOpen: loadSidebarOpen(),
  sidebarWidth: loadStoredNumber(
    sidebarWidthStorageKey,
    sidebarWidthDefault,
    sidebarWidthMin,
    sidebarWidthMax,
  ),
  inspectorWidth: loadStoredNumber(
    inspectorWidthStorageKey,
    inspectorWidthDefault,
    inspectorWidthMin,
    inspectorWidthMax,
  ),
  resultsHeight: loadStoredNumber(
    resultsHeightStorageKey,
    resultsHeightDefault,
    resultsHeightMin,
    resultsHeightMax,
  ),
  editorSplitMode: loadEditorSplitMode(),
  editorSplitPercent: loadStoredNumber(
    editorSplitSizeStorageKey,
    editorSplitPercentDefault,
    editorSplitPercentMin,
    editorSplitPercentMax,
  ),
  setSidebarOpen: (value) =>
    set((state) => ({ sidebarOpen: resolveValue(state.sidebarOpen, value) })),
  setSidebarWidth: (value) =>
    set((state) => ({
      sidebarWidth: clampNumber(
        resolveValue(state.sidebarWidth, value),
        sidebarWidthMin,
        sidebarWidthMax,
      ),
    })),
  setInspectorWidth: (value) =>
    set((state) => ({
      inspectorWidth: clampNumber(
        resolveValue(state.inspectorWidth, value),
        inspectorWidthMin,
        inspectorWidthMax,
      ),
    })),
  setResultsHeight: (value) =>
    set((state) => ({
      resultsHeight: clampNumber(
        resolveValue(state.resultsHeight, value),
        resultsHeightMin,
        resultsHeightMax,
      ),
    })),
  setEditorSplitMode: (value) =>
    set((state) => ({
      editorSplitMode: resolveValue(state.editorSplitMode, value),
    })),
  setEditorSplitPercent: (value) =>
    set((state) => ({
      editorSplitPercent: clampNumber(
        resolveValue(state.editorSplitPercent, value),
        editorSplitPercentMin,
        editorSplitPercentMax,
      ),
    })),
}));

useWorkbenchStore.subscribe((state) => {
  window.localStorage.setItem(sidebarStorageKey, String(state.sidebarOpen));
  window.localStorage.setItem(sidebarWidthStorageKey, String(state.sidebarWidth));
  window.localStorage.setItem(
    inspectorWidthStorageKey,
    String(state.inspectorWidth),
  );
  window.localStorage.setItem(resultsHeightStorageKey, String(state.resultsHeight));
  window.localStorage.setItem(editorSplitModeStorageKey, state.editorSplitMode);
  window.localStorage.setItem(
    editorSplitSizeStorageKey,
    String(state.editorSplitPercent),
  );
});
