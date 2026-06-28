import { tabs as defaultEditorTabs } from "@/app/app-config";
import type { EditorSelections } from "@/features/query-editor";

export type EditorTabDefinition = {
  id: string;
  label: string;
};

export type EditorGroupState = {
  tabs: EditorTabDefinition[];
  activeTabId: string;
  openTabIds: string[];
  queryByTabId: Record<string, string>;
  selectionsByTabId: Record<string, EditorSelections>;
};

export type EditorTabCloseResult = {
  state: EditorGroupState;
  closedTab: EditorTabDefinition | null;
  keptLast: boolean;
};

export type EditorTabRestoreResult = {
  state: EditorGroupState;
  restoredTab: EditorTabDefinition | null;
};

export const defaultEditorSelections: EditorSelections = [{ from: 0, to: 0 }];

export function createEditorGroupState(initialQuery: string): EditorGroupState {
  const initialTabs = defaultEditorTabs.map((tab) => ({ ...tab }));
  return {
    tabs: initialTabs,
    activeTabId: initialTabs[0]?.id ?? "scratch",
    openTabIds: initialTabs.map((tab) => tab.id),
    queryByTabId: Object.fromEntries(
      initialTabs.map((tab, index) => [
        tab.id,
        index === 0 ? initialQuery : "",
      ]),
    ) as Record<string, string>,
    selectionsByTabId: Object.fromEntries(
      initialTabs.map((tab) => [tab.id, defaultEditorSelections]),
    ) as Record<string, EditorSelections>,
  };
}

export function queryForEditorGroup(state: EditorGroupState) {
  return state.queryByTabId[state.activeTabId] ?? "";
}

export function selectionsForEditorGroup(state: EditorGroupState) {
  return state.selectionsByTabId[state.activeTabId] ?? defaultEditorSelections;
}

export function openTabsForEditorGroup(state: EditorGroupState) {
  return state.tabs.filter((tab) => state.openTabIds.includes(tab.id));
}

export function activeTabLabelForEditorGroup(state: EditorGroupState) {
  return (
    openTabsForEditorGroup(state).find((tab) => tab.id === state.activeTabId)
      ?.label ??
    state.tabs[0]?.label ??
    "scratch.sql"
  );
}

export function selectEditorTabInGroup(
  state: EditorGroupState,
  tabId: string,
): EditorGroupState {
  if (!state.openTabIds.includes(tabId)) {
    return state;
  }
  return {
    ...state,
    activeTabId: tabId,
  };
}

export function addSqlTabToEditorGroup(
  state: EditorGroupState,
  options: { id?: string; label?: string; query?: string } = {},
): EditorGroupState {
  const id = options.id ?? createSqlTabId();
  const tab = { id, label: options.label ?? nextSqlTabLabel(state) };
  return {
    ...state,
    tabs: [...state.tabs, tab],
    openTabIds: [...state.openTabIds, id],
    activeTabId: id,
    queryByTabId: { ...state.queryByTabId, [id]: options.query ?? "" },
    selectionsByTabId: {
      ...state.selectionsByTabId,
      [id]: defaultEditorSelections,
    },
  };
}

export function renameSqlTabInEditorGroup(
  state: EditorGroupState,
  tabId: string,
  label: string,
): EditorGroupState {
  const nextLabel = label.trim();
  if (!nextLabel) {
    return state;
  }
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, label: nextLabel } : tab,
    ),
  };
}

export function duplicateSqlTabInEditorGroup(
  state: EditorGroupState,
  tabId: string,
  options: { id?: string } = {},
): EditorGroupState {
  const source = state.tabs.find((tab) => tab.id === tabId);
  if (!source) {
    return state;
  }
  const sourceText = state.queryByTabId[tabId] ?? "";
  return addSqlTabToEditorGroup(state, {
    id: options.id,
    label: nextDuplicateLabel(state, source.label),
    query: sourceText,
  });
}

export function closeSqlTabInEditorGroup(
  state: EditorGroupState,
  tabId: string,
): EditorTabCloseResult {
  const groupOpenTabs = openTabsForEditorGroup(state);
  const activeIndex = groupOpenTabs.findIndex((tab) => tab.id === tabId);
  if (groupOpenTabs.length <= 1 || activeIndex < 0) {
    return { state, closedTab: null, keptLast: groupOpenTabs.length <= 1 };
  }

  const closedTab = groupOpenTabs[activeIndex];
  const nextTab =
    groupOpenTabs[activeIndex + 1] ??
    groupOpenTabs[activeIndex - 1] ??
    groupOpenTabs[0];
  return {
    state: {
      ...state,
      openTabIds: state.openTabIds.filter((id) => id !== closedTab.id),
      activeTabId:
        state.activeTabId === closedTab.id ? nextTab.id : state.activeTabId,
    },
    closedTab,
    keptLast: false,
  };
}

export function closeOtherSqlTabsInEditorGroup(
  state: EditorGroupState,
  tabId: string,
): EditorGroupState {
  if (!state.openTabIds.includes(tabId)) {
    return state;
  }
  return {
    ...state,
    openTabIds: [tabId],
    activeTabId: tabId,
  };
}

export function reopenSqlTabInEditorGroup(
  state: EditorGroupState,
): EditorTabRestoreResult {
  const restoredTab = state.tabs.find(
    (tab) => !state.openTabIds.includes(tab.id),
  );
  if (!restoredTab) {
    return { state, restoredTab: null };
  }
  return {
    state: {
      ...state,
      openTabIds: [...state.openTabIds, restoredTab.id],
      activeTabId: restoredTab.id,
    },
    restoredTab,
  };
}

function createSqlTabId() {
  return `query-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function nextSqlTabLabel(state: EditorGroupState) {
  let index = state.tabs.length + 1;
  let label = `query-${index}.sql`;
  const labels = new Set(state.tabs.map((tab) => tab.label));
  while (labels.has(label)) {
    index += 1;
    label = `query-${index}.sql`;
  }
  return label;
}

function nextDuplicateLabel(state: EditorGroupState, label: string) {
  const base = label.replace(/\.sql$/i, "") || "query";
  const labels = new Set(state.tabs.map((tab) => tab.label));
  let index = 1;
  let next = `${base}-copy.sql`;
  while (labels.has(next)) {
    index += 1;
    next = `${base}-copy-${index}.sql`;
  }
  return next;
}
