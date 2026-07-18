// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createQueryHistoryResultSnapshot,
  useQueryHistoryStore,
  type QueryHistoryItem,
} from "@/features/query-history/query-history-store";

function historyItem(id: string, rows = 3): QueryHistoryItem {
  return {
    id,
    connectionId: "conn",
    connectionName: "Local",
    engine: "postgres",
    sql: `select ${id}`,
    status: "ok",
    rowCount: rows,
    elapsedMs: 12,
    truncated: false,
    result: createQueryHistoryResultSnapshot(
      {
        columns: ["id", "name"],
        rows: Array.from({ length: rows }, (_, index) => [
          index + 1,
          `row-${index + 1}`,
        ]),
        rowCount: rows,
        elapsedMs: 12,
        truncated: false,
      },
      useQueryHistoryStore.getState().resultRowLimit,
    ),
    ranAt: "2026-06-26T00:00:00.000Z",
  };
}

describe("query history result retention", () => {
  beforeEach(() => {
    window.localStorage?.clear();
    const store = useQueryHistoryStore.getState();
    store.clearItems(store.items.map((item) => item.id));
    store.setMaxItems(200);
    store.setResultRowLimit(50);
  });

  it("trims retained history entries by the configured count", () => {
    const store = useQueryHistoryStore.getState();
    store.setMaxItems(2);

    store.append(historyItem("one"));
    store.append(historyItem("two"));
    store.append(historyItem("three"));

    expect(
      useQueryHistoryStore.getState().items.map((item) => item.id),
    ).toEqual(["three", "two"]);
  });

  it("keeps only the configured number of result rows", () => {
    const store = useQueryHistoryStore.getState();
    store.setResultRowLimit(1);

    store.append(historyItem("one", 3));

    const result = useQueryHistoryStore.getState().items[0].result;
    expect(result?.rows).toEqual([[1, "row-1"]]);
    expect(result?.rowCount).toBe(3);
    expect(result?.retainedRows).toBe(1);
    expect(result?.retentionTruncated).toBe(true);
  });

  it("stores SQL only when result row retention is disabled", () => {
    const store = useQueryHistoryStore.getState();
    store.setResultRowLimit(0);

    store.append(historyItem("one", 3));

    expect(useQueryHistoryStore.getState().items[0].result).toBeUndefined();
  });
});

// The suite above calls setMaxItems(200) in beforeEach, so it never exercises
// the load path — which is why this survived. getItem returns null for an
// absent key and Number(null) is 0, which is finite, so the stored branch was
// taken on a profile that had never written the key and maxItems came out 0.
// append() discards everything at 0, so history silently recorded nothing.
describe("query history defaults on a profile that has never saved settings", () => {
  beforeEach(() => {
    window.localStorage?.clear();
    vi.resetModules();
  });

  it("uses the default retention, not zero, when nothing is stored", async () => {
    const mod = await import("@/features/query-history/query-history-store");
    const state = mod.useQueryHistoryStore.getState();

    expect(state.maxItems).toBe(mod.queryHistoryMaxItemsDefault);
    expect(state.maxItems).toBeGreaterThan(0);
    expect(state.resultRowLimit).toBeGreaterThan(0);
  });

  it("still honours a stored value", async () => {
    window.localStorage.setItem("irodori.queryHistory.maxItems.v1", "25");
    const mod = await import("@/features/query-history/query-history-store");

    expect(mod.useQueryHistoryStore.getState().maxItems).toBe(25);
  });
});
