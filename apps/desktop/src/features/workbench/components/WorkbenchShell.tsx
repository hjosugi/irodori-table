import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import type { AppMenuSection } from "@/app/app-config";
import {
  formatKeySequence,
  type CommandMeta,
  type KeybindingScope,
  type Keymap,
} from "@/core/keybindings";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
import type { ThemeKind } from "@/theme";
import type { WorkbenchSide } from "../types";

export type WorkbenchStatusBarItem = {
  id: string;
  label: string;
  alignment?: "left" | "right";
  priority?: number;
  command?: string;
  tooltip?: string;
};

type WorkbenchShellProps = {
  appName: string;
  appVersion?: string;
  themeKind: ThemeKind;
  activeKeyScope: KeybindingScope;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  completionOpen: boolean;
  historyOpen: boolean;
  planOpen: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  resultsHeight: number;
  editorSplitPercent: number;
  workspaceMenuOpen?: boolean;
  menuBarSections: readonly AppMenuSection[];
  workspaceMenuSections?: readonly AppMenuSection[];
  commandCatalog: readonly CommandMeta[];
  keymap: Keymap;
  activeConnectionName: string;
  activeConnectionEngine: string;
  activeConnectionColor: string;
  activeConnectionStatus: string;
  activeConnectionOpen: boolean;
  activeTransportLabel: string;
  vimMode: boolean;
  queryLineCount: number;
  sqlLintEnabled: boolean;
  running: boolean;
  selectionStatus: string | null;
  statusBarItems?: readonly WorkbenchStatusBarItem[];
  shellStyle: CSSProperties;
  dockLayout?: boolean;
  /** Far-left connections rail, rendered outside the dock layout. */
  rail?: ReactNode;
  leftSidebar: ReactNode;
  rightSidebar?: ReactNode;
  children: ReactNode;
  onScopeFocus: (event: FocusEvent<HTMLElement>) => void;
  onScopeMouseDown: (event: MouseEvent<HTMLElement>) => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  onToggleTheme?: () => void;
  onToggleWorkspaceMenu?: () => void;
  onOpenSettings?: () => void;
  onOpenConnectionManager: () => void;
  onOpenHelp?: () => void;
  onRunCommand: (commandId: string) => void;
  onCloseWorkspaceMenu: () => void;
};

type WorkbenchContextMenu = {
  x: number;
  y: number;
  label: string | null;
  copyText: string | null;
  selectedText: string | null;
  activatable: HTMLElement | null;
  editable: HTMLInputElement | HTMLTextAreaElement | null;
};

// VS Code-style layout toggle: an outlined window frame whose sidebar half
// fills in while that sidebar is open. Lucide only ships the divider-line
// variant, which can't show the open/closed state.
function PanelSideIcon({
  side,
  open,
  size = 15,
}: {
  side: WorkbenchSide;
  open: boolean;
  size?: number;
}) {
  const dividerX = side === "left" ? 9.75 : 14.25;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x={3} y={4.5} width={18} height={15} rx={2.2} />
      {open ? (
        <rect
          x={side === "left" ? 3 : 14.25}
          y={4.5}
          width={6.75}
          height={15}
          rx={1.2}
          fill="currentColor"
          stroke="none"
        />
      ) : (
        <line x1={dividerX} y1={4.5} x2={dividerX} y2={19.5} />
      )}
    </svg>
  );
}

