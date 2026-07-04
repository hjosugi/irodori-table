import { useEffect, useMemo, useState, type RefObject } from "react";
import type { ActionNotice } from "@/app/ActionToast";
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
  selectionsForEditorGroup,
  type EditorGroupState,
} from "@/app/editor-tabs";
import type {
  EditorGroup,
  EditorSelections,
  SqlEditorHandle,
} from "@/features/query-editor";
import type { SearchTab } from "@/features/search/SearchReplacePanel";
import type { EditorSplitMode } from "@/features/workbench";
import type { Translator } from "@/i18n";
import type { TextMatch } from "@/sql/text-search";

type EditorGroupStates = Record<EditorGroup, EditorGroupState>;

export type EditorTabMenuState = {
  x: number;
  y: number;
  group: EditorGroup;
  tabId: string;
} | null;

export type UseEditorGroupsDeps = {
  loadInitialQuery: () => string;
  editorSplitMode: EditorSplitMode;
  editorApiRef: RefObject<SqlEditorHandle | null>;
  secondaryEditorApiRef: RefObject<SqlEditorHandle | null>;
  showActionNotice: (
    kind: ActionNotice["kind"],
    title: string,
    detail?: string,
  ) => void;
  t: Translator["t"];
};

export function useEditorGroups({
  loadInitialQuery,
  editorSplitMode,
  editorApiRef,
  secondaryEditorApiRef,
  showActionNotice,
  t,
}: UseEditorGroupsDeps) {
  const [editorGroupStates, setEditorGroupStates] = useState<EditorGroupStates>(
    () => ({
      primary: createEditorGroupState(loadInitialQuery()),
      secondary: createEditorGroupState(""),
    }),
  );
  const [preferredEditorGroup, setActiveEditorGroup] =
    useState<EditorGroup>("primary");
  const activeEditorGroup: EditorGroup =
    editorSplitMode === "single" ? "primary" : preferredEditorGroup;
  const activeEditorGroupState = editorGroupStates[activeEditorGroup];
  const query = queryForEditorGroup(activeEditorGroupState);
  const editorSelections = selectionsForEditorGroup(activeEditorGroupState);
  const activeTabLabel = activeTabLabelForEditorGroup(activeEditorGroupState);
  const [editorTabMenu, setEditorTabMenu] = useState<EditorTabMenuState>(null);

  useEffect(() => {
    if (!editorTabMenu) {
      return;
    }
    const close = () => setEditorTabMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setEditorTabMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
    };
  }, [editorTabMenu]);

  function updateEditorGroupState(
    group: EditorGroup,
    updater: (state: EditorGroupState) => EditorGroupState,
  ) {
    setEditorGroupStates((current) => ({
      ...current,
      [group]: updater(current[group]),
    }));
  }

  function setEditorGroupQuery(group: EditorGroup, nextQuery: string) {
    updateEditorGroupState(group, (state) => ({
      ...state,
      queryByTabId: {
        ...state.queryByTabId,
        [state.activeTabId]: nextQuery,
      },
    }));
  }

  function setQuery(nextQuery: string) {
    setEditorGroupQuery(activeEditorGroup, nextQuery);
  }

  function setEditorGroupSelection(
    group: EditorGroup,
    selection: EditorSelections,
  ) {
    updateEditorGroupState(group, (state) => ({
      ...state,
      selectionsByTabId: {
        ...state.selectionsByTabId,
        [state.activeTabId]: selection,
      },
    }));
  }

  function selectEditorTab(group: EditorGroup, tabId: string) {
    setActiveEditorGroup(group);
    updateEditorGroupState(group, (state) =>
      selectEditorTabInGroup(state, tabId),
    );
  }

  const searchTabs = useMemo<SearchTab[]>(() => {
    const groups: EditorGroup[] =
      editorSplitMode === "single" ? ["primary"] : ["primary", "secondary"];
    return groups.flatMap((group) => {
      const state = editorGroupStates[group];
      return openTabsForEditorGroup(state).map((tab) => ({
        key: `${group}:${tab.id}`,
        group,
        tabId: tab.id,
        label:
          editorSplitMode === "single" ? tab.label : `${tab.label} · ${group}`,
        text: state.queryByTabId[tab.id] ?? "",
      }));
    });
  }, [editorGroupStates, editorSplitMode]);

  function replaceSearchTab(tab: SearchTab, nextText: string) {
    updateEditorGroupState(tab.group as EditorGroup, (state) => ({
      ...state,
      queryByTabId: { ...state.queryByTabId, [tab.tabId]: nextText },
    }));
  }

  function revealSearchMatch(tab: SearchTab, match: TextMatch) {
    const group = tab.group as EditorGroup;
    selectEditorTab(group, tab.tabId);
    window.setTimeout(() => {
      const api =
        group === "secondary"
          ? secondaryEditorApiRef.current
          : editorApiRef.current;
      api?.revealRange({ from: match.start, to: match.end });
      api?.focus();
    }, 0);
  }

  function newSqlTab(group: EditorGroup = activeEditorGroup) {
    updateEditorGroupState(group, addSqlTabToEditorGroup);
    setActiveEditorGroup(group);
  }

  function renameSqlTab(group: EditorGroup, tabId: string) {
    const state = editorGroupStates[group];
    const tab = state.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const next = window
      .prompt(t("editorTabs.renameSqlTabPrompt"), tab.label)
      ?.trim();
    if (!next || next === tab.label) {
      return;
    }
    updateEditorGroupState(group, (current) =>
      renameSqlTabInEditorGroup(current, tabId, next),
    );
    setActiveEditorGroup(group);
    showActionNotice("success", t("notice.editor.tabRenamed"), next);
  }

  function duplicateSqlTab(group: EditorGroup, tabId: string) {
    const state = editorGroupStates[group];
    const source = state.tabs.find((item) => item.id === tabId);
    if (!source) return;
    updateEditorGroupState(group, (current) =>
      duplicateSqlTabInEditorGroup(current, tabId),
    );
    setActiveEditorGroup(group);
    showActionNotice("success", t("notice.editor.tabDuplicated"), source.label);
  }

  function closeActiveSqlTab(group: EditorGroup = activeEditorGroup) {
    const state = editorGroupStates[group];
    closeSqlTab(group, state.activeTabId);
  }

  function closeSqlTab(group: EditorGroup, tabId: string) {
    const state = editorGroupStates[group];
    const result = closeSqlTabInEditorGroup(state, tabId);
    if (result.keptLast || !result.closedTab) {
      showActionNotice(
        "info",
        t("notice.editor.tabKeptOpen"),
        t("notice.editor.tabKeptOpenDetail"),
      );
      return;
    }
    updateEditorGroupState(group, () => result.state);
    showActionNotice(
      "info",
      t("notice.editor.tabClosed"),
      result.closedTab.label,
    );
  }

  function closeOtherSqlTabs(group: EditorGroup, tabId: string) {
    const state = editorGroupStates[group];
    const tab = state.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    updateEditorGroupState(group, (current) =>
      closeOtherSqlTabsInEditorGroup(current, tabId),
    );
    setActiveEditorGroup(group);
    showActionNotice("info", t("notice.editor.otherTabsClosed"), tab.label);
  }

  function reopenSqlTab(group: EditorGroup = activeEditorGroup) {
    const state = editorGroupStates[group];
    const result = reopenSqlTabInEditorGroup(state);
    if (!result.restoredTab) {
      showActionNotice("info", t("notice.editor.tabsAlreadyOpen"));
      return;
    }
    setActiveEditorGroup(group);
    updateEditorGroupState(group, () => result.state);
    showActionNotice(
      "success",
      t("notice.editor.tabRestored"),
      result.restoredTab.label,
    );
  }

  return {
    activeEditorGroup,
    activeTabLabel,
    closeActiveSqlTab,
    closeOtherSqlTabs,
    closeSqlTab,
    duplicateSqlTab,
    editorGroupStates,
    editorSelections,
    editorTabMenu,
    newSqlTab,
    primaryQuery: queryForEditorGroup(editorGroupStates.primary),
    query,
    renameSqlTab,
    reopenSqlTab,
    replaceSearchTab,
    revealSearchMatch,
    searchTabs,
    secondaryQuery: queryForEditorGroup(editorGroupStates.secondary),
    selectEditorTab,
    setActiveEditorGroup,
    setEditorGroupQuery,
    setEditorGroupSelection,
    setEditorTabMenu,
    setQuery,
  };
}
