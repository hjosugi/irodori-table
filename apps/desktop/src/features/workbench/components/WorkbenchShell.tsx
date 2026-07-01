import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, PanelLeft, PanelRight } from "lucide-react";
import type { AppMenuSection } from "@/app/app-config";
import {
  formatKeySequence,
  type CommandMeta,
  type KeybindingScope,
  type Keymap,
} from "@/core/keybindings";
import type { ThemeKind } from "@/theme";

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
  activeTransportLabel: string;
  vimMode: boolean;
  queryLineCount: number;
  sqlLintEnabled: boolean;
  running: boolean;
  selectionStatus: string | null;
  statusBarItems?: readonly WorkbenchStatusBarItem[];
  shellStyle: CSSProperties;
  dockLayout?: boolean;
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
  activeTransportLabel,
  vimMode,
  queryLineCount,
  sqlLintEnabled,
  running,
  selectionStatus,
  statusBarItems = [],
  shellStyle,
  dockLayout = false,
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

  const openMenuFromButton = (label: string, button: HTMLElement) => {
    const rect = button.getBoundingClientRect();
    setMenuAnchor({ left: rect.left, top: rect.bottom + 1 });
    setActiveMenuLabel(label);
  };
  const closeMenuBarMenu = () => {
    setActiveMenuLabel(null);
    setMenuAnchor(null);
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
      closeMenuBarMenu();
      onCloseWorkspaceMenu();
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
        return leftSidebarOpen ? "Hide Left Sidebar" : "Show Left Sidebar";
      case "view.completion.toggle":
        return completionOpen ? "Hide Completion" : "Show Completion";
      case "view.history.toggle":
        return historyOpen ? "Hide History" : "Show History";
      case "view.plan.toggle":
        return planOpen ? "Hide Plan" : "Show Plan";
      case "theme.toggle":
        return themeKind === "dark" ? "Light Theme" : "Dark Theme";
      case "about.open":
        return `About ${appName}`;
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
  const LeftSidebarIcon = PanelLeft;
  const RightSidebarIcon = PanelRight;

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
            aria-label="Application menu"
            ref={menubarRef}
          >
            {menuBarSections.map((section) => (
              <div className="menubar-item" key={section.label}>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={activeMenuLabel === section.label}
                  onClick={(event) => {
                    if (activeMenuLabel === section.label) {
                      closeMenuBarMenu();
                    } else {
                      openMenuFromButton(section.label, event.currentTarget);
                    }
                  }}
                  onMouseEnter={(event) => {
                    if (activeMenuLabel) {
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
        <div className="titlebar-control-zone" aria-label="Layout controls">
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
            title={leftSidebarOpen ? "Hide left sidebar" : "Show left sidebar"}
            aria-label={
              leftSidebarOpen ? "Hide left sidebar" : "Show left sidebar"
            }
            aria-pressed={leftSidebarOpen}
            data-sidebar-toggle="left"
            onClick={onToggleLeftSidebar}
          >
            <LeftSidebarIcon size={15} />
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
              rightSidebarOpen ? "Hide right sidebar" : "Show right sidebar"
            }
            aria-label={
              rightSidebarOpen ? "Hide right sidebar" : "Show right sidebar"
            }
            aria-pressed={rightSidebarOpen}
            data-sidebar-toggle="right"
            onClick={onToggleRightSidebar}
          >
            <RightSidebarIcon size={15} />
          </button>
        </div>
      </header>

      {activeMenuLabel && menuAnchor
        ? createPortal(
            <div
              ref={menuPopoverRef}
              className="app-menu-popover menubar-popover"
              role="menu"
              style={{
                position: "fixed",
                left: menuAnchor.left,
                top: menuAnchor.top,
              }}
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
                  ? `Activate ${contextMenu.label}`
                  : "Activate"}
              </span>
            </button>
          ) : null}
          {contextMenu.selectedText ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => copyContextText(contextMenu.selectedText)}
            >
              <span>Copy Selected Text</span>
            </button>
          ) : contextMenu.copyText ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => copyContextText(contextMenu.copyText)}
            >
              <span>{contextMenu.editable ? "Copy Value" : "Copy Text"}</span>
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
              <span>Clear Field</span>
            </button>
          ) : null}
          <span className="menu-separator" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            onClick={() => runMenuCommand("connection.manager")}
          >
            <span>Connection Manager</span>
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
              {leftSidebarOpen ? "Hide Left Sidebar" : "Show Left Sidebar"}
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
              {rightSidebarOpen ? "Hide Right Sidebar" : "Show Right Sidebar"}
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
