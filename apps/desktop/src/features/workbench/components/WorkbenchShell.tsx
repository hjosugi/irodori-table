import type {
  CSSProperties,
  FocusEvent,
  MouseEvent,
  ReactNode,
} from "react";
import {
  ChevronDown,
  Columns3,
  GitBranch,
  HelpCircle,
  History,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
} from "lucide-react";
import type { AppMenuSection } from "@/app/app-config";
import {
  formatKeySequence,
  type CommandMeta,
  type KeybindingScope,
  type Keymap,
} from "@/core/keybindings";
import type { ThemeKind } from "@/theme";
import type { SidebarSide } from "../store/workbench-store";

type WorkbenchShellProps = {
  appName: string;
  appVersion: string;
  themeKind: ThemeKind;
  activeKeyScope: KeybindingScope;
  sidebarOpen: boolean;
  completionOpen: boolean;
  historyOpen: boolean;
  sidebarSide: SidebarSide;
  sidebarWidth: number;
  inspectorWidth: number;
  resultsHeight: number;
  editorSplitPercent: number;
  workspaceMenuOpen: boolean;
  workspaceMenuSections: readonly AppMenuSection[];
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
  shellStyle: CSSProperties;
  sidebar: ReactNode;
  children: ReactNode;
  onScopeFocus: (event: FocusEvent<HTMLElement>) => void;
  onScopeMouseDown: (event: MouseEvent<HTMLElement>) => void;
  onToggleTheme: () => void;
  onToggleSidebar: () => void;
  onToggleCompletion: () => void;
  onToggleHistory: () => void;
  onOpenSettings: () => void;
  onOpenConnectionManager: () => void;
  onOpenGit: () => void;
  onOpenHelp: () => void;
  onRunCommand: (commandId: string) => void;
  onToggleWorkspaceMenu: () => void;
  onCloseWorkspaceMenu: () => void;
};

export function WorkbenchShell({
  appName,
  appVersion,
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
  workspaceMenuOpen,
  workspaceMenuSections,
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
  shellStyle,
  sidebar,
  children,
  onScopeFocus,
  onScopeMouseDown,
  onToggleTheme,
  onToggleSidebar,
  onToggleCompletion,
  onToggleHistory,
  onOpenSettings,
  onOpenConnectionManager,
  onOpenGit,
  onOpenHelp,
  onRunCommand,
  onToggleWorkspaceMenu,
  onCloseWorkspaceMenu,
}: WorkbenchShellProps) {
  const commandById = new Map(commandCatalog.map((command) => [command.id, command]));

  const shortcutFor = (commandId: string) => {
    const shortcut = keymap[commandId];
    return shortcut ? formatKeySequence(shortcut) : null;
  };

  const titleFor = (command: CommandMeta) => {
    switch (command.id) {
      case "view.sidebar.toggle":
        return sidebarOpen ? "Hide Sidebar" : "Show Sidebar";
      case "view.completion.toggle":
        return completionOpen ? "Hide Completion" : "Show Completion";
      case "view.history.toggle":
        return historyOpen ? "Hide History" : "Show History";
      case "view.sidebar.swap":
        return sidebarSide === "left" ? "Move Sidebar Right" : "Move Sidebar Left";
      case "theme.toggle":
        return themeKind === "dark" ? "Light Theme" : "Dark Theme";
      case "about.open":
        return `About ${appName}`;
      default:
        return command.title;
    }
  };

  const runMenuCommand = (commandId: string) => {
    onCloseWorkspaceMenu();
    onRunCommand(commandId);
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
    >
      <header className="titlebar">
        <div className="brand" title={appName} aria-label={appName}>
          <img className="brand-icon" src="/irodori-icon.svg" alt="" />
        </div>
        <div className="titlebar-actions">
          <button
            className="theme-toggle"
            type="button"
            title={
              themeKind === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
            aria-label="Toggle color theme"
            onClick={onToggleTheme}
          >
            {themeKind === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            className="theme-toggle"
            type="button"
            title="Settings"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <Settings size={15} />
          </button>
          <button
            className="theme-toggle"
            type="button"
            title="Help"
            aria-label="Help"
            onClick={onOpenHelp}
          >
            <HelpCircle size={15} />
          </button>
          <button
            className="theme-toggle"
            type="button"
            title="Workspace menu"
            aria-label="Workspace menu"
            aria-expanded={workspaceMenuOpen}
            onClick={onToggleWorkspaceMenu}
          >
            <Menu size={15} />
          </button>
          {workspaceMenuOpen ? (
            <div className="app-menu-popover" role="menu">
              {workspaceMenuSections.map((section, sectionIndex) => (
                <div
                  className="app-menu-section"
                  role="group"
                  aria-label={section.label}
                  key={section.label}
                >
                  {sectionIndex > 0 ? (
                    <span className="menu-separator" role="separator" />
                  ) : null}
                  <div className="app-menu-section-title">{section.label}</div>
                  {section.items.map((item) => {
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
                  })}
                </div>
              ))}
              <span className="app-menu-version" aria-label="Application version">
                v{appVersion}
              </span>
            </div>
          ) : null}
        </div>
      </header>

      <section className="toolbar" aria-label="Workspace toolbar">
        <button
          className="icon-button sidebar-toggle"
          type="button"
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-pressed={!sidebarOpen}
          onClick={onToggleSidebar}
        >
          {sidebarOpen ? (
            <PanelLeftClose size={15} />
          ) : (
            <PanelLeftOpen size={15} />
          )}
        </button>
        <button
          className="connection-select"
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
        <div className="toolbar-spacer" />
        <button
          className={completionOpen ? "icon-button active" : "icon-button"}
          type="button"
          title={completionOpen ? "Hide completion" : "Show completion"}
          aria-label={completionOpen ? "Hide completion" : "Show completion"}
          aria-pressed={completionOpen}
          onClick={onToggleCompletion}
        >
          <Columns3 size={15} />
        </button>
        <button
          className={historyOpen ? "icon-button active" : "icon-button"}
          type="button"
          title={historyOpen ? "Hide history" : "Show history"}
          aria-label={historyOpen ? "Hide history" : "Show history"}
          aria-pressed={historyOpen}
          onClick={onToggleHistory}
        >
          <History size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Git panel"
          aria-label="Git panel"
          onClick={onOpenGit}
        >
          <GitBranch size={15} />
        </button>
      </section>

      <div
        className={[
          "workspace",
          sidebarOpen ? null : "sidebar-collapsed",
          sidebarSide === "right" ? "sidebar-right" : null,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {sidebar}
        {children}
      </div>

      <footer className="statusbar">
        <span>
          <span
            className="connection-color-dot"
            style={{ background: activeConnectionColor }}
            aria-hidden="true"
          />
          {activeConnectionStatus}
        </span>
        <span>{activeTransportLabel}</span>
        {selectionStatus ? (
          <span className="statusbar-selection">{selectionStatus}</span>
        ) : null}
        <span>
          {vimMode ? "Vim" : "Default"} · {queryLineCount} lines ·{" "}
          {sqlLintEnabled ? "lint on" : "lint off"} ·{" "}
          {running ? "running" : "idle"}
        </span>
      </footer>

    </main>
  );
}
