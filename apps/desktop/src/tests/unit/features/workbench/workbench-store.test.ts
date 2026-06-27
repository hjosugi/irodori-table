// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultWorkbenchViewPlacements,
  defaultWorkbenchViewVisibility,
  type WorkbenchViewPlacements,
  type WorkbenchViewVisibility,
} from "@/features/workbench/types";

const viewPlacementsStorageKey = "irodori.workbench.viewPlacements.v1";
const viewVisibilityStorageKey = "irodori.workbench.viewVisibility.v1";
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
      queryHistory: "left",
    };

    store.getState().setViewPlacement("queryHistory", "left");

    expect(store.getState().viewPlacements).toEqual(expected);
    expect(
      JSON.parse(window.localStorage.getItem(viewPlacementsStorageKey) ?? "{}"),
    ).toEqual(expected);
  });

  it("sets and persists all view placements", async () => {
    const store = await loadWorkbenchStore();
    const next: WorkbenchViewPlacements = {
      ...defaultWorkbenchViewPlacements,
      objectBrowser: "right",
      git: "left",
    };

    store.getState().setViewPlacements(next);

    expect(store.getState().viewPlacements).toEqual(next);
    expect(
      JSON.parse(window.localStorage.getItem(viewPlacementsStorageKey) ?? "{}"),
    ).toEqual(next);
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
      objectBrowser: "right",
      queryHistory: "left",
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

    expect(store.getState().viewVisibility).toEqual({
      objectBrowser: true,
      completion: false,
      queryHistory: false,
      git: false,
    });
    expect(store.getState().viewVisibility).toEqual(defaultWorkbenchViewVisibility);
  });

  it("sets and persists a single view visibility", async () => {
    const store = await loadWorkbenchStore();
    const expected: WorkbenchViewVisibility = {
      ...defaultWorkbenchViewVisibility,
      queryHistory: true,
    };

    store.getState().setViewOpen("queryHistory", true);

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
});