export function WorkbenchShell({
  appName,
  themeKind,
  activeKeyScope,
  leftSidebarOpen,
  rightSidebarOpen,
  completionOpen,
  historyOpen,
  planOpen,
  sidebarWidth,
  inspectorWidth,
  resultsHeight,
  editorSplitPercent,
  menuBarSections,
  commandCatalog,
  keymap,
  activeConnectionName,
  activeConnectionEngine,
  activeConnectionColor,
  activeConnectionStatus,
  activeConnectionOpen,
  activeTransportLabel,
  vimMode,
  queryLineCount,
  sqlLintEnabled,
  running,
  selectionStatus,
  statusBarItems = [],
  shellStyle,
  dockLayout = false,
  rail,
  leftSidebar,
  rightSidebar,
  children,
  onScopeFocus,
  onScopeMouseDown,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  onOpenConnectionManager,
  onRunCommand,
  onCloseWorkspaceMenu,
}: WorkbenchShellProps) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const [activeMenuLabel, setActiveMenuLabel] = useState<string | null>(null);
  // The menu bar dropdown is portaled to <body> and positioned from the
  // anchor button's rect: the titlebar/menubar set `overflow: hidden` to clip
  // horizontal label overflow, which would otherwise also clip the dropdown
  // that hangs below the titlebar (so the menu appeared to never open).
  const [menuAnchor, setMenuAnchor] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<WorkbenchContextMenu | null>(
    null,
  );
  const menubarRef = useRef<HTMLElement | null>(null);
  const menuPopoverRef = useRef<HTMLDivElement | null>(null);
  const menubarButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  // Where keyboard focus should land inside the popover once it renders.
  const pendingMenuFocusRef = useRef<"first" | "last" | null>(null);
  // Menu label switched to via hover while another menu was open: the click
  // that follows must not toggle it closed again.
  const hoverSwitchedLabelRef = useRef<string | null>(null);
  // Roving tabindex home for the menubar (APG menubar pattern).
  const [menubarFocusLabel, setMenubarFocusLabel] = useState<string | null>(
    null,
  );

  const openMenuFromButton = (label: string, button: HTMLElement) => {
    const rect = button.getBoundingClientRect();
    setMenuAnchor({ left: rect.left, top: rect.bottom + 1 });
    setActiveMenuLabel(label);
    setMenubarFocusLabel(label);
  };
  const closeMenuBarMenu = () => {
    setActiveMenuLabel(null);
    setMenuAnchor(null);
    pendingMenuFocusRef.current = null;
    hoverSwitchedLabelRef.current = null;
  };

  const menuPopoverItems = () =>
    Array.from(
      menuPopoverRef.current?.querySelectorAll<HTMLElement>(
        "button[role='menuitem']:not(:disabled)",
      ) ?? [],
    );

  // Move keyboard focus into the popover after an open triggered by
  // ArrowDown/ArrowUp/Enter on a menubar button or by Left/Right switching.
  useEffect(() => {
    const target = pendingMenuFocusRef.current;
    if (!target || !activeMenuLabel) {
      return;
    }
    pendingMenuFocusRef.current = null;
    const items = menuPopoverItems();
    if (items.length === 0) {
      return;
    }
    (target === "first" ? items[0] : items[items.length - 1]).focus();
  }, [activeMenuLabel]);

  const focusMenubarButtonAt = (index: number) => {
    const count = menuBarSections.length;
    if (count === 0) {
      return;
    }
    const section = menuBarSections[((index % count) + count) % count];
    const button = menubarButtonRefs.current.get(section.label);
    if (!button) {
      return;
    }
    setMenubarFocusLabel(section.label);
    button.focus();
    // While a menu is open, moving along the menubar switches the open menu.
    if (activeMenuLabel && activeMenuLabel !== section.label) {
      openMenuFromButton(section.label, button);
    }
  };

  const switchToAdjacentMenu = (delta: number) => {
    const index = menuBarSections.findIndex(
      (section) => section.label === activeMenuLabel,
    );
    if (index === -1) {
      return;
    }
    const count = menuBarSections.length;
    const next = menuBarSections[(index + delta + count) % count];
    const button = menubarButtonRefs.current.get(next.label);
    if (!button) {
      return;
    }
    pendingMenuFocusRef.current = "first";
    openMenuFromButton(next.label, button);
  };

  const handleMenubarButtonKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
    label: string,
  ) => {
    const openAndFocus = (target: "first" | "last") => {
      event.preventDefault();
      if (activeMenuLabel === label) {
        // Already open: the popover exists, move focus straight into it.
        const items = menuPopoverItems();
        (target === "first" ? items[0] : items[items.length - 1])?.focus();
        return;
      }
      pendingMenuFocusRef.current = target;
      openMenuFromButton(label, event.currentTarget);
    };
    switch (event.key) {
      case "ArrowDown":
      case "Enter":
      case " ":
        openAndFocus("first");
        break;
      case "ArrowUp":
        openAndFocus("last");
        break;
      case "ArrowRight":
        event.preventDefault();
        focusMenubarButtonAt(index + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusMenubarButtonAt(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusMenubarButtonAt(0);
        break;
      case "End":
        event.preventDefault();
        focusMenubarButtonAt(menuBarSections.length - 1);
        break;
      default:
        break;
    }
  };

  const handleMenuPopoverKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const items = menuPopoverItems();
    if (items.length === 0) {
      return;
    }
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const focusItemAt = (index: number) => {
      items[((index % items.length) + items.length) % items.length].focus();
    };
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItemAt(currentIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItemAt(currentIndex < 0 ? -1 : currentIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItemAt(0);
        break;
      case "End":
        event.preventDefault();
        focusItemAt(items.length - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        switchToAdjacentMenu(1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        switchToAdjacentMenu(-1);
        break;
      case "Tab":
        closeMenuBarMenu();
        break;
      default:
        break;
    }
  };
  const commandById = new Map(
    commandCatalog.map((command) => [command.id, command]),
  );

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setContextMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!activeMenuLabel) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      const trigger = activeMenuLabel
        ? menubarButtonRefs.current.get(activeMenuLabel)
        : null;
      closeMenuBarMenu();
      onCloseWorkspaceMenu();
      trigger?.focus();
    };
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        closeMenuBarMenu();
        return;
      }
      // The dropdown is portaled outside the menubar, so also ignore clicks
      // landing inside it.
      if (
        menubarRef.current?.contains(target) ||
        menuPopoverRef.current?.contains(target)
      ) {
        return;
      }
      closeMenuBarMenu();
    };
    window.addEventListener("pointerdown", closeOnOutsidePointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeMenuLabel, onCloseWorkspaceMenu]);

  const shortcutFor = (commandId: string) => {
    const shortcut = keymap[commandId];
    return shortcut ? formatKeySequence(shortcut) : null;
  };

  const titleFor = (command: CommandMeta) => {
    switch (command.id) {
      case "view.sidebar.toggle":
        return leftSidebarOpen
          ? t("shell.hideLeftSidebar")
          : t("shell.showLeftSidebar");
      case "view.completion.toggle":
        return completionOpen
          ? t("shell.hideCompletion")
          : t("shell.showCompletion");
      case "view.history.toggle":
        return historyOpen ? t("shell.hideHistory") : t("shell.showHistory");
      case "view.plan.toggle":
        return planOpen ? t("shell.hidePlan") : t("shell.showPlan");
      case "theme.toggle":
        return themeKind === "dark"
          ? t("shell.lightTheme")
          : t("shell.darkTheme");
      case "about.open":
        return t("commands.about.open.title");
      default:
        return command.title;
    }
  };

  const runMenuCommand = (commandId: string) => {
    closeMenuBarMenu();
    setContextMenu(null);
    onCloseWorkspaceMenu();
    onRunCommand(commandId);
  };

  const openWorkbenchContextMenu = (event: MouseEvent<HTMLElement>) => {
    const target =
      event.target instanceof Element ? event.target : event.currentTarget;

    if (target.closest(".app-menu-popover, .object-action-menu")) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    setActiveMenuLabel(null);
    onCloseWorkspaceMenu();

    const editable = editableTargetFrom(target);
    const activatable = activatableTargetFrom(target);
    const selectedText = cleanContextText(
      window.getSelection()?.toString() ?? "",
    );
    const label = contextLabelFrom(target, activatable, editable);
    const copyText =
      selectedText || editable?.value || readableTextFrom(target) || label;

    setContextMenu({
      ...clampWorkbenchContextMenuPosition(event.clientX, event.clientY),
      label,
      copyText: copyText || null,
      selectedText: selectedText || null,
      activatable,
      editable,
    });
  };

  const activateContextTarget = () => {
    const target = contextMenu?.activatable;
    setContextMenu(null);
    if (!target || isDisabledElement(target)) {
      return;
    }
    target.click();
  };

  const clearContextField = () => {
    const target = contextMenu?.editable;
    setContextMenu(null);
    if (!target || target.readOnly || target.disabled) {
      return;
    }
    target.value = "";
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const copyContextText = (text: string | null) => {
    setContextMenu(null);
    if (!text) {
      return;
    }
    void navigator.clipboard?.writeText(text);
  };
  const renderMenuButtons = (section: AppMenuSection) =>
    section.items.map((item) => {
      const command = commandById.get(item.commandId);
      if (!command) {
        return null;
      }
      const shortcut = shortcutFor(command.id);
      return (
        <button
          type="button"
          role="menuitem"
          key={command.id}
          onClick={() => runMenuCommand(command.id)}
        >
          <span>{titleFor(command)}</span>
          {shortcut ? <kbd>{shortcut}</kbd> : null}
        </button>
      );
    });

  const renderMenuSection = (section: AppMenuSection) => (
    <div
      className="app-menu-section"
      role="group"
      aria-label={section.label}
      key={section.label}
    >
      {renderMenuButtons(section)}
    </div>
  );

  const sortedStatusBarItems = [...statusBarItems].sort(
    (left, right) => (right.priority ?? 0) - (left.priority ?? 0),
  );
  const leftStatusBarItems = sortedStatusBarItems.filter(
    (item) => item.alignment !== "right",
  );
  const rightStatusBarItems = sortedStatusBarItems.filter(
    (item) => item.alignment === "right",
  );

  const renderStatusBarItem = (item: WorkbenchStatusBarItem) => {
    const title = item.tooltip ?? item.label;
    if (item.command) {
      return (
        <button
          className="statusbar-item statusbar-button"
          type="button"
          title={title}
          key={item.id}
          onClick={() => onRunCommand(item.command ?? "")}
        >
          {item.label}
        </button>
      );
    }
    return (
      <span className="statusbar-item" title={title} key={item.id}>
        {item.label}
      </span>
    );
  };

  return (
    <main
      className="app-shell"
      style={
        {
          ...shellStyle,
          "--sidebar-width": `${sidebarWidth}px`,
          "--right-sidebar-width": `${inspectorWidth}px`,
          "--inspector-width": `${inspectorWidth}px`,
          "--results-height": `${resultsHeight}px`,
          "--editor-split-primary": `${editorSplitPercent}%`,
        } as CSSProperties
      }
      data-theme={themeKind}
      data-key-scope={activeKeyScope}
      onFocusCapture={onScopeFocus}
      onMouseDownCapture={onScopeMouseDown}
      onContextMenu={openWorkbenchContextMenu}
    >
      <header className="titlebar">
        <div className="titlebar-menu-zone">
          <div className="brand" title={appName} aria-label={appName}>
            <img className="brand-icon" src="/irodori-icon.svg" alt="" />
          </div>
          <nav
            className="menubar"
            role="menubar"
            aria-label={t("shell.applicationMenu")}
            ref={menubarRef}
          >
            {menuBarSections.map((section, index) => (
              <div className="menubar-item" role="none" key={section.label}>
                <button
                  type="button"
                  role="menuitem"
                  ref={(node) => {
                    if (node) {
                      menubarButtonRefs.current.set(section.label, node);
                    } else {
                      menubarButtonRefs.current.delete(section.label);
                    }
                  }}
                  tabIndex={
                    section.label ===
                    (menubarFocusLabel ?? menuBarSections[0]?.label)
                      ? 0
                      : -1
                  }
                  aria-haspopup="menu"
                  aria-expanded={activeMenuLabel === section.label}
                  onFocus={() => setMenubarFocusLabel(section.label)}
                  onKeyDown={(event) =>
                    handleMenubarButtonKeyDown(event, index, section.label)
                  }
                  onClick={(event) => {
                    // A hover onto this button already switched the open
                    // menu here; the click that follows must not close it.
                    if (hoverSwitchedLabelRef.current === section.label) {
                      hoverSwitchedLabelRef.current = null;
                      return;
                    }
                    if (activeMenuLabel === section.label) {
                      closeMenuBarMenu();
                    } else {
                      openMenuFromButton(section.label, event.currentTarget);
                    }
                  }}
                  onMouseEnter={(event) => {
                    if (activeMenuLabel && activeMenuLabel !== section.label) {
                      hoverSwitchedLabelRef.current = section.label;
                      openMenuFromButton(section.label, event.currentTarget);
                    }
                  }}
                >
                  {section.label}
                </button>
              </div>
            ))}
          </nav>
        </div>
        <button
          className="connection-select titlebar-connection"
          type="button"
          onClick={onOpenConnectionManager}
        >
          <span
            className="connection-color-dot"
            style={{ background: activeConnectionColor }}
            aria-hidden="true"
          />
          <span>{activeConnectionName}</span>
          <small>{activeConnectionEngine}</small>
          <ChevronDown size={15} />
        </button>
        <div
          className="titlebar-control-zone"
          aria-label={t("shell.layoutControls")}
        >
          <button
            className={[
              "icon-button",
              "layout-toggle-button",
              leftSidebarOpen ? "active" : null,
              "sidebar-left",
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            title={
              leftSidebarOpen
                ? t("shell.hideLeftSidebar")
                : t("shell.showLeftSidebar")
            }
            aria-label={
              leftSidebarOpen
                ? t("shell.hideLeftSidebar")
                : t("shell.showLeftSidebar")
            }
            aria-pressed={leftSidebarOpen}
            data-sidebar-toggle="left"
            onClick={onToggleLeftSidebar}
          >
            <PanelSideIcon side="left" open={leftSidebarOpen} />
          </button>
          <button
            className={[
              "icon-button",
              "layout-toggle-button",
              rightSidebarOpen ? "active" : null,
              "sidebar-right",
            ].join(" ")}
            type="button"
            title={
              rightSidebarOpen
                ? t("shell.hideRightSidebar")
                : t("shell.showRightSidebar")
            }
            aria-label={
              rightSidebarOpen
                ? t("shell.hideRightSidebar")
                : t("shell.showRightSidebar")
            }
            aria-pressed={rightSidebarOpen}
            data-sidebar-toggle="right"
            onClick={onToggleRightSidebar}
          >
            <PanelSideIcon side="right" open={rightSidebarOpen} />
          </button>
        </div>
      </header>

      {activeMenuLabel && menuAnchor
        ? createPortal(
            <div
              ref={menuPopoverRef}
              className="app-menu-popover menubar-popover"
              role="menu"
              aria-label={activeMenuLabel}
              style={{
                position: "fixed",
                left: menuAnchor.left,
                top: menuAnchor.top,
              }}
              onKeyDown={handleMenuPopoverKeyDown}
            >
              {menuBarSections
                .filter((section) => section.label === activeMenuLabel)
                .map((section) => (
                  <div key={section.label}>{renderMenuSection(section)}</div>
                ))}
            </div>,
            document.body,
          )
        : null}

      <div
        className={[
          "workspace",
          dockLayout ? "workspace-dock" : null,
          dockLayout || leftSidebarOpen ? null : "left-sidebar-collapsed",
          dockLayout || rightSidebarOpen ? null : "right-sidebar-collapsed",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {rail}
        {dockLayout ? (
          children
        ) : (
          <>
            {leftSidebar}
            {children}
            {rightSidebar}
          </>
        )}
      </div>

      <footer className="statusbar">
        <div className="statusbar-group statusbar-left">
          <span className="statusbar-item statusbar-connection">
            {/* Next to the connection state this dot reads as a status light,
                not as the profile's color tag, so it only carries the profile
                color while the connection is actually open; CSS greys it out
                otherwise. */}
            <span
              className="connection-color-dot"
              data-connected={activeConnectionOpen ? "true" : "false"}
              style={
                activeConnectionOpen
                  ? { background: activeConnectionColor }
                  : undefined
              }
              aria-hidden="true"
            />
            {activeConnectionStatus}
          </span>
          <span className="statusbar-item">{activeTransportLabel}</span>
          {leftStatusBarItems.map(renderStatusBarItem)}
        </div>
        {selectionStatus ? (
          <span className="statusbar-selection">{selectionStatus}</span>
        ) : null}
        <div className="statusbar-group statusbar-right">
          {rightStatusBarItems.map(renderStatusBarItem)}
          <span className="statusbar-item">
            {vimMode
              ? t("shell.editorMode.vim")
              : t("shell.editorMode.default")}{" "}
            · {t("shell.lineCount", { count: queryLineCount })} ·{" "}
            {sqlLintEnabled ? t("shell.lintOn") : t("shell.lintOff")} ·{" "}
            {running ? t("shell.running") : t("shell.idle")}
          </span>
        </div>
      </footer>

      {contextMenu ? (
        <div
          className="app-menu-popover workbench-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextMenu.activatable ? (
            <button
              type="button"
              role="menuitem"
              disabled={isDisabledElement(contextMenu.activatable)}
              onClick={activateContextTarget}
            >
              <span>
                {contextMenu.label
                  ? t("shell.context.activateLabel", {
                      label: contextMenu.label,
                    })
                  : t("shell.context.activate")}
              </span>
            </button>
          ) : null}
          {contextMenu.selectedText ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => copyContextText(contextMenu.selectedText)}
            >
              <span>{t("shell.context.copySelectedText")}</span>
            </button>
          ) : contextMenu.copyText ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => copyContextText(contextMenu.copyText)}
            >
              <span>
                {contextMenu.editable
                  ? t("shell.context.copyValue")
                  : t("shell.context.copyText")}
              </span>
            </button>
          ) : null}
          {contextMenu.editable ? (
            <button
              type="button"
              role="menuitem"
              disabled={
                contextMenu.editable.readOnly || contextMenu.editable.disabled
              }
              onClick={clearContextField}
            >
              <span>{t("shell.context.clearField")}</span>
            </button>
          ) : null}
          <span className="menu-separator" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            onClick={() => runMenuCommand("connection.manager")}
          >
            <span>{t("commands.connection.manager.shortTitle")}</span>
            {shortcutFor("connection.manager") ? (
              <kbd>{shortcutFor("connection.manager")}</kbd>
            ) : null}
          </button>
          <span className="menu-separator" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              onToggleLeftSidebar();
            }}
          >
            <span>
              {leftSidebarOpen
                ? t("shell.hideLeftSidebar")
                : t("shell.showLeftSidebar")}
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              onToggleRightSidebar();
            }}
          >
            <span>
              {rightSidebarOpen
                ? t("shell.hideRightSidebar")
                : t("shell.showRightSidebar")}
            </span>
          </button>
        </div>
      ) : null}
    </main>
  );
}

