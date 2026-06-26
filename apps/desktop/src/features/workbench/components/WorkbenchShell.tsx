import type {
  CSSProperties,
  FocusEvent,
  MouseEvent,
  ReactNode,
} from "react";
import {
  ChevronDown,
  GitBranch,
  HelpCircle,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
} from "lucide-react";
import type { KeybindingScope } from "@/keybindings";
import type { ThemeKind } from "@/theme";

type WorkbenchShellProps = {
  appName: string;
  appVersion: string;
  themeKind: ThemeKind;
  activeKeyScope: KeybindingScope;
  sidebarOpen: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  resultsHeight: number;
  editorSplitPercent: number;
  workspaceMenuOpen: boolean;
  activeConnectionName: string;
  activeConnectionEngine: string;
  activeConnectionColor: string;
  activeConnectionStatus: string;
  activeTransportLabel: string;
  vimMode: boolean;
  queryLineCount: number;
  sqlLintEnabled: boolean;
  running: boolean;
  shellStyle: CSSProperties;
  sidebar: ReactNode;
  children: ReactNode;
  dialogs: ReactNode;
  onScopeFocus: (event: FocusEvent<HTMLElement>) => void;
  onScopeMouseDown: (event: MouseEvent<HTMLElement>) => void;
  onToggleTheme: () => void;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onOpenKeymap: () => void;
  onOpenConnectionManager: () => void;
  onOpenGit: () => void;
  onOpenHelp: () => void;
  onToggleWorkspaceMenu: () => void;
  onCloseWorkspaceMenu: () => void;
};

export function WorkbenchShell({
  appName,
  appVersion,
  themeKind,
  activeKeyScope,
  sidebarOpen,
  sidebarWidth,
  inspectorWidth,
  resultsHeight,
  editorSplitPercent,
  workspaceMenuOpen,
  activeConnectionName,
  activeConnectionEngine,
  activeConnectionColor,
  activeConnectionStatus,
  activeTransportLabel,
  vimMode,
  queryLineCount,
  sqlLintEnabled,
  running,
  shellStyle,
  sidebar,
  children,
  dialogs,
  onScopeFocus,
  onScopeMouseDown,
  onToggleTheme,
  onToggleSidebar,
  onOpenSettings,
  onOpenKeymap,
  onOpenConnectionManager,
  onOpenGit,
  onOpenHelp,
  onToggleWorkspaceMenu,
  onCloseWorkspaceMenu,
}: WorkbenchShellProps) {
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
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCloseWorkspaceMenu();
                  onOpenConnectionManager();
                }}
              >
                Connection Manager
                <kbd>Ctrl+Shift+D</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCloseWorkspaceMenu();
                  onOpenKeymap();
                }}
              >
                Keyboard Shortcuts
                <kbd>Ctrl+,</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCloseWorkspaceMenu();
                  onOpenGit();
                }}
              >
                Git Panel
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCloseWorkspaceMenu();
                  onOpenSettings();
                }}
              >
                Settings
              </button>
              <span className="menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCloseWorkspaceMenu();
                  onOpenHelp();
                }}
              >
                Help
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCloseWorkspaceMenu();
                  onOpenHelp();
                }}
              >
                About {appName}
                <kbd>v{appVersion}</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCloseWorkspaceMenu();
                  onToggleTheme();
                }}
              >
                {themeKind === "dark" ? "Light Theme" : "Dark Theme"}
              </button>
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
          className="icon-button"
          type="button"
          title="Git panel"
          aria-label="Git panel"
          onClick={onOpenGit}
        >
          <GitBranch size={15} />
        </button>
      </section>

      <div className={sidebarOpen ? "workspace" : "workspace sidebar-collapsed"}>
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
        <span>
          {vimMode ? "Vim" : "Default"} · {queryLineCount} lines ·{" "}
          {sqlLintEnabled ? "lint on" : "lint off"} ·{" "}
          {running ? "running" : "idle"}
        </span>
      </footer>

      {dialogs}
    </main>
  );
}
