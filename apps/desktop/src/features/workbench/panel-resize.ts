import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import type { EditorSplitMode } from "./store/workbench-store";

type ValueUpdater<T> = T | ((current: T) => T);
type NumberSetter = (value: ValueUpdater<number>) => void;

export type PanelResizeKind =
  | "sidebar"
  | "rightSidebar"
  | "leftInspector"
  | "inspector"
  | "results"
  | "editorSplit";

export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 420;
export const INSPECTOR_WIDTH_MIN = 220;
export const INSPECTOR_WIDTH_MAX = 420;
export const RESULTS_HEIGHT_MIN = 220;
export const RESULTS_HEIGHT_MAX = 560;
export const EDITOR_SPLIT_MIN = 28;
export const EDITOR_SPLIT_MAX = 72;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type PanelResizeControllerOptions = {
  sidebarWidth: number;
  inspectorWidth: number;
  resultsHeight: number;
  editorSplitMode: EditorSplitMode;
  editorSplitRef: RefObject<HTMLDivElement | null>;
  setSidebarWidth: NumberSetter;
  setInspectorWidth: NumberSetter;
  setResultsHeight: NumberSetter;
  setEditorSplitPercent: NumberSetter;
};

export function createPanelResizeController({
  sidebarWidth,
  inspectorWidth,
  resultsHeight,
  editorSplitMode,
  editorSplitRef,
  setSidebarWidth,
  setInspectorWidth,
  setResultsHeight,
  setEditorSplitPercent,
}: PanelResizeControllerOptions) {
  function resizePanel(kind: PanelResizeKind, delta: number) {
    switch (kind) {
      case "sidebar":
      case "rightSidebar":
        setSidebarWidth((current) =>
          clampNumber(current + delta, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX),
        );
        break;
      case "leftInspector":
      case "inspector":
        setInspectorWidth((current) =>
          clampNumber(
            current + delta,
            INSPECTOR_WIDTH_MIN,
            INSPECTOR_WIDTH_MAX,
          ),
        );
        break;
      case "results":
        setResultsHeight((current) =>
          clampNumber(current + delta, RESULTS_HEIGHT_MIN, RESULTS_HEIGHT_MAX),
        );
        break;
      case "editorSplit":
        setEditorSplitPercent((current) =>
          clampNumber(current + delta, EDITOR_SPLIT_MIN, EDITOR_SPLIT_MAX),
        );
        break;
    }
  }

  function beginPanelResize(
    kind: PanelResizeKind,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSidebarWidth = sidebarWidth;
    const startInspectorWidth = inspectorWidth;
    const startResultsHeight = resultsHeight;
    const editorSplitBounds = editorSplitRef.current?.getBoundingClientRect();
    document.body.classList.add("panel-resizing");

    const onMove = (moveEvent: PointerEvent) => {
      if (kind === "editorSplit") {
        if (!editorSplitBounds) {
          return;
        }
        const next =
          editorSplitMode === "down"
            ? ((moveEvent.clientY - editorSplitBounds.top) /
                Math.max(1, editorSplitBounds.height)) *
              100
            : ((moveEvent.clientX - editorSplitBounds.left) /
                Math.max(1, editorSplitBounds.width)) *
              100;
        setEditorSplitPercent(
          clampNumber(next, EDITOR_SPLIT_MIN, EDITOR_SPLIT_MAX),
        );
        return;
      }
      if (kind === "sidebar" || kind === "rightSidebar") {
        const delta = moveEvent.clientX - startX;
        setSidebarWidth(
          clampNumber(
            startSidebarWidth + (kind === "rightSidebar" ? -delta : delta),
            SIDEBAR_WIDTH_MIN,
            SIDEBAR_WIDTH_MAX,
          ),
        );
        return;
      }
      if (kind === "inspector") {
        setInspectorWidth(
          clampNumber(
            startInspectorWidth - (moveEvent.clientX - startX),
            INSPECTOR_WIDTH_MIN,
            INSPECTOR_WIDTH_MAX,
          ),
        );
        return;
      }
      if (kind === "leftInspector") {
        setInspectorWidth(
          clampNumber(
            startInspectorWidth + (moveEvent.clientX - startX),
            INSPECTOR_WIDTH_MIN,
            INSPECTOR_WIDTH_MAX,
          ),
        );
        return;
      }
      setResultsHeight(
        clampNumber(
          startResultsHeight - (moveEvent.clientY - startY),
          RESULTS_HEIGHT_MIN,
          RESULTS_HEIGHT_MAX,
        ),
      );
    };

    const onEnd = () => {
      document.body.classList.remove("panel-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
    window.addEventListener("pointercancel", onEnd, { once: true });
  }

  function onPanelResizeKey(
    kind: PanelResizeKind,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown"
    ) {
      return;
    }
    event.preventDefault();
    const step = event.shiftKey ? 32 : 16;
    if (kind === "editorSplit") {
      if (editorSplitMode === "down") {
        resizePanel(kind, event.key === "ArrowDown" ? 4 : -4);
      } else {
        resizePanel(kind, event.key === "ArrowRight" ? 4 : -4);
      }
      return;
    }
    if (kind === "results") {
      resizePanel(kind, event.key === "ArrowUp" ? step : -step);
      return;
    }
    if (kind === "sidebar" || kind === "rightSidebar") {
      const direction = kind === "rightSidebar" ? -1 : 1;
      resizePanel(kind, (event.key === "ArrowRight" ? step : -step) * direction);
      return;
    }
    if (kind === "leftInspector") {
      resizePanel(kind, event.key === "ArrowRight" ? step : -step);
      return;
    }
    resizePanel(kind, event.key === "ArrowLeft" ? step : -step);
  }

  return { beginPanelResize, onPanelResizeKey };
}