function editableTargetFrom(
  target: Element,
): HTMLInputElement | HTMLTextAreaElement | null {
  const editable = target.closest("input, textarea");
  if (
    editable instanceof HTMLInputElement ||
    editable instanceof HTMLTextAreaElement
  ) {
    return editable;
  }
  return null;
}

function activatableTargetFrom(target: Element): HTMLElement | null {
  const activatable = target.closest(
    "button, a, [role='button'], [role='tab'], [role='menuitem'], summary",
  );
  if (!(activatable instanceof HTMLElement)) {
    return null;
  }
  return activatable;
}

function contextLabelFrom(
  target: Element,
  activatable: HTMLElement | null,
  editable: HTMLInputElement | HTMLTextAreaElement | null,
) {
  if (editable) {
    return (
      editable.getAttribute("aria-label") ?? editable.placeholder ?? "field"
    );
  }
  const labelTarget =
    activatable ?? target.closest("[aria-label], [title]") ?? target;
  if (!(labelTarget instanceof HTMLElement)) {
    return null;
  }
  return (
    cleanContextText(labelTarget.getAttribute("aria-label") ?? "") ||
    cleanContextText(labelTarget.getAttribute("title") ?? "") ||
    readableTextFrom(labelTarget)
  );
}

function readableTextFrom(target: Element | null) {
  if (!target) {
    return null;
  }
  return cleanContextText(target.textContent ?? "") || null;
}

function cleanContextText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 160
    ? `${normalized.slice(0, 157)}...`
    : normalized;
}

function isDisabledElement(target: HTMLElement) {
  return (
    target.getAttribute("aria-disabled") === "true" ||
    (target instanceof HTMLButtonElement && target.disabled)
  );
}

function clampWorkbenchContextMenuPosition(x: number, y: number) {
  if (typeof window === "undefined") {
    return { x, y };
  }
  const menuWidth = 270;
  const menuHeight = 246;
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
  };
}
