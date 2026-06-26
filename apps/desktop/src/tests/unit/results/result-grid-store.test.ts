import { describe, expect, it } from "vitest";
import { useResultGridStore } from "@/features/results/store/result-grid-store";

describe("result grid edit history", () => {
  it("undoes staged edit operations in reverse order", () => {
    const store = useResultGridStore;
    store.getState().resetEdits();

    store.getState().updateEditDraft((draft) => ({
      ...draft,
      cellEdits: new Map([["o0:1", "Kawase Foods"]]),
    }));
    store.getState().updateEditDraft((draft) => ({
      ...draft,
      newRows: [...draft.newRows, ["3", "draft"]],
    }));
    store.getState().updateEditDraft((draft) => ({
      ...draft,
      deletedRows: new Set([0]),
    }));

    expect(store.getState().editUndoStack).toHaveLength(3);
    expect(store.getState().deletedRows.has(0)).toBe(true);

    expect(store.getState().undoEdit()).toBe(true);
    expect(store.getState().deletedRows.has(0)).toBe(false);
    expect(store.getState().newRows).toEqual([["3", "draft"]]);

    expect(store.getState().undoEdit()).toBe(true);
    expect(store.getState().newRows).toEqual([]);
    expect(store.getState().cellEdits.get("o0:1")).toBe("Kawase Foods");

    expect(store.getState().undoEdit()).toBe(true);
    expect(store.getState().cellEdits.size).toBe(0);
    expect(store.getState().undoEdit()).toBe(false);
  });

  it("does not record no-op edit updates", () => {
    const store = useResultGridStore;
    store.getState().resetEdits();

    store.getState().updateEditDraft((draft) => draft);

    expect(store.getState().editUndoStack).toHaveLength(0);
  });
});
