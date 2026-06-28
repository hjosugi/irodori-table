import { describe, expect, it } from "vitest";
import {
  activeTabLabelForEditorGroup,
  addSqlTabToEditorGroup,
  closeOtherSqlTabsInEditorGroup,
  closeSqlTabInEditorGroup,
  createEditorGroupState,
  duplicateSqlTabInEditorGroup,
  openTabsForEditorGroup,
  queryForEditorGroup,
  renameSqlTabInEditorGroup,
  reopenSqlTabInEditorGroup,
  selectEditorTabInGroup,
} from "@/app/editor-tabs";

describe("editor tab state", () => {
  it("keeps split editor groups independent", () => {
    let primary = createEditorGroupState("select 1;");
    let secondary = createEditorGroupState("select 2;");

    primary = renameSqlTabInEditorGroup(primary, "scratch", "left.sql");
    primary = closeSqlTabInEditorGroup(primary, "audit").state;

    expect(activeTabLabelForEditorGroup(primary)).toBe("left.sql");
    expect(openTabsForEditorGroup(primary).map((tab) => tab.id)).toEqual([
      "scratch",
      "explain",
    ]);
    expect(activeTabLabelForEditorGroup(secondary)).toBe("scratch.sql");
    expect(openTabsForEditorGroup(secondary).map((tab) => tab.id)).toEqual([
      "scratch",
      "audit",
      "explain",
    ]);
    expect(queryForEditorGroup(secondary)).toBe("select 2;");
  });

  it("opens new tabs and duplicates only the selected tab contents", () => {
    let state = createEditorGroupState("select current;");
    state = addSqlTabToEditorGroup(state, {
      id: "adhoc",
      label: "adhoc.sql",
      query: "select adhoc;",
    });
    state = selectEditorTabInGroup(state, "scratch");
    state = duplicateSqlTabInEditorGroup(state, "scratch", {
      id: "scratch-copy",
    });

    expect(state.activeTabId).toBe("scratch-copy");
    expect(state.queryByTabId["scratch-copy"]).toBe("select current;");
    expect(state.queryByTabId.adhoc).toBe("select adhoc;");
    expect(state.tabs.map((tab) => tab.label)).toContain("scratch-copy.sql");
  });

  it("keeps the last tab open and reopens closed tabs inside the same group", () => {
    let state = createEditorGroupState("");
    state = closeOtherSqlTabsInEditorGroup(state, "explain");

    const kept = closeSqlTabInEditorGroup(state, "explain");
    expect(kept.keptLast).toBe(true);
    expect(kept.state.openTabIds).toEqual(["explain"]);

    const restored = reopenSqlTabInEditorGroup(kept.state);
    expect(restored.restoredTab?.id).toBe("scratch");
    expect(restored.state.activeTabId).toBe("scratch");
    expect(restored.state.openTabIds).toEqual(["explain", "scratch"]);
  });
});
