import { Plus } from "lucide-react";

import {
  openTabsForEditorGroup,
  type EditorGroupState,
} from "@/app/editor-tabs";
import type { EditorTabMenuState } from "@/app/controllers/use-editor-groups";
import { usePreferencesStore } from "@/features/preferences";
import type { EditorGroup } from "@/features/query-editor";
import { createTranslator } from "@/i18n";

export type EditorTabStripProps = {
  group: EditorGroup;
  state: EditorGroupState;
  menu: EditorTabMenuState;
  onSelectTab: (group: EditorGroup, tabId: string) => void;
  onOpenMenu: (menu: NonNullable<EditorTabMenuState>) => void;
  onCloseMenu: () => void;
  onNewTab: (group: EditorGroup) => void;
  onRenameTab: (group: EditorGroup, tabId: string) => void;
  onDuplicateTab: (group: EditorGroup, tabId: string) => void;
  onCloseTab: (group: EditorGroup, tabId: string) => void;
  onCloseOtherTabs: (group: EditorGroup, tabId: string) => void;
  onReopenClosedTab: (group: EditorGroup) => void;
};

export function EditorTabStrip({
  group,
  state,
  menu,
  onSelectTab,
  onOpenMenu,
  onCloseMenu,
  onNewTab,
  onRenameTab,
  onDuplicateTab,
  onCloseTab,
  onCloseOtherTabs,
  onReopenClosedTab,
}: EditorTabStripProps) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const openTabs = openTabsForEditorGroup(state);
  const closedTabsAvailable = state.tabs.some(
    (tab) => !state.openTabIds.includes(tab.id),
  );
  const menuOpenForGroup = menu?.group === group;

  return (
    <div
      className="tab-strip editor-tab-strip"
      onContextMenu={(event) => event.stopPropagation()}
    >
      {openTabs.map((tab) => (
        <button
          className={tab.id === state.activeTabId ? "tab active" : "tab"}
          key={tab.id}
          type="button"
          title={tab.label}
          onClick={() => onSelectTab(group, tab.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelectTab(group, tab.id);
            onOpenMenu({
              x: event.clientX,
              y: event.clientY,
              group,
              tabId: tab.id,
            });
          }}
        >
          {tab.label}
        </button>
      ))}
      <button
        className="mini-button"
        type="button"
        title={t("editorTabs.newSqlTab")}
        aria-label={t("editorTabs.newSqlTab")}
        onClick={() => onNewTab(group)}
      >
        <Plus size={14} />
      </button>
      {menuOpenForGroup && menu ? (
        <div
          className="app-menu-popover editor-tab-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const { group } = menu;
              onCloseMenu();
              onNewTab(group);
            }}
          >
            <span>{t("editorTabs.newSqlTab")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const { group, tabId } = menu;
              onCloseMenu();
              onRenameTab(group, tabId);
            }}
          >
            <span>{t("editorTabs.renameTab")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const { group, tabId } = menu;
              onCloseMenu();
              onDuplicateTab(group, tabId);
            }}
          >
            <span>{t("editorTabs.duplicateTab")}</span>
          </button>
          <span className="menu-separator" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const { group, tabId } = menu;
              onCloseMenu();
              onCloseTab(group, tabId);
            }}
          >
            <span>{t("editorTabs.closeTab")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={openTabs.length <= 1}
            onClick={() => {
              const { group, tabId } = menu;
              onCloseMenu();
              onCloseOtherTabs(group, tabId);
            }}
          >
            <span>{t("editorTabs.closeOtherTabs")}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!closedTabsAvailable}
            onClick={() => {
              const { group } = menu;
              onCloseMenu();
              onReopenClosedTab(group);
            }}
          >
            <span>{t("editorTabs.reopenClosedTab")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
