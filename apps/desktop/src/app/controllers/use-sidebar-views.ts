import { useGitStore } from "@/features/git";
import {
  activeWorkbenchViewForSide,
  useWorkbenchStore,
  workbenchViewIds,
  workbenchViewsForSide,
  type WorkbenchViewId,
} from "@/features/workbench";

// Which workbench views live on which side, which one is active, and the
// open/close/toggle flows shared by commands, the palette, and panel headers.
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
  const setSidebarWidth = useWorkbenchStore((state) => state.setSidebarWidth);
  const setInspectorWidth = useWorkbenchStore(
    (state) => state.setInspectorWidth,
  );
  const leftSidebarViews = workbenchViewsForSide(viewPlacements, "left");
  const rightSidebarViews = workbenchViewsForSide(viewPlacements, "right");
  const activeLeftSidebarView = activeWorkbenchViewForSide(
    viewVisibility,
    viewPlacements,
    "left",
  );
  const activeRightSidebarView = activeWorkbenchViewForSide(
    viewVisibility,
    viewPlacements,
    "right",
  );

  function viewOpenOnItsSide(viewId: WorkbenchViewId) {
    return (
      viewVisibility[viewId] &&
      (viewPlacements[viewId] === "right" ? rightSidebarOpen : sidebarOpen)
    );
  }

  function setActiveSidebarView(viewId: WorkbenchViewId) {
    const side = viewPlacements[viewId] ?? "left";
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
        if (viewPlacements[id] === side) {
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
    leftSidebarViews,
    rightSidebarViews,
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
    openGitPanel,
  };
}

export type SidebarViews = ReturnType<typeof useSidebarViews>;
