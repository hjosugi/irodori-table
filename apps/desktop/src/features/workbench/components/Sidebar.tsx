import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Columns3,
  Flame,
  Folder,
  GitBranch,
  History,
  Layers3,
  ListPlus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Table2,
  TableProperties,
  TerminalSquare,
  X,
} from "lucide-react";
import { EngineIcon } from "@/components/EngineIcon";
import { hasDiagram } from "@/features/erd";
import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import type {
  ConnectionDraft,
  WorkspaceConnection,
} from "@/lib/workspace-connection";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
import type { WorkbenchViewId } from "../types";
import type { WorkbenchSide } from "../types";

type SnapshotObject = WorkspaceConnection["objects"][number];
type ObjectActionMenuPosition = { key: string; x: number; y: number } | null;
type SidebarViewId = WorkbenchViewId;

const TREE_ROW_SELECTOR =
  ".schema-tree > summary, .object-tree > summary, .metadata-row, .object-row";

// Keyboard navigation for the object browser. The tree keeps native
// details/summary semantics (Enter/Space toggling stays built-in); this adds
// Up/Down row movement, Left/Right collapse/expand, and Home/End.
function handleTreeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
  const { key } = event;
  if (
    key !== "ArrowDown" &&
    key !== "ArrowUp" &&
    key !== "ArrowLeft" &&
    key !== "ArrowRight" &&
    key !== "Home" &&
    key !== "End"
  ) {
    return;
  }
  const container = event.currentTarget;
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>(TREE_ROW_SELECTOR),
  ).filter((row) => row.offsetParent !== null);
  if (rows.length === 0) {
    return;
  }
  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>(TREE_ROW_SELECTOR)
      : null;
  const currentIndex = active ? rows.indexOf(active) : -1;
  const focusRow = (index: number) => {
    rows[Math.max(0, Math.min(index, rows.length - 1))]?.focus();
  };
  event.preventDefault();
  event.stopPropagation();
  if (key === "Home") {
    focusRow(0);
    return;
  }
  if (key === "End") {
    focusRow(rows.length - 1);
    return;
  }
  if (key === "ArrowDown") {
    focusRow(currentIndex + 1);
    return;
  }
  if (key === "ArrowUp") {
    focusRow(currentIndex <= 0 ? 0 : currentIndex - 1);
    return;
  }
  if (!active) {
    focusRow(0);
    return;
  }
  const details =
    active instanceof HTMLElement && active.tagName === "SUMMARY"
      ? (active.parentElement as HTMLDetailsElement | null)
      : null;
  if (key === "ArrowRight") {
    if (details && !details.open) {
      details.open = true;
    } else {
      focusRow(currentIndex + 1);
    }
    return;
  }
  // ArrowLeft: collapse an open node, otherwise move to the parent row.
  if (details?.open) {
    details.open = false;
    return;
  }
  const owner =
    active.tagName === "SUMMARY"
      ? active
          .closest("details")
          ?.parentElement?.closest("details")
          ?.querySelector<HTMLElement>(":scope > summary")
      : active
          .closest("details")
          ?.querySelector<HTMLElement>(":scope > summary");
  owner?.focus();
}

type SidebarProps = {
  sidebarOpen: boolean;
  side: WorkbenchSide;
  activeView: SidebarViewId;
  availableViews?: readonly SidebarViewId[];
  showConnectionRail?: boolean;
  completionPanel: ReactNode;
  historyPanel: ReactNode;
  planPanel: ReactNode;
  lakehousePanel: ReactNode;
  biPanel: ReactNode;
  gitPanel: ReactNode;
  aiChatPanel: ReactNode;
  searchReplacePanel: ReactNode;
  rowDetailPanel: ReactNode;
  connections: WorkspaceConnection[];
  profileById: ReadonlyMap<string, ConnectionDraft>;
  connectionColorFallback: string;
  activeConnectionId: string;
  activeConnection: WorkspaceConnection;
  activeConnectionOpen: boolean;
  activeMetadata: DatabaseMetadata | undefined;
  activeMetadataLoading: boolean;
  activeMetadataError: string | undefined;
  connectedIds: ReadonlySet<string>;
  objectActionMenu: string | null;
  objectKindLabel: (object: DbObjectMetadata) => string;
  formatObjectName: (object: DbObjectMetadata) => string;
  onAddProfile: () => void;
  onOpenConnectionManager: () => void;
  onOpenSqliteSample: () => void;
  onSelectConnection: (
    connection: WorkspaceConnection,
    profile: ConnectionDraft | undefined,
  ) => void;
  onOpenBlankSchemaDesigner: () => void;
  onNewTableFromFile: () => void;
  onOpenObjectSchemaDesigner: (object: DbObjectMetadata) => void;
  onOpenDiagram: () => void;
  onOpenSchemaDiagram: () => void;
  onRefreshObjects: () => void;
  onOpenTableData: (object: DbObjectMetadata) => void;
  onOpenSnapshotObject: (object: SnapshotObject) => void;
  onShowObjectInDiagram: (object: DbObjectMetadata) => void;
  onSetObjectActionMenu: (
    value: string | null | ((current: string | null) => string | null),
  ) => void;
  onSelectView: (viewId: SidebarViewId) => void;
  onCloseSidebar: () => void;
  dockResize?: boolean;
  onBeginResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResizeKey: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};

