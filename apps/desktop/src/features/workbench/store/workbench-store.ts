import { create } from "zustand";
import { parseStoredNumber } from "@/core";
import {
  defaultWorkbenchViewHidden,
  defaultWorkbenchViewVisibility,
  defaultWorkbenchViewPlacements,
  normalizeWorkbenchViewOrder,
  workbenchViewIds,
  type WorkbenchSide,
  type WorkbenchViewHidden,
  type WorkbenchViewId,
  type WorkbenchViewPlacements,
  type WorkbenchViewVisibility,
} from "../types";
import type { EditorSplitMode } from "@/lib/editor-split-mode";

export type { EditorSplitMode } from "@/lib/editor-split-mode";
export type SidebarSide = WorkbenchSide;

type ValueUpdater<T> = T | ((current: T) => T);

type WorkbenchState = {
  sidebarOpen: boolean;
  rightSidebarOpen: boolean;
  sidebarSide: SidebarSide;
  viewPlacements: WorkbenchViewPlacements;
  viewVisibility: WorkbenchViewVisibility;
  viewOrder: WorkbenchViewId[];
  viewHidden: WorkbenchViewHidden;
  sidebarWidth: number;
  inspectorWidth: number;
  resultsHeight: number;
  editorSplitMode: EditorSplitMode;
  editorSplitPercent: number;
  setSidebarOpen: (value: ValueUpdater<boolean>) => void;
  setRightSidebarOpen: (value: ValueUpdater<boolean>) => void;
  setSidebarSide: (value: ValueUpdater<SidebarSide>) => void;
  setViewPlacement: (viewId: WorkbenchViewId, side: WorkbenchSide) => void;
  setViewPlacements: (value: ValueUpdater<WorkbenchViewPlacements>) => void;
  setViewOpen: (viewId: WorkbenchViewId, value: ValueUpdater<boolean>) => void;
  setViewVisibility: (value: ValueUpdater<WorkbenchViewVisibility>) => void;
  setViewOrder: (value: ValueUpdater<WorkbenchViewId[]>) => void;
  setViewHidden: (
    viewId: WorkbenchViewId,
    value: ValueUpdater<boolean>,
  ) => void;
  setSidebarWidth: (value: ValueUpdater<number>) => void;
  setInspectorWidth: (value: ValueUpdater<number>) => void;
  setResultsHeight: (value: ValueUpdater<number>) => void;
  setEditorSplitMode: (value: ValueUpdater<EditorSplitMode>) => void;
  setEditorSplitPercent: (value: ValueUpdater<number>) => void;
  resetLayout: () => void;
};

const sidebarStorageKey = "irodori.sidebar.open.v1";
const rightSidebarStorageKey = "irodori.sidebar.right.open.v1";
const sidebarSideStorageKey = "irodori.sidebar.side.v1";
const viewPlacementsStorageKey = "irodori.workbench.viewPlacements.v1";
const viewVisibilityStorageKey = "irodori.workbench.viewVisibility.v1";
const viewOrderStorageKey = "irodori.workbench.viewOrder.v1";
const viewHiddenStorageKey = "irodori.workbench.viewHidden.v1";
const sidebarWidthStorageKey = "irodori.sidebar.width.v2";
const inspectorWidthStorageKey = "irodori.inspector.width.v1";
const resultsHeightStorageKey = "irodori.results.height.v2";
const editorSplitModeStorageKey = "irodori.editor.splitMode.v1";
const editorSplitSizeStorageKey = "irodori.editor.splitSize.v1";

const sidebarWidthDefault = 200;
// Floors match the dock panel minimums in WorkbenchDockLayout: narrow enough to
// be a real compact state (icon view tabs, truncated rows) rather than a point
// at which the panel is taken away.
const sidebarWidthMin = 132;
const sidebarWidthMax = 640;
const inspectorWidthDefault = 300;
const inspectorWidthMin = 168;
const inspectorWidthMax = 640;
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
  // parseStoredNumber also treats "" as absent, which the raw === null guard
  // here missed - Number("") is 0, the same trap as Number(null) (#166).
  const stored = parseStoredNumber(window.localStorage.getItem(key));
  return stored === null ? fallback : clampNumber(stored, min, max);
}

function loadSidebarOpen() {
  return window.localStorage.getItem(sidebarStorageKey) !== "false";
}

function loadRightSidebarOpen() {
  return window.localStorage.getItem(rightSidebarStorageKey) === "true";
}

function loadSidebarSide(): SidebarSide {
  const stored = window.localStorage.getItem(sidebarSideStorageKey);
  return stored === "right" ? "right" : "left";
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
    if (viewId === "objectBrowser") {
      next.objectBrowser = "left";
      return;
    }
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

// The object browser is the guaranteed fallback view on the left side, so it
// can never be hidden.
function normalizeViewHidden(value: unknown): WorkbenchViewHidden {
  const next = { ...defaultWorkbenchViewHidden };
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return next;
  }
  const stored = value as Partial<Record<WorkbenchViewId, unknown>>;
  workbenchViewIds.forEach((viewId) => {
    if (viewId === "objectBrowser") {
      return;
    }
    const hidden = stored[viewId];
    if (typeof hidden === "boolean") {
      next[viewId] = hidden;
    }
  });
  return next;
}

