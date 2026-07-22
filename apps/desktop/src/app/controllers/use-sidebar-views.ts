import { useEffect, useMemo } from "react";
import { useExtensionRuntimeStore } from "@/features/extensions/runtime-store";
import { useGitStore } from "@/features/git";
import {
  activeWorkbenchViewForSide,
  useWorkbenchStore,
  workbenchViewIds,
  workbenchViewsForSide,
  type WorkbenchSide,
  type WorkbenchViewId,
} from "@/features/workbench";

// Which workbench views live on which side, which one is active, and the
// open/close/toggle flows shared by commands, the palette, and panel headers.
// Views can be moved between sides, hidden, and reordered (VS Code-style);
// the object browser is pinned to the left side and always visible so the
// left sidebar always has a fallback view.
export function useSidebarViews() {
  const sidebarOpen = useWorkbenchStore((state) => state.sidebarOpen);
  const setSidebarOpen = useWorkbenchStore((state) => state.setSidebarOpen);
  const rightSidebarOpen = useWorkbenchStore((state) => state.rightSidebarOpen);
  const setRightSidebarOpen = useWorkbenchStore(
    (state) => state.setRightSidebarOpen,
  );
  const viewPlacements = useWorkbenchStore((state) => state.viewPlacements);
  const setViewPlacements = useWorkbenchStore(
    (state) => state.setViewPlacements,
  );
  const setViewOpen = useWorkbenchStore((state) => state.setViewOpen);
  const viewVisibility = useWorkbenchStore((state) => state.viewVisibility);
  const setViewVisibility = useWorkbenchStore(
    (state) => state.setViewVisibility,
  );
  const viewOrder = useWorkbenchStore((state) => state.viewOrder);
  const viewHidden = useWorkbenchStore((state) => state.viewHidden);
  const extensionRuntimeLoaded = useExtensionRuntimeStore(
    (state) => state.loaded,
  );
  const enabledHostFeatures = useExtensionRuntimeStore(
    (state) => state.enabledHostFeatures,
  );
  const refreshInstalledExtensions = useExtensionRuntimeStore(
    (state) => state.refreshInstalledExtensions,
  );
  const setSidebarWidth = useWorkbenchStore((state) => state.setSidebarWidth);
  const setInspectorWidth = useWorkbenchStore(
    (state) => state.setInspectorWidth,
  );
  useEffect(() => {
    if (!extensionRuntimeLoaded) {
      void refreshInstalledExtensions().catch(() => undefined);
    }
  }, [extensionRuntimeLoaded, refreshInstalledExtensions]);

  const unavailableFeatureViews = useMemo(
    () => ({
      knowledge: !enabledHostFeatures.includes("knowledge"),
      lakehouse: !enabledHostFeatures.includes("datalake"),
    }),
    [enabledHostFeatures],
  );
  const effectiveViewHidden = useMemo(
    () => ({
      ...viewHidden,
      knowledge: viewHidden.knowledge || unavailableFeatureViews.knowledge,
      lakehouse: viewHidden.lakehouse || unavailableFeatureViews.lakehouse,
    }),
    [unavailableFeatureViews, viewHidden],
  );
  useEffect(() => {
    if (!extensionRuntimeLoaded) {
      return;
    }
    const state = useWorkbenchStore.getState();
    if (unavailableFeatureViews.knowledge && state.viewVisibility.knowledge) {
      state.setViewOpen("knowledge", false);
    }
    if (unavailableFeatureViews.lakehouse && state.viewVisibility.lakehouse) {
      state.setViewOpen("lakehouse", false);
    }
  }, [extensionRuntimeLoaded, unavailableFeatureViews]);
  const leftSidebarViews = workbenchViewsForSide(
    viewPlacements,
    "left",
    viewOrder,
    effectiveViewHidden,
  );
  const rightSidebarViews = workbenchViewsForSide(
    viewPlacements,
    "right",
    viewOrder,
    effectiveViewHidden,
  );
  // All views assigned to a side (hidden ones included) for the tab context
  // menu's show/hide checklist.
  const leftSidebarAllViews = workbenchViewsForSide(
    viewPlacements,
    "left",
    viewOrder,
    unavailableFeatureViews,
  );
  const rightSidebarAllViews = workbenchViewsForSide(
    viewPlacements,
    "right",
    viewOrder,
    unavailableFeatureViews,
  );
  const activeLeftSidebarView = activeWorkbenchViewForSide(
    viewVisibility,
    viewPlacements,
    "left",
    viewOrder,
    effectiveViewHidden,
  );
  const activeRightSidebarView = activeWorkbenchViewForSide(
    viewVisibility,
    viewPlacements,
    "right",
    viewOrder,
    effectiveViewHidden,
  );

  function viewOpenOnItsSide(viewId: WorkbenchViewId) {
    return (
      viewVisibility[viewId] &&
      (viewPlacements[viewId] === "right" ? rightSidebarOpen : sidebarOpen)
    );
  }

  function setActiveSidebarView(viewId: WorkbenchViewId) {
    if (
      (viewId === "knowledge" && unavailableFeatureViews.knowledge) ||
      (viewId === "lakehouse" && unavailableFeatureViews.lakehouse)
    ) {
      return;
    }
    // Read the latest placements so activation directly after a move/hide
    // works with the just-updated state instead of this render's snapshot.
    const placements = useWorkbenchStore.getState().viewPlacements;
    const side = placements[viewId] ?? "left";
    if (side === "right") {
      setRightSidebarOpen(true);
    } else {
      setSidebarOpen(true);
    }
    // The chat panel needs more room than a tree view; open it comfortably wide
    // (without shrinking a side the user already widened).
    if (viewId === "aiChat") {
      const comfortable = 420;
      if (side === "right") {
        setInspectorWidth((current) => Math.max(current, comfortable));
      } else {
        setSidebarWidth((current) => Math.max(current, comfortable));
      }
    }
    setViewVisibility((current) => {
      const next = { ...current };
      workbenchViewIds.forEach((id) => {
        if (placements[id] === side) {
          next[id] = id === viewId;
        }
      });
      return next;
    });
  }

  function closeSidebarView(viewId: WorkbenchViewId) {
    const side = viewPlacements[viewId] ?? "left";
    setViewOpen(viewId, false);
    if (side === "right") {
      setRightSidebarOpen(false);
      return;
    }
    setActiveSidebarView("objectBrowser");
  }

  function toggleSidebarView(
    viewId: Exclude<WorkbenchViewId, "objectBrowser">,
  ) {
    const side = viewPlacements[viewId] ?? "left";
    const sideOpen = side === "right" ? rightSidebarOpen : sidebarOpen;
    if (sideOpen && viewVisibility[viewId]) {
      closeSidebarView(viewId);
      return;
    }
    setActiveSidebarView(viewId);
  }

  function toggleRightSidebar() {
    if (rightSidebarOpen) {
      setRightSidebarOpen(false);
      return;
    }
    setActiveSidebarView(activeRightSidebarView);
  }

  // Re-activate a sensible view on a side after the current one was moved
  // away or hidden: first remaining view, or fall back to the object browser
  // on the left and an empty (closed) right sidebar.
  function activateSideFallback(side: WorkbenchSide) {
    const state = useWorkbenchStore.getState();
    const remaining = workbenchViewsForSide(
      state.viewPlacements,
      side,
      state.viewOrder,
      {
        ...state.viewHidden,
        knowledge:
          state.viewHidden.knowledge || unavailableFeatureViews.knowledge,
        lakehouse:
          state.viewHidden.lakehouse || unavailableFeatureViews.lakehouse,
      },
    );
    if (remaining.length > 0) {
      setActiveSidebarView(
        remaining.find((id) => state.viewVisibility[id]) ?? remaining[0],
      );
      return;
    }
    if (side === "right") {
      setRightSidebarOpen(false);
    }
  }

  function moveView(viewId: WorkbenchViewId, side: WorkbenchSide) {
    if (viewId === "objectBrowser") {
      return;
    }
    const fromSide = viewPlacements[viewId] ?? "left";
    if (fromSide === side) {
      return;
    }
    const wasActiveOnItsSide =
      viewId ===
      (fromSide === "right" ? activeRightSidebarView : activeLeftSidebarView);
    setViewPlacements((current) => ({ ...current, [viewId]: side }));
    // Follow the view to its new side (VS Code focuses a moved view) and
    // repair the side it left.
    setActiveSidebarView(viewId);
    if (wasActiveOnItsSide) {
      activateSideFallback(fromSide);
    }
  }

  function setViewHidden(viewId: WorkbenchViewId, hidden: boolean) {
    if (viewId === "objectBrowser") {
      return;
    }
    if (
      (viewId === "knowledge" && unavailableFeatureViews.knowledge) ||
      (viewId === "lakehouse" && unavailableFeatureViews.lakehouse)
    ) {
      return;
    }
    const side = viewPlacements[viewId] ?? "left";
    const wasActiveOnItsSide =
      viewId ===
      (side === "right" ? activeRightSidebarView : activeLeftSidebarView);
    useWorkbenchStore.getState().setViewHidden(viewId, hidden);
    if (hidden) {
      setViewOpen(viewId, false);
      if (wasActiveOnItsSide) {
        activateSideFallback(side);
      }
      return;
    }
    setActiveSidebarView(viewId);
  }

  // Drop `sourceId` before or after `targetId` in the shared tab order.
  function reorderView(
    sourceId: WorkbenchViewId,
    targetId: WorkbenchViewId,
    position: "before" | "after",
  ) {
    if (sourceId === targetId) {
      return;
    }
    useWorkbenchStore.getState().setViewOrder((current) => {
      const withoutSource = current.filter((id) => id !== sourceId);
      const targetIndex = withoutSource.indexOf(targetId);
      if (targetIndex === -1) {
        return current;
      }
      const insertAt = position === "before" ? targetIndex : targetIndex + 1;
      return [
        ...withoutSource.slice(0, insertAt),
        sourceId,
        ...withoutSource.slice(insertAt),
      ];
    });
  }

  function openGitPanel() {
    setActiveSidebarView("git");
    void useGitStore.getState().refresh();
  }

  return {
    sidebarOpen,
    setSidebarOpen,
    rightSidebarOpen,
    setRightSidebarOpen,
    viewPlacements,
    setViewPlacements,
    viewVisibility,
    setViewVisibility,
    viewHidden: effectiveViewHidden,
    enabledHostFeatures,
    leftSidebarViews,
    rightSidebarViews,
    leftSidebarAllViews,
    rightSidebarAllViews,
    activeLeftSidebarView,
    activeRightSidebarView,
    completionOpen: viewOpenOnItsSide("completion"),
    historyOpen: viewOpenOnItsSide("queryHistory"),
    planOpen: viewOpenOnItsSide("plan"),
    biOpen: viewOpenOnItsSide("bi"),
    setActiveSidebarView,
    closeSidebarView,
    toggleSidebarView,
    toggleRightSidebar,
    moveView,
    setViewHidden,
    reorderView,
    openGitPanel,
  };
}

export type SidebarViews = ReturnType<typeof useSidebarViews>;
