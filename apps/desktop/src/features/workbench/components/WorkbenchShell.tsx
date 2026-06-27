import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import type { AppMenuSection } from "@/app/app-config";
import {
  formatKeySequence,
  type CommandMeta,
  type KeybindingScope,
  type Keymap,
} from "@/core/keybindings";
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
  sidebarOpen: boolean;
  completionOpen: boolean;
  historyOpen: boolean;
  sidebarSide: WorkbenchSide;
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
  activeTransportLabel: string;
  vimMode: boolean;
  queryLineCount: number;
  sqlLintEnabled: boolean;
  running: boolean;
  selectionStatus: string | null;
  statusBarItems?: readonly WorkbenchStatusBarItem[];
  shellStyle: CSSProperties;
  sidebar: ReactNode;
  children: ReactNode;
  onScopeFocus: (event: FocusEvent<HTMLElement>) => void;
  onScopeMouseDown: (event: MouseEvent<HTMLElement>) => void;
  onToggleSidebar: () => void;
  onToggleSidebarSide: () => void;
  onToggleTheme?: () => void;
  onToggleWorkspaceMenu?: () => void;
  onOpenSettings?: () => void;
  onOpenConnectionManager: () => void;
  onOpenHelp?: () => void;
  onRunCommand: (commandId: string) => void;
  onCloseWorkspaceMenu: () => void;
};

export function WorkbenchShell({
  appName,
  themeKind,
  activeKeyScope,
  sidebarOpen,
  completionOpen,
  historyOpen,
  sidebarSide,
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
  activeTransportLabel,
  vimMode,
  queryLineCount,
  sqlLintEnabled,
  running,
  selectionStatus,
  statusBarItems = [],
  shellStyle,
  sidebar,
  children,
  onScopeFocus,
  onScopeMouseDown,
  onToggleSidebar,
  onToggleSidebarSide,
  onOpenConnectionManager,
  onRunCommand,
  onCloseWorkspaceMenu,
}: WorkbenchShellProps) {
  const [activeMenuLabel, setActiveMenuLabel] = useState<string | null>(null);
  const menubarRef = useRef<HTMLElement | null>(null);
  const commandById = new Map(commandCatalog.map((command) => [command.id, command]));

  useEffect(() => {
    if (!activeMenuLabel) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setActiveMenuLabel(null);
      onCloseWorkspaceMenu();
    };
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        setActiveMenuLabel(null);
        return;
      }
      if (activeMenuLabel && !menubarRef.current?.contains(target)) {
        setActiveMenuLabel(null);
      }
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
    const sidebarSideTarget = sidebarSide === "left" ? "Right" : "Left";
    switch (command.id) {
      case "view.sidebar.toggle":
        return sidebarOpen ? "Hide Sidebar" : "Show Sidebar";
      case "view.sidebar.swap":
        return `Move Sidebar ${sidebarSideTarget}`;
      case "view.completion.toggle":
        return completionOpen ? "Hide Completion" : "Show Completion";
      case "view.history.toggle":
        return historyOpen ? "Hide History" : "Show History";
      case "theme.toggle":
        return themeKind === "dark" ? "Light Theme" : "Dark Theme";
      case "about.open":
        return `About ${appName}`;
      default:
        return command.title;
    }
  };

  const runMenuCommand = (commandId: string) => {
    setActiveMenuLabel(null);
    onCloseWorkspaceMenu();
    onRunCommand(commandId);
  };
  const SidebarToggleIcon =
    sidebarSide === "right"
      ? sidebarOpen
        ? PanelRightClose
        : PanelRightOpen
      : sidebarOpen
        ? PanelLeftClose
        : PanelLeftOpen;
  const sidebarToggleTitle = sidebarOpen
    ? `Hide ${sidebarSide} sidebar`
    : `Show ${sidebarSide} sidebar`;
  const SidebarMoveIcon =
    sidebarSide === "left" ? PanelRightOpen : PanelLeftOpen;

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
          "--inspector-width": `${inspectorWidth}px`,
          "--results-height": `${resultsHeight}px`,
          "--editor-split-primary": `${editorSplitPercent}%`,
        } as CSSProperties
      }
      data-theme={themeKind}
      data-key-scope={activeKeyScope}
      onFocusCapture={onScopeFocus}
      onMouseDownCapture={onScopeMouseDown}
      onContextMenuCapture={(event) => event.preventDefault()}
    >
      <header className="titlebar">
        <div className="titlebar-menu-zone">
          <div className="brand" title={appName} aria-label={appName}>
            <img className="brand-icon" src="/irodori-icon.svg" alt="" />
          </div>
          <nav className="menubar" aria-label="Application menu" ref={menubarRef}>
            {menuBarSections.map((section) => (
              <div className="menubar-item" key={section.label}>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={activeMenuLabel === section.label}
                  onClick={() =>
                    setActiveMenuLabel((current) =>
                      current === section.label ? null : section.label,
                    )
                  }
                  onMouseEnter={() => {
                    if (activeMenuLabel) {
                      setActiveMenuLabel(section.label);
                    }
                  }}
                >
                  {section.label}
                </button>
                {activeMenuLabel === section.label ? (
                  <div className="app-menu-popover menubar-popover" role="menu">
                    {renderMenuSection(section)}
                  </div>
                ) : null}
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
        <div className="titlebar-control-zone" aria-label="Layout controls">
          <button
            className={[
              "icon-button",
              "layout-toggle-button",
              sidebarOpen ? "active" : null,
              `sidebar-${sidebarSide}`,
            ]
              .filter(Boolean)
              .join(" ")}
            type="button"
            title={sidebarToggleTitle}
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-pressed={sidebarOpen}
            data-sidebar-toggle="visibility"
            data-sidebar-side={sidebarSide}
            onClick={onToggleSidebar}
          >
            <SidebarToggleIcon size={15} />
          </button>
          <button
            className={[
              "icon-button",
              "layout-toggle-button",
              "sidebar-move-button",
              `sidebar-${sidebarSide}`,
            ].join(" ")}
            type="button"
            title={
              sidebarSide === "left"
                ? "Move sidebar right"
                : "Move sidebar left"
            }
            aria-label={
              sidebarSide === "left"
                ? "Move sidebar right"
                : "Move sidebar left"
            }
            aria-pressed={sidebarSide === "right"}
            data-sidebar-toggle="side"
            data-sidebar-side={sidebarSide}
            onClick={onToggleSidebarSide}
          >
            <SidebarMoveIcon size={15} />
          </button>
        </div>
      </header>

      <div
        className={[
          "workspace",
          sidebarOpen ? null : "sidebar-collapsed",
          `sidebar-${sidebarSide}`,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {sidebar}
        {children}
      </div>

      <footer className="statusbar">
        <div className="statusbar-group statusbar-left">
          <span className="statusbar-item statusbar-connection">
            <span
              className="connection-color-dot"
              style={{ background: activeConnectionColor }}
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
            {vimMode ? "Vim" : "Default"} · {queryLineCount} lines ·{" "}
            {sqlLintEnabled ? "lint on" : "lint off"} ·{" "}
            {running ? "running" : "idle"}
          </span>
        </div>
      </footer>

    </main>
  );
}
