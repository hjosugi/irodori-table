import { create } from "zustand";
import {
  defaultWorkbenchViewVisibility,
  defaultWorkbenchViewPlacements,
  workbenchViewIds,
  type WorkbenchSide,
  type WorkbenchViewId,
  type WorkbenchViewPlacements,
  type WorkbenchViewVisibility,
} from "../types";

export type EditorSplitMode = "single" | "right" | "down";
export type SidebarSide = WorkbenchSide;

type ValueUpdater<T> = T | ((current: T) => T);

type WorkbenchState = {
  sidebarOpen: boolean;
  sidebarSide: SidebarSide;
  viewPlacements: WorkbenchViewPlacements;
  viewVisibility: WorkbenchViewVisibility;
  sidebarWidth: number;
  inspectorWidth: number;
  resultsHeight: number;
  editorSplitMode: EditorSplitMode;
  editorSplitPercent: number;
  setSidebarOpen: (value: ValueUpdater<boolean>) => void;
  setSidebarSide: (value: ValueUpdater<SidebarSide>) => void;
  setViewPlacement: (viewId: WorkbenchViewId, side: WorkbenchSide) => void;
  setViewPlacements: (value: ValueUpdater<WorkbenchViewPlacements>) => void;
  setViewOpen: (viewId: WorkbenchViewId, value: ValueUpdater<boolean>) => void;
  setViewVisibility: (value: ValueUpdater<WorkbenchViewVisibility>) => void;
  setSidebarWidth: (value: ValueUpdater<number>) => void;
  setInspectorWidth: (value: ValueUpdater<number>) => void;
  setResultsHeight: (value: ValueUpdater<number>) => void;
  setEditorSplitMode: (value: ValueUpdater<EditorSplitMode>) => void;
  setEditorSplitPercent: (value: ValueUpdater<number>) => void;
};

const sidebarStorageKey = "irodori.sidebar.open.v1";
const sidebarSideStorageKey = "irodori.sidebar.side.v1";
const viewPlacementsStorageKey = "irodori.workbench.viewPlacements.v1";
const viewVisibilityStorageKey = "irodori.workbench.viewVisibility.v1";
const sidebarWidthStorageKey = "irodori.sidebar.width.v2";
const inspectorWidthStorageKey = "irodori.inspector.width.v1";
const resultsHeightStorageKey = "irodori.results.height.v2";
const editorSplitModeStorageKey = "irodori.editor.splitMode.v1";
const editorSplitSizeStorageKey = "irodori.editor.splitSize.v1";

const sidebarWidthDefault = 220;
const sidebarWidthMin = 180;
const sidebarWidthMax = 420;
const inspectorWidthDefault = 300;
const inspectorWidthMin = 220;
const inspectorWidthMax = 420;
const resultsHeightDefault = 340;
const resultsHeightMin = 220;
const resultsHeightMax = 560;
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
  const raw = window.localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }
  const stored = Number(raw);
  return Number.isFinite(stored) ? clampNumber(stored, min, max) : fallback;
}

function loadSidebarOpen() {
  return window.localStorage.getItem(sidebarStorageKey) !== "false";
}

function loadSidebarSide(): SidebarSide {
  return window.localStorage.getItem(sidebarSideStorageKey) === "right"
    ? "right"
    : "left";
}

function isWorkbenchSide(value: unknown): value is WorkbenchSide {
  return value === "left" || value === "right";
}

function defaultViewPlacements(): WorkbenchViewPlacements {
  return { ...defaultWorkbenchViewPlacements };
}

function defaultViewVisibility(): WorkbenchViewVisibility {
  return { ...defaultWorkbenchViewVisibility };
}

function normalizeViewPlacements(value: unknown): WorkbenchViewPlacements {
  const next = defaultViewPlacements();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return next;
  }

  const stored = value as Partial<Record<WorkbenchViewId, unknown>>;
  workbenchViewIds.forEach((viewId) => {
    const side = stored[viewId];
    if (isWorkbenchSide(side)) {
      next[viewId] = side;
    }
  });
  return next;
}

function normalizeViewVisibility(value: unknown): WorkbenchViewVisibility {
  const next = defaultViewVisibility();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return next;
  }

  const stored = value as Partial<Record<WorkbenchViewId, unknown>>;
  workbenchViewIds.forEach((viewId) => {
    const open = stored[viewId];
    if (typeof open === "boolean") {
      next[viewId] = open;
    }
  });
  return next;
}

function loadViewPlacements(): WorkbenchViewPlacements {
  const stored = window.localStorage.getItem(viewPlacementsStorageKey);
  if (!stored) {
    return defaultViewPlacements();
  }
  try {
    return normalizeViewPlacements(JSON.parse(stored));
  } catch {
    return defaultViewPlacements();
  }
}

function loadViewVisibility(): WorkbenchViewVisibility {
  const stored = window.localStorage.getItem(viewVisibilityStorageKey);
  if (!stored) {
    return defaultViewVisibility();
  }
  try {
    return normalizeViewVisibility(JSON.parse(stored));
  } catch {
    return defaultViewVisibility();
  }
}

function loadEditorSplitMode(): EditorSplitMode {
  const stored = window.localStorage.getItem(editorSplitModeStorageKey);
  return stored === "right" || stored === "down" ? stored : "single";
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  sidebarOpen: loadSidebarOpen(),
  sidebarSide: loadSidebarSide(),
  viewPlacements: loadViewPlacements(),
  viewVisibility: loadViewVisibility(),
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
  setSidebarSide: (value) =>
    set((state) => ({ sidebarSide: resolveValue(state.sidebarSide, value) })),
  setViewPlacement: (viewId, side) =>
    set((state) => ({
      viewPlacements: normalizeViewPlacements({
        ...state.viewPlacements,
        [viewId]: side,
      }),
    })),
  setViewPlacements: (value) =>
    set((state) => ({
      viewPlacements: normalizeViewPlacements(
        resolveValue(state.viewPlacements, value),
      ),
    })),
  setViewOpen: (viewId, value) =>
    set((state) => ({
      viewVisibility: normalizeViewVisibility({
        ...state.viewVisibility,
        [viewId]: resolveValue(state.viewVisibility[viewId], value),
      }),
    })),
  setViewVisibility: (value) =>
    set((state) => ({
      viewVisibility: normalizeViewVisibility(
        resolveValue(state.viewVisibility, value),
      ),
    })),
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
  window.localStorage.setItem(sidebarSideStorageKey, state.sidebarSide);
  window.localStorage.setItem(
    viewPlacementsStorageKey,
    JSON.stringify(state.viewPlacements),
  );
  window.localStorage.setItem(
    viewVisibilityStorageKey,
    JSON.stringify(state.viewVisibility),
  );
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