export function Sidebar({
  sidebarOpen,
  side,
  activeView,
  availableViews,
  showConnectionRail,
  completionPanel,
  historyPanel,
  planPanel,
  lakehousePanel,
  biPanel,
  gitPanel,
  aiChatPanel,
  searchReplacePanel,
  rowDetailPanel,
  connections,
  profileById,
  connectionColorFallback,
  activeConnectionId,
  activeConnection,
  activeConnectionOpen,
  activeMetadata,
  activeMetadataLoading,
  activeMetadataError,
  connectedIds,
  objectActionMenu,
  objectKindLabel,
  formatObjectName,
  onAddProfile,
  onOpenConnectionManager,
  onOpenSqliteSample,
  onSelectConnection,
  onOpenBlankSchemaDesigner,
  onNewTableFromFile,
  onOpenObjectSchemaDesigner,
  onOpenDiagram,
  onOpenSchemaDiagram,
  onRefreshObjects,
  onOpenTableData,
  onOpenSnapshotObject,
  onShowObjectInDiagram,
  onSetObjectActionMenu,
  onSelectView,
  onCloseSidebar,
  dockResize = false,
  onBeginResize,
  onResizeKey,
}: SidebarProps) {
  const [objectActionMenuPosition, setObjectActionMenuPosition] =
    useState<ObjectActionMenuPosition>(null);
  const objectActionMenuRef = useRef<HTMLDivElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [connectionMenu, setConnectionMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const connectionMenuRef = useRef<HTMLDivElement | null>(null);
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);

  useEffect(() => {
    if (!objectActionMenu) {
      setObjectActionMenuPosition(null);
    }
  }, [objectActionMenu]);

  useEffect(() => {
    if (!createMenuOpen) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreateMenuOpen(false);
      }
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && createMenuRef.current?.contains(target)) {
        return;
      }
      setCreateMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnPointerDown);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnPointerDown);
    };
  }, [createMenuOpen]);

  useEffect(() => {
    if (!objectActionMenu) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onSetObjectActionMenu(null);
      }
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".object-menu-button")) {
        return;
      }
      if (
        target instanceof Node &&
        objectActionMenuRef.current?.contains(target)
      ) {
        return;
      }
      onSetObjectActionMenu(null);
    };
    const closeOnBlur = () => onSetObjectActionMenu(null);
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [objectActionMenu, onSetObjectActionMenu]);

  useEffect(() => {
    if (!connectionMenu) {
      return;
    }
    const close = () => setConnectionMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConnectionMenu(null);
      }
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        connectionMenuRef.current?.contains(target)
      ) {
        return;
      }
      setConnectionMenu(null);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
    };
  }, [connectionMenu]);

  function openObjectContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    objectKey: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    onSetObjectActionMenu(objectKey);
    setObjectActionMenuPosition({
      key: objectKey,
      ...clampObjectMenuPosition(event.clientX, event.clientY),
    });
  }

  function renderActivePanel() {
    switch (activeView) {
      case "completion":
        return completionPanel;
      case "queryHistory":
        return historyPanel;
      case "plan":
        return planPanel;
      case "lakehouse":
        return lakehousePanel;
      case "bi":
        return biPanel;
      case "git":
        return gitPanel;
      case "aiChat":
        return aiChatPanel;
      case "searchReplace":
        return searchReplacePanel;
      case "rowDetail":
        return rowDetailPanel;
      case "objectBrowser":
        return null;
    }
  }

  const availableViewSet = new Set(availableViews ?? []);
  const isViewAvailable = (viewId: SidebarViewId) =>
    !availableViews || availableViewSet.has(viewId);

  return (
    <>
      {showConnectionRail !== false ? (
        <nav className="connection-rail" aria-label={t("rail.connections")}>
          <button
            className="rail-action"
            type="button"
            title={t("connection.newConnection")}
            aria-label={t("connection.newConnection")}
            onClick={onAddProfile}
          >
            <Plus size={16} />
          </button>
          <div className="rail-connection-list">
            {connections.map((connection) => {
              const profile = profileById.get(connection.id);
              const active = connection.id === activeConnectionId;
              const connected = connectedIds.has(connection.id);
              return (
                <button
                  className={`rail-connection${active ? " active" : ""}`}
                  key={connection.id}
                  type="button"
                  title={`${connection.name} · ${connection.engine} · ${
                    connected
                      ? t("rail.statusConnected")
                      : t("rail.statusClosed")
                  }`}
                  aria-label={t("rail.switchTo", { name: connection.name })}
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelectConnection(connection, profile)}
                  onDoubleClick={onOpenConnectionManager}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setConnectionMenu({
                      id: connection.id,
                      ...clampObjectMenuPosition(event.clientX, event.clientY),
                    });
                  }}
                >
                  <EngineIcon engine={connection.engine} size={17} />
                  <span
                    className="connection-color-dot"
                    style={{
                      background: profile?.color || connectionColorFallback,
                    }}
                    aria-hidden="true"
                  />
                  <i
                    className={connected ? "connected" : ""}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
          {connectionMenu
            ? (() => {
                const connection = connections.find(
                  (item) => item.id === connectionMenu.id,
                );
                if (!connection) {
                  return null;
                }
                const profile = profileById.get(connection.id);
                const connected = connectedIds.has(connection.id);
                const isActive = connection.id === activeConnectionId;
                const close = () => setConnectionMenu(null);
                return (
                  <div
                    ref={connectionMenuRef}
                    className="object-action-menu object-action-menu-context"
                    role="menu"
                    style={{ left: connectionMenu.x, top: connectionMenu.y }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onSelectConnection(connection, profile);
                        close();
                      }}
                    >
                      {connected
                        ? t("sidebar.menu.switchToConnection")
                        : t("sidebar.menu.connect")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onSelectConnection(connection, profile);
                        onOpenConnectionManager();
                        close();
                      }}
                    >
                      {t("sidebar.menu.editConnection")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!isActive || !activeConnectionOpen}
                      onClick={() => {
                        onRefreshObjects();
                        close();
                      }}
                    >
                      {t("sidebar.refreshObjects")}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        void navigator.clipboard?.writeText(connection.name);
                        close();
                      }}
                    >
                      {t("sidebar.menu.copyName")}
                    </button>
                    {profile?.url ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          void navigator.clipboard?.writeText(profile.url);
                          close();
                        }}
                      >
                        {t("sidebar.menu.copyConnectionString")}
                      </button>
                    ) : null}
                  </div>
                );
              })()
            : null}
        </nav>
      ) : null}
      {sidebarOpen ? (
        <aside className={`sidebar sidebar-${side}`}>
          <div
            className="sidebar-view-switcher"
            role="tablist"
            aria-label={t("sidebar.views")}
          >
            {isViewAvailable("objectBrowser") ? (
              <button
                type="button"
                role="tab"
                className={
                  activeView === "objectBrowser" ? "active" : undefined
                }
                aria-selected={activeView === "objectBrowser"}
                title={t("sidebar.view.tables")}
                aria-label={t("sidebar.view.tables")}
                onClick={() => onSelectView("objectBrowser")}
              >
                <Table2 size={14} />
                <span>{t("sidebar.view.tables")}</span>
              </button>
            ) : null}
            {isViewAvailable("completion") ? (
              <button
                type="button"
                role="tab"
                className={activeView === "completion" ? "active" : undefined}
                aria-selected={activeView === "completion"}
                title={t("sidebar.view.completion")}
                aria-label={t("sidebar.view.completion")}
                onClick={() => onSelectView("completion")}
              >
                <ListPlus size={14} />
                <span>{t("sidebar.view.completion")}</span>
              </button>
            ) : null}
            {isViewAvailable("queryHistory") ? (
              <button
                type="button"
                role="tab"
                className={activeView === "queryHistory" ? "active" : undefined}
                aria-selected={activeView === "queryHistory"}
                title={t("sidebar.view.history")}
                aria-label={t("sidebar.view.history")}
                onClick={() => onSelectView("queryHistory")}
              >
                <History size={14} />
                <span>{t("sidebar.view.history")}</span>
              </button>
            ) : null}
            {isViewAvailable("plan") ? (
              <button
                type="button"
                role="tab"
                className={activeView === "plan" ? "active" : undefined}
                aria-selected={activeView === "plan"}
                title={t("sidebar.view.plan")}
                aria-label={t("sidebar.view.plan")}
                onClick={() => onSelectView("plan")}
              >
                <Flame size={14} />
                <span>{t("sidebar.view.plan")}</span>
              </button>
            ) : null}
            {isViewAvailable("lakehouse") ? (
              <button
                type="button"
                role="tab"
                className={activeView === "lakehouse" ? "active" : undefined}
                aria-selected={activeView === "lakehouse"}
                title={t("sidebar.view.lakehouse")}
                aria-label={t("sidebar.view.lakehouse")}
                onClick={() => onSelectView("lakehouse")}
              >
                <Layers3 size={14} />
                <span>{t("sidebar.view.lake")}</span>
              </button>
            ) : null}
            {isViewAvailable("bi") ? (
              <button
                type="button"
                role="tab"
                className={activeView === "bi" ? "active" : undefined}
                aria-selected={activeView === "bi"}
                title={t("sidebar.view.bi")}
                aria-label={t("sidebar.view.bi")}
                onClick={() => onSelectView("bi")}
              >
                <BarChart3 size={14} />
                <span>{t("sidebar.view.bi")}</span>
              </button>
            ) : null}
            {isViewAvailable("git") ? (
              <button
                type="button"
                role="tab"
                className={activeView === "git" ? "active" : undefined}
                aria-selected={activeView === "git"}
                title={t("sidebar.view.git")}
                aria-label={t("sidebar.view.git")}
                onClick={() => onSelectView("git")}
              >
                <GitBranch size={14} />
                <span>{t("sidebar.view.git")}</span>
              </button>
            ) : null}
            {isViewAvailable("aiChat") ? (
              <button
                type="button"
                role="tab"
                className={activeView === "aiChat" ? "active" : undefined}
                aria-selected={activeView === "aiChat"}
                title={t("ai.chat.title")}
                aria-label={t("ai.chat.title")}
                onClick={() => onSelectView("aiChat")}
              >
                <Bot size={14} />
                <span>{t("sidebar.view.chat")}</span>
              </button>
            ) : null}
            {isViewAvailable("searchReplace") ? (
              <button
                type="button"
                role="tab"
                className={
                  activeView === "searchReplace" ? "active" : undefined
                }
                aria-selected={activeView === "searchReplace"}
                title={t("sidebar.view.searchReplace")}
                aria-label={t("sidebar.view.searchReplace")}
                onClick={() => onSelectView("searchReplace")}
              >
                <Search size={14} />
                <span>{t("sidebar.view.find")}</span>
              </button>
            ) : null}
            {isViewAvailable("rowDetail") ? (
              <button
                type="button"
                role="tab"
                className={activeView === "rowDetail" ? "active" : undefined}
                aria-selected={activeView === "rowDetail"}
                title={t("sidebar.view.rowDetail")}
                aria-label={t("sidebar.view.rowDetail")}
                onClick={() => onSelectView("rowDetail")}
              >
                <TableProperties size={14} />
                <span>{t("sidebar.view.rowDetail")}</span>
              </button>
            ) : null}
          </div>
          {activeView === "objectBrowser" ? (
            <section className="sidebar-section browser-section">
              <div className="section-heading">
                <span>
                  {activeMetadata
                    ? t("sidebar.schemasCount", {
                        count: activeMetadata.schemas.length,
                      })
                    : "public"}
                </span>
                <div className="section-heading-actions">
                  <div className="schema-create-menu-wrap" ref={createMenuRef}>
                    <button
                      type="button"
                      title={t("sidebar.newTable")}
                      aria-label={t("sidebar.newTable")}
                      aria-expanded={createMenuOpen}
                      onClick={() => setCreateMenuOpen((open) => !open)}
                    >
                      <Plus size={14} />
                    </button>
                    {createMenuOpen ? (
                      <div className="schema-create-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setCreateMenuOpen(false);
                            onOpenBlankSchemaDesigner();
                          }}
                        >
                          {t("sidebar.menu.newTable")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setCreateMenuOpen(false);
                            onNewTableFromFile();
                          }}
                        >
                          {t("sidebar.menu.newTableFromFile")}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setCreateMenuOpen(false);
                            onOpenSchemaDiagram();
                          }}
                        >
                          {t("sidebar.menu.designOnCanvas")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    title={t("erd.title")}
                    aria-label={t("erd.title")}
                    disabled={!hasDiagram(activeMetadata)}
                    onClick={onOpenDiagram}
                  >
                    <Share2 size={14} />
                  </button>
                  <button
                    type="button"
                    title={t("sidebar.refreshObjects")}
                    aria-label={t("sidebar.refreshObjects")}
                    disabled={!activeConnectionOpen || activeMetadataLoading}
                    onClick={onRefreshObjects}
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button
                    type="button"
                    title={t("sidebar.close")}
                    aria-label={t("sidebar.close")}
                    onClick={onCloseSidebar}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              <div
                className="object-browser"
                aria-label={t("sidebar.databaseObjects")}
                onKeyDown={handleTreeKeyDown}
              >
                {activeMetadataLoading ? (
                  <div
                    className="metadata-skeleton"
                    role="status"
                    aria-label={t("sidebar.loadingObjects")}
                  >
                    {Array.from({ length: 6 }, (_, index) => (
                      <span key={index} />
                    ))}
                  </div>
                ) : activeMetadataError ? (
                  <div className="inline-error browser-error">
                    <AlertTriangle size={13} />
                    <span>{activeMetadataError}</span>
                  </div>
                ) : activeMetadata ? (
                  activeMetadata.schemas.length > 0 ? (
                    activeMetadata.schemas.map((schema) => (
                      <details className="schema-tree" key={schema.name} open>
                        <summary>
                          <Folder size={14} />
                          <span>{schema.name}</span>
                          <small>{schema.objects.length}</small>
                        </summary>
                        {schema.objects.map((object) => {
                          const objectKey = `${object.schema}.${object.name}`;
                          const canOpenData =
                            object.kind === "table" || object.kind === "view";
                          return (
                            <details className="object-tree" key={objectKey}>
                              <summary
                                onContextMenu={(event) =>
                                  openObjectContextMenu(event, objectKey)
                                }
                              >
                                {object.kind === "procedure" ||
                                object.kind === "function" ? (
                                  <TerminalSquare size={15} />
                                ) : (
                                  <Table2 size={15} />
                                )}
                                <button
                                  className="object-name-button"
                                  type="button"
                                  disabled={!canOpenData}
                                  title={
                                    canOpenData
                                      ? t("sidebar.openObject", {
                                          name: formatObjectName(object),
                                        })
                                      : objectKindLabel(object)
                                  }
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onOpenTableData(object);
                                  }}
                                >
                                  {object.name}
                                </button>
                                <small>
                                  {objectKindLabel(object)} ·{" "}
                                  {object.columns.length}
                                </small>
                                <button
                                  className="object-menu-button"
                                  type="button"
                                  title={t("sidebar.objectActions")}
                                  aria-label={t("sidebar.objectActionsFor", {
                                    name: object.name,
                                  })}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onSetObjectActionMenu((current) =>
                                      current === objectKey ? null : objectKey,
                                    );
                                    setObjectActionMenuPosition(null);
                                  }}
                                >
                                  <MoreHorizontal size={14} />
                                </button>
                                {objectActionMenu === objectKey ? (
                                  <div
                                    ref={objectActionMenuRef}
                                    className={
                                      objectActionMenuPosition?.key ===
                                      objectKey
                                        ? "object-action-menu object-action-menu-context"
                                        : "object-action-menu"
                                    }
                                    role="menu"
                                    style={
                                      objectActionMenuPosition?.key ===
                                      objectKey
                                        ? {
                                            left: objectActionMenuPosition.x,
                                            top: objectActionMenuPosition.y,
                                          }
                                        : undefined
                                    }
                                  >
                                    <button
                                      type="button"
                                      role="menuitem"
                                      disabled={!canOpenData}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onOpenTableData(object);
                                      }}
                                    >
                                      {t("sidebar.menu.openData")}
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      disabled={object.kind !== "table"}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onOpenObjectSchemaDesigner(object);
                                        onSetObjectActionMenu(null);
                                      }}
                                    >
                                      {t("sidebar.menu.structure")}
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      disabled={!hasDiagram(activeMetadata)}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onShowObjectInDiagram(object);
                                      }}
                                    >
                                      {t("sidebar.menu.showInErd")}
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void navigator.clipboard?.writeText(
                                          formatObjectName(object),
                                        );
                                        onSetObjectActionMenu(null);
                                      }}
                                    >
                                      {t("sidebar.menu.copyName")}
                                    </button>
                                  </div>
                                ) : null}
                              </summary>
                              <div className="metadata-children">
                                {object.columns.length > 0 ? (
                                  object.columns.map((column) => (
                                    <button
                                      className="metadata-row field-row"
                                      key={`${object.schema}.${object.name}.${column.name}`}
                                      type="button"
                                      title={`${column.name}: ${column.dataType}`}
                                    >
                                      <Columns3 size={13} />
                                      <span>{column.name}</span>
                                      <small>
                                        {column.dataType}
                                        {column.nullable ? "" : " not null"}
                                      </small>
                                    </button>
                                  ))
                                ) : (
                                  <div className="metadata-empty">
                                    {t("sidebar.noFields")}
                                  </div>
                                )}
                              </div>
                            </details>
                          );
                        })}
                      </details>
                    ))
                  ) : (
                    <div className="empty-browser-cta">
                      <p>{t("sidebar.empty.databaseEmpty")}</p>
                      <button
                        type="button"
                        className="text-button primary"
                        onClick={onOpenBlankSchemaDesigner}
                      >
                        {t("sidebar.empty.createTable")}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={onNewTableFromFile}
                      >
                        {t("sidebar.empty.importFromFile")}
                      </button>
                      <small>{t("sidebar.empty.editorHint")}</small>
                    </div>
                  )
                ) : activeConnection.objects.length > 0 ? (
                  activeConnection.objects.map((object) => (
                    <button
                      className="object-row"
                      key={object.name}
                      type="button"
                      aria-label={object.name}
                      title={object.name}
                      onClick={() => onOpenSnapshotObject(object)}
                    >
                      {object.kind === "procedure" ? (
                        <TerminalSquare size={15} />
                      ) : (
                        <Table2 size={15} />
                      )}
                      <span>{object.name}</span>
                      <small>{object.rows ?? object.kind}</small>
                    </button>
                  ))
                ) : !activeConnectionOpen ? (
                  <div className="empty-browser-cta">
                    <p>{t("sidebar.empty.notConnected")}</p>
                    <button
                      type="button"
                      className="text-button primary"
                      onClick={onOpenSqliteSample}
                    >
                      {t("sidebar.empty.openSample")}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={onAddProfile}
                    >
                      {t("sidebar.empty.addConnection")}
                    </button>
                    <small>{t("sidebar.empty.sampleHint")}</small>
                  </div>
                ) : (
                  <div className="empty-browser">
                    {t("sidebar.noObjectsLoaded")}
                  </div>
                )}
              </div>
            </section>
          ) : (
            <div className="sidebar-panel">{renderActivePanel()}</div>
          )}
          {!dockResize ? (
            <div
              className="panel-resizer sidebar-resizer"
              role="separator"
              aria-label={t("sidebar.resize")}
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={onBeginResize}
              onKeyDown={onResizeKey}
            />
          ) : null}
        </aside>
      ) : null}
    </>
  );
}

function clampObjectMenuPosition(x: number, y: number) {
  if (typeof window === "undefined") {
    return { x, y };
  }
  const menuWidth = 218;
  const menuHeight = 150;
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
  };
}
