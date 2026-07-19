import { MoreHorizontal, Plus, X } from "lucide-react";
import { createPortal } from "react-dom";

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

// Keep the popover inside the window. Without this a "..." button near the
// right edge — which is where it ends up once several tabs are open — opens a
// menu that runs off-screen.
const menuWidth = 220;
const menuHeight = 240;
const menuMargin = 8;

function clampMenuToViewport(x: number, y: number) {
  if (typeof window === "undefined") {
    return { position: "fixed" as const, left: x, top: y };
  }
  const left = Math.max(
    menuMargin,
    Math.min(x, window.innerWidth - menuWidth - menuMargin),
  );
  const top = Math.max(
    menuMargin,
    Math.min(y, window.innerHeight - menuHeight - menuMargin),
  );
  return { position: "fixed" as const, left, top };
}

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
      role="tablist"
      aria-label={t("editorTabs.strip")}
      onContextMenu={(event) => event.stopPropagation()}
    >
      {openTabs.map((tab) => (
        <div
          className={tab.id === state.activeTabId ? "tab active" : "tab"}
          key={tab.id}
        >
          <button
            className="tab-select"
            type="button"
            role="tab"
            aria-selected={tab.id === state.activeTabId}
            aria-haspopup="menu"
            title={tab.label}
            onClick={() => onSelectTab(group, tab.id)}
            onMouseDown={(event) => {
              // Middle-click closes; stop the browser's autoscroll gesture.
              if (event.button === 1) {
                event.preventDefault();
              }
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                onCloseTab(group, tab.id);
              }
            }}
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
          <button
            className="tab-close"
            type="button"
            title={t("editorTabs.closeTabNamed", { label: tab.label })}
            aria-label={t("editorTabs.closeTabNamed", { label: tab.label })}
            onClick={() => onCloseTab(group, tab.id)}
          >
            <X size={12} />
          </button>
        </div>
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
      <button
        className="mini-button"
        type="button"
        title={t("editorTabs.tabActions")}
        aria-label={t("editorTabs.tabActions")}
        aria-haspopup="menu"
        aria-expanded={menuOpenForGroup}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu({
            x: rect.left,
            y: rect.bottom + 4,
            group,
            tabId: state.activeTabId,
          });
        }}
      >
        <MoreHorizontal size={14} />
      </button>
      {/*
        Portaled to <body>. The menu is position:fixed, but dockview's
        .dv-render-overlay ancestor sets transform/contain/will-change, which
        makes it the containing block for fixed descendants — so the viewport
        coordinates measured from the button resolved against the dock panel
        instead of the window. The menu appeared offset by the panel's left edge
        (244px with the sidebar open, 44px without), and with enough tabs open
        the button sits far enough right that the menu landed past the window
        edge entirely and nothing showed at all. EditorContextMenu already
        portals for the same reason.
      */}
      {menuOpenForGroup && menu
        ? createPortal(
            <div
              className="app-menu-popover editor-tab-menu"
              role="menu"
              style={clampMenuToViewport(menu.x, menu.y)}
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