function loadViewOrder(): WorkbenchViewId[] {
  const stored = window.localStorage.getItem(viewOrderStorageKey);
  if (!stored) {
    return normalizeWorkbenchViewOrder(null);
  }
  try {
    return normalizeWorkbenchViewOrder(JSON.parse(stored));
  } catch {
    return normalizeWorkbenchViewOrder(null);
  }
}

function loadViewHidden(): WorkbenchViewHidden {
  const stored = window.localStorage.getItem(viewHiddenStorageKey);
  if (!stored) {
    return { ...defaultWorkbenchViewHidden };
  }
  try {
    return normalizeViewHidden(JSON.parse(stored));
  } catch {
    return { ...defaultWorkbenchViewHidden };
  }
}

// Every piece of layout the user can rearrange, at its shipped value. Panel
// order, sizes, sides, and which views are hidden are one concept to a user
// ("my layout"), and they get scrambled together, so they reset together —
// eight separate reset buttons would be worse than one.
function defaultLayoutState() {
  return {
    sidebarOpen: true,
    rightSidebarOpen: false,
    sidebarSide: "left" as SidebarSide,
    viewPlacements: defaultViewPlacements(),
    viewVisibility: defaultViewVisibility(),
    viewOrder: normalizeWorkbenchViewOrder(null),
    viewHidden: { ...defaultWorkbenchViewHidden },
    sidebarWidth: sidebarWidthDefault,
    inspectorWidth: inspectorWidthDefault,
    resultsHeight: resultsHeightDefault,
    editorSplitMode: "single" as EditorSplitMode,
    editorSplitPercent: editorSplitPercentDefault,
  };
}

// Editor pane splitting has been removed; the editor is always a single pane
// (open a second window to compare queries). We keep the state field so callers
// still compile, but it is pinned to "single".

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  sidebarOpen: loadSidebarOpen(),
  rightSidebarOpen: loadRightSidebarOpen(),
  sidebarSide: loadSidebarSide(),
  viewPlacements: loadViewPlacements(),
  viewVisibility: loadViewVisibility(),
  viewOrder: loadViewOrder(),
  viewHidden: loadViewHidden(),
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
  editorSplitMode: "single",
  editorSplitPercent: loadStoredNumber(
    editorSplitSizeStorageKey,
    editorSplitPercentDefault,
    editorSplitPercentMin,
    editorSplitPercentMax,
  ),
  setSidebarOpen: (value) =>
    set((state) => ({ sidebarOpen: resolveValue(state.sidebarOpen, value) })),
  setRightSidebarOpen: (value) =>
    set((state) => ({
      rightSidebarOpen: resolveValue(state.rightSidebarOpen, value),
    })),
  setSidebarSide: (value) =>
    set((state) => {
      const next = resolveValue(state.sidebarSide, value);
      return { sidebarSide: next === "right" ? "right" : "left" };
    }),
  setViewPlacement: (viewId, side) =>
    set((state) => ({
      viewPlacements: normalizeViewPlacements({
        ...state.viewPlacements,
        [viewId]: viewId === "objectBrowser" ? "left" : side,
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
  setViewOrder: (value) =>
    set((state) => ({
      viewOrder: normalizeWorkbenchViewOrder(
        resolveValue(state.viewOrder, value),
      ),
    })),
  setViewHidden: (viewId, value) =>
    set((state) => ({
      viewHidden: normalizeViewHidden({
        ...state.viewHidden,
        [viewId]: resolveValue(state.viewHidden[viewId], value),
      }),
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
  // The store's subscriber writes every layout key on any change, so setting
  // the defaults here also overwrites the persisted values.
  resetLayout: () => set(() => defaultLayoutState()),
  // Splitting is disabled; keep the setter as a no-op so existing callers
  // continue to type-check while the editor stays a single pane.
  setEditorSplitMode: () => set(() => ({ editorSplitMode: "single" })),
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
  window.localStorage.setItem(
    rightSidebarStorageKey,
    String(state.rightSidebarOpen),
  );
  window.localStorage.setItem(sidebarSideStorageKey, state.sidebarSide);
  window.localStorage.setItem(
    viewPlacementsStorageKey,
    JSON.stringify(state.viewPlacements),
  );
  window.localStorage.setItem(
    viewVisibilityStorageKey,
    JSON.stringify(state.viewVisibility),
  );
  window.localStorage.setItem(
    viewOrderStorageKey,
    JSON.stringify(state.viewOrder),
  );
  window.localStorage.setItem(
    viewHiddenStorageKey,
    JSON.stringify(state.viewHidden),
  );
  window.localStorage.setItem(
    sidebarWidthStorageKey,
    String(state.sidebarWidth),
  );
  window.localStorage.setItem(
    inspectorWidthStorageKey,
    String(state.inspectorWidth),
  );
  window.localStorage.setItem(
    resultsHeightStorageKey,
    String(state.resultsHeight),
  );
  window.localStorage.setItem(editorSplitModeStorageKey, state.editorSplitMode);
  window.localStorage.setItem(
    editorSplitSizeStorageKey,
    String(state.editorSplitPercent),
  );
});
