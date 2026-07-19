// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeWorkbenchView,
  defaultWorkbenchViewPlacements,
  defaultWorkbenchViewVisibility,
  workbenchViewIds,
  workbenchViewsForSide,
  type WorkbenchViewPlacements,
  type WorkbenchViewVisibility,
} from "@/features/workbench/types";

const viewPlacementsStorageKey = "irodori.workbench.viewPlacements.v1";
const viewVisibilityStorageKey = "irodori.workbench.viewVisibility.v1";
const viewHiddenStorageKey = "irodori.workbench.viewHidden.v1";
const sidebarSideStorageKey = "irodori.sidebar.side.v1";
const sidebarWidthStorageKey = "irodori.sidebar.width.v2";
const resultsHeightStorageKey = "irodori.results.height.v2";

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear() {
        values.clear();
      },
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      key(index: number) {
        return Array.from(values.keys())[index] ?? null;
      },
      removeItem(key: string) {
        values.delete(key);
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    },
  });
}

async function loadWorkbenchStore() {
  vi.resetModules();
  const module = await import("@/features/workbench/store/workbench-store");
  return module.useWorkbenchStore;
}

describe("workbench store view placements", () => {
  beforeEach(() => {
    installLocalStorage();
    vi.resetModules();
  });

  it("loads default view placements", async () => {
    const store = await loadWorkbenchStore();

    expect(store.getState().viewPlacements).toEqual(
      defaultWorkbenchViewPlacements,
    );
  });

  it("sets and persists a single view placement", async () => {
    const store = await loadWorkbenchStore();
    const expected: WorkbenchViewPlacements = {
      ...defaultWorkbenchViewPlacements,
      queryHistory: "right",
    };

    store.getState().setViewPlacement("queryHistory", "right");

    expect(store.getState().viewPlacements).toEqual(expected);
    expect(
      JSON.parse(window.localStorage.getItem(viewPlacementsStorageKey) ?? "{}"),
    ).toEqual(expected);
  });

  it("accepts left and right placements while pinning object browser left", async () => {
    const store = await loadWorkbenchStore();
    const requested: WorkbenchViewPlacements = {
      ...defaultWorkbenchViewPlacements,
      objectBrowser: "right",
      bi: "left",
      git: "left",
    };
    const expected: WorkbenchViewPlacements = {
      ...requested,
      objectBrowser: "left",
    };

    store.getState().setViewPlacements(requested);

    expect(store.getState().viewPlacements).toEqual(expected);
    expect(
      JSON.parse(window.localStorage.getItem(viewPlacementsStorageKey) ?? "{}"),
    ).toEqual(expected);
  });

  it("sanitizes stored view placements", async () => {
    window.localStorage.setItem(
      viewPlacementsStorageKey,
      JSON.stringify({
        objectBrowser: "right",
        completion: "middle",
        queryHistory: "left",
        unknownView: "left",
      }),
    );

    const store = await loadWorkbenchStore();

    expect(store.getState().viewPlacements).toEqual({
      ...defaultWorkbenchViewPlacements,
      objectBrowser: "left",
    });
  });

  it("falls back to default placements for invalid stored JSON", async () => {
    window.localStorage.setItem(viewPlacementsStorageKey, "{");

    const store = await loadWorkbenchStore();

    expect(store.getState().viewPlacements).toEqual(
      defaultWorkbenchViewPlacements,
    );
  });

  it("loads default view visibility", async () => {
    const store = await loadWorkbenchStore();

    expect(store.getState().viewVisibility).toEqual(
      defaultWorkbenchViewVisibility,
    );
  });

  it("sets and persists a single view visibility", async () => {
    const store = await loadWorkbenchStore();
    const expected: WorkbenchViewVisibility = {
      ...defaultWorkbenchViewVisibility,
      bi: true,
    };

    store.getState().setViewOpen("bi", true);

    expect(store.getState().viewVisibility).toEqual(expected);
    expect(
      JSON.parse(window.localStorage.getItem(viewVisibilityStorageKey) ?? "{}"),
    ).toEqual(expected);
  });

  it("sanitizes stored view visibility", async () => {
    window.localStorage.setItem(
      viewVisibilityStorageKey,
      JSON.stringify({
        completion: false,
        queryHistory: "closed",
        unknownView: false,
      }),
    );

    const store = await loadWorkbenchStore();

    expect(store.getState().viewVisibility).toEqual({
      ...defaultWorkbenchViewVisibility,
      completion: false,
    });
  });

  it("derives the active visible workbench view from the shared view list", () => {
    expect(activeWorkbenchView(defaultWorkbenchViewVisibility)).toBe(
      "objectBrowser",
    );
    expect(
      activeWorkbenchView({
        ...defaultWorkbenchViewVisibility,
        bi: true,
      }),
    ).toBe("bi");
  });

  it("sets and persists the sidebar tab order as a full permutation", async () => {
    const store = await loadWorkbenchStore();

    store.getState().setViewOrder(["git", "objectBrowser"]);

    const order = store.getState().viewOrder;
    expect(order.slice(0, 2)).toEqual(["git", "objectBrowser"]);
    expect([...order].sort()).toEqual([...workbenchViewIds].sort());
    expect(
      JSON.parse(
        window.localStorage.getItem("irodori.workbench.viewOrder.v1") ?? "[]",
      ),
    ).toEqual(order);
  });

  it("drops unknown ids from a stored tab order and appends missing ones", async () => {
    window.localStorage.setItem(
      "irodori.workbench.viewOrder.v1",
      JSON.stringify(["plan", "bogusView", "plan", "git"]),
    );

    const store = await loadWorkbenchStore();

    const order = store.getState().viewOrder;
    expect(order.slice(0, 2)).toEqual(["plan", "git"]);
    expect(order).toHaveLength(workbenchViewIds.length);
  });

  it("hides views but never the object browser", async () => {
    const store = await loadWorkbenchStore();

    store.getState().setViewHidden("git", true);
    store.getState().setViewHidden("objectBrowser", true);

    expect(store.getState().viewHidden.git).toBe(true);
    expect(store.getState().viewHidden.objectBrowser).toBe(false);
    expect(
      workbenchViewsForSide(
        store.getState().viewPlacements,
        "left",
        store.getState().viewOrder,
        store.getState().viewHidden,
      ),
    ).not.toContain("git");
  });

  it("defaults the sidebar to a compact working width", async () => {
    const store = await loadWorkbenchStore();

    expect(store.getState().sidebarWidth).toBe(200);
  });

  it("loads and persists the sidebar side", async () => {
    window.localStorage.setItem(sidebarSideStorageKey, "right");

    const store = await loadWorkbenchStore();

    expect(store.getState().sidebarSide).toBe("right");
    store.getState().setSidebarSide("left");
    expect(store.getState().sidebarSide).toBe("left");
    expect(window.localStorage.getItem(sidebarSideStorageKey)).toBe("left");
  });

  it("clamps and persists the sidebar width", async () => {
    const store = await loadWorkbenchStore();

    store.getState().setSidebarWidth(80);
    expect(store.getState().sidebarWidth).toBe(180);
    expect(window.localStorage.getItem(sidebarWidthStorageKey)).toBe("180");

    store.getState().setSidebarWidth(900);
    expect(store.getState().sidebarWidth).toBe(640);
    expect(window.localStorage.getItem(sidebarWidthStorageKey)).toBe("640");
  });

  it("defaults the results pane to a practical working height", async () => {
    const store = await loadWorkbenchStore();

    expect(store.getState().resultsHeight).toBe(340);
  });

  it("clamps and persists the results pane height", async () => {
    const store = await loadWorkbenchStore();

    store.getState().setResultsHeight(80);
    expect(store.getState().resultsHeight).toBe(220);
    expect(window.localStorage.getItem(resultsHeightStorageKey)).toBe("220");

    store.getState().setResultsHeight(900);
    expect(store.getState().resultsHeight).toBe(560);
    expect(window.localStorage.getItem(resultsHeightStorageKey)).toBe("560");
  });

  it("resets a scrambled layout back to defaults and clears its storage", async () => {
    // Scramble the layout: reorder panels, resize, flip the side, hide a view.
    window.localStorage.setItem(
      "irodori.workbench.viewOrder.v1",
      JSON.stringify(["git", "plan", "objectBrowser"]),
    );
    window.localStorage.setItem(sidebarWidthStorageKey, "600");
    window.localStorage.setItem(sidebarSideStorageKey, "right");
    window.localStorage.setItem(resultsHeightStorageKey, "520");
    window.localStorage.setItem(
      viewHiddenStorageKey,
      JSON.stringify({ git: true }),
    );

    const store = await loadWorkbenchStore();
    // The scrambled values loaded, so this is a real reset, not a no-op.
    expect(store.getState().viewOrder.slice(0, 2)).toEqual(["git", "plan"]);
    expect(store.getState().sidebarWidth).toBe(600);
    expect(store.getState().sidebarSide).toBe("right");
    expect(store.getState().viewHidden.git).toBe(true);

    store.getState().resetLayout();

    const state = store.getState();
    expect(state.viewOrder).toEqual(workbenchViewIds);
    expect(state.sidebarWidth).toBe(200);
    expect(state.sidebarSide).toBe("left");
    expect(state.resultsHeight).toBe(340);
    expect(state.viewHidden.git).toBe(false);
    expect(state.viewPlacements).toEqual(defaultWorkbenchViewPlacements);

    // The subscriber writes defaults back to storage, so a reload stays reset.
    expect(
      JSON.parse(
        window.localStorage.getItem("irodori.workbench.viewOrder.v1") ?? "[]",
      ),
    ).toEqual(workbenchViewIds);
    expect(window.localStorage.getItem(sidebarWidthStorageKey)).toBe("200");
    expect(window.localStorage.getItem(sidebarSideStorageKey)).toBe("left");
  });
});
