import { create } from "zustand";
import {
  isSqlFormatterId,
  type SqlFormatterId,
} from "../../sql/formatter";
import { isSqlLinterId, type SqlLinterId } from "../../sql/linter";
import type { ThemeKind } from "../../theme";

export type EditorSplitMode = "single" | "right" | "down";
type ValueUpdater<T> = T | ((current: T) => T);

const themeStorageKey = "irodori.theme.v1";
const vimModeStorageKey = "irodori.editor.vimMode.v1";
const formatterStorageKey = "irodori.editor.formatter.v1";
const linterStorageKey = "irodori.editor.linter.v1";
const sidebarStorageKey = "irodori.sidebar.open.v1";
const sidebarWidthStorageKey = "irodori.sidebar.width.v1";
const inspectorWidthStorageKey = "irodori.inspector.width.v1";
const resultsHeightStorageKey = "irodori.results.height.v1";
const editorSplitModeStorageKey = "irodori.editor.splitMode.v1";
const editorSplitSizeStorageKey = "irodori.editor.splitSize.v1";
const resultOffloadStorageKey = "irodori.results.offload.v1";
const resultMemoryBudgetStorageKey = "irodori.results.memoryBudget.v1";

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
const resultMemoryBudgetDefault = 10_000;
const resultMemoryBudgetMin = 1_000;
const resultMemoryBudgetMax = 100_000;

type PreferencesState = {
  themeKind: ThemeKind;
  vimMode: boolean;
  formatter: SqlFormatterId;
  sqlLinter: SqlLinterId;
  sidebarOpen: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  resultsHeight: number;
  editorSplitMode: EditorSplitMode;
  editorSplitPercent: number;
  resultOffloadEnabled: boolean;
  resultMemoryBudget: number;
  setThemeKind: (value: ValueUpdater<ThemeKind>) => void;
  setVimMode: (value: ValueUpdater<boolean>) => void;
  setFormatter: (value: ValueUpdater<SqlFormatterId>) => void;
  setSqlLinter: (value: ValueUpdater<SqlLinterId>) => void;
  setSidebarOpen: (value: ValueUpdater<boolean>) => void;
  setSidebarWidth: (value: ValueUpdater<number>) => void;
  setInspectorWidth: (value: ValueUpdater<number>) => void;
  setResultsHeight: (value: ValueUpdater<number>) => void;
  setEditorSplitMode: (value: ValueUpdater<EditorSplitMode>) => void;
  setEditorSplitPercent: (value: ValueUpdater<number>) => void;
  setResultOffloadEnabled: (value: ValueUpdater<boolean>) => void;
  setResultMemoryBudget: (value: ValueUpdater<number>) => void;
};

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

function loadThemeKind(): ThemeKind {
  return window.localStorage.getItem(themeStorageKey) === "light"
    ? "light"
    : "dark";
}

function loadVimMode() {
  return window.localStorage.getItem(vimModeStorageKey) === "true";
}

function loadFormatter(): SqlFormatterId {
  const stored = window.localStorage.getItem(formatterStorageKey);
  return isSqlFormatterId(stored) ? stored : "sql-formatter";
}

function loadLinter(): SqlLinterId {
  const stored = window.localStorage.getItem(linterStorageKey);
  return isSqlLinterId(stored) ? stored : "gentle";
}

function loadSidebarOpen() {
  return window.localStorage.getItem(sidebarStorageKey) !== "false";
}

function loadEditorSplitMode(): EditorSplitMode {
  const stored = window.localStorage.getItem(editorSplitModeStorageKey);
  return stored === "right" || stored === "down" ? stored : "single";
}

function loadResultOffload() {
  return window.localStorage.getItem(resultOffloadStorageKey) === "true";
}

function loadResultMemoryBudget() {
  return loadStoredNumber(
    resultMemoryBudgetStorageKey,
    resultMemoryBudgetDefault,
    resultMemoryBudgetMin,
    resultMemoryBudgetMax,
  );
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  themeKind: loadThemeKind(),
  vimMode: loadVimMode(),
  formatter: loadFormatter(),
  sqlLinter: loadLinter(),
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
  resultOffloadEnabled: loadResultOffload(),
  resultMemoryBudget: loadResultMemoryBudget(),
  setThemeKind: (value) =>
    set((state) => ({ themeKind: resolveValue(state.themeKind, value) })),
  setVimMode: (value) =>
    set((state) => ({ vimMode: resolveValue(state.vimMode, value) })),
  setFormatter: (value) =>
    set((state) => ({ formatter: resolveValue(state.formatter, value) })),
  setSqlLinter: (value) =>
    set((state) => ({ sqlLinter: resolveValue(state.sqlLinter, value) })),
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
  setResultOffloadEnabled: (value) =>
    set((state) => ({
      resultOffloadEnabled: resolveValue(state.resultOffloadEnabled, value),
    })),
  setResultMemoryBudget: (value) =>
    set((state) => ({
      resultMemoryBudget: clampNumber(
        resolveValue(state.resultMemoryBudget, value),
        resultMemoryBudgetMin,
        resultMemoryBudgetMax,
      ),
    })),
}));

usePreferencesStore.subscribe((state) => {
  window.localStorage.setItem(themeStorageKey, state.themeKind);
  window.localStorage.setItem(vimModeStorageKey, String(state.vimMode));
  window.localStorage.setItem(formatterStorageKey, state.formatter);
  window.localStorage.setItem(linterStorageKey, state.sqlLinter);
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
  window.localStorage.setItem(
    resultOffloadStorageKey,
    String(state.resultOffloadEnabled),
  );
  window.localStorage.setItem(
    resultMemoryBudgetStorageKey,
    String(state.resultMemoryBudget),
  );
});
