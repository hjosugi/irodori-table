import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Columns3,
  Database,
  Folder,
  GitBranch,
  History,
  ListPlus,
  MoreHorizontal,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Share2,
  Table2,
  TerminalSquare,
  X,
} from "lucide-react";
import { hasDiagram } from "@/features/erd";
import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import {
  defaultConnectionColor,
  type ConnectionDraft,
  type WorkspaceConnection,
} from "@/features/connections";
import type { WorkbenchSide, WorkbenchViewId } from "../types";

type SnapshotObject = WorkspaceConnection["objects"][number];
type ObjectActionMenuPosition = { key: string; x: number; y: number } | null;
type SidebarViewId = WorkbenchViewId;

type SidebarProps = {
  sidebarOpen: boolean;
  sidebarSide: WorkbenchSide;
  activeView: SidebarViewId;
  completionPanel: ReactNode;
  historyPanel: ReactNode;
  gitPanel: ReactNode;
  connections: WorkspaceConnection[];
  profileById: ReadonlyMap<string, ConnectionDraft>;
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
  onSelectConnection: (
    connection: WorkspaceConnection,
    profile: ConnectionDraft | undefined,
  ) => void;
  onOpenBlankSchemaDesigner: () => void;
  onOpenObjectSchemaDesigner: (object: DbObjectMetadata) => void;
  onOpenDiagram: () => void;
  onRefreshObjects: () => void;
  onOpenTableData: (object: DbObjectMetadata) => void;
  onOpenSnapshotObject: (object: SnapshotObject) => void;
  onShowObjectInDiagram: (object: DbObjectMetadata) => void;
  onSetObjectActionMenu: (value: string | null | ((current: string | null) => string | null)) => void;
  onSelectView: (viewId: SidebarViewId) => void;
  onCloseSidebar: () => void;
  onToggleSidebarSide: () => void;
  onBeginResize: (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onResizeKey: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};

export function Sidebar({
  sidebarOpen,
  sidebarSide,
  activeView,
  completionPanel,
  historyPanel,
  gitPanel,
  connections,
  profileById,
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
  onSelectConnection,
  onOpenBlankSchemaDesigner,
  onOpenObjectSchemaDesigner,
  onOpenDiagram,
  onRefreshObjects,
  onOpenTableData,
  onOpenSnapshotObject,
  onShowObjectInDiagram,
  onSetObjectActionMenu,
  onSelectView,
  onCloseSidebar,
  onToggleSidebarSide,
  onBeginResize,
  onResizeKey,
}: SidebarProps) {
  const [objectActionMenuPosition, setObjectActionMenuPosition] =
    useState<ObjectActionMenuPosition>(null);
  const objectActionMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!objectActionMenu) {
      setObjectActionMenuPosition(null);
    }
  }, [objectActionMenu]);

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
      if (
        target instanceof Element &&
        target.closest(".object-menu-button")
      ) {
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

  return (
    <>
      <nav className="connection-rail" aria-label="Connections">
        <button
          className="rail-action"
          type="button"
          title="New connection"
          aria-label="New connection"
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
                title={`${connection.name} · ${connection.engine}${
                  connected ? " · connected" : " · closed"
                }`}
                aria-label={`Switch to ${connection.name}`}
                aria-current={active ? "true" : undefined}
                onClick={() => onSelectConnection(connection, profile)}
                onDoubleClick={onOpenConnectionManager}
              >
                <Database size={17} />
                <span
                  className="connection-color-dot"
                  style={{
                    background: profile?.color || defaultConnectionColor,
                  }}
                  aria-hidden="true"
                />
                <i className={connected ? "connected" : ""} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </nav>
      {sidebarOpen ? (
        <aside className="sidebar">
          <div className="sidebar-view-switcher" role="tablist" aria-label="Sidebar views">
            <button
              type="button"
              role="tab"
              className={activeView === "objectBrowser" ? "active" : undefined}
              aria-selected={activeView === "objectBrowser"}
              title="Tables"
              aria-label="Tables"
              onClick={() => onSelectView("objectBrowser")}
            >
              <Table2 size={14} />
              <span>Tables</span>
            </button>
            <button
              type="button"
              role="tab"
              className={activeView === "completion" ? "active" : undefined}
              aria-selected={activeView === "completion"}
              title="Completion"
              aria-label="Completion"
              onClick={() => onSelectView("completion")}
            >
              <ListPlus size={14} />
              <span>Completion</span>
            </button>
            <button
              type="button"
              role="tab"
              className={activeView === "queryHistory" ? "active" : undefined}
              aria-selected={activeView === "queryHistory"}
              title="History"
              aria-label="History"
              onClick={() => onSelectView("queryHistory")}
            >
              <History size={14} />
              <span>History</span>
            </button>
            <button
              type="button"
              role="tab"
              className={activeView === "git" ? "active" : undefined}
              aria-selected={activeView === "git"}
              title="Git"
              aria-label="Git"
              onClick={() => onSelectView("git")}
            >
              <GitBranch size={14} />
              <span>Git</span>
            </button>
            <button
              className="sidebar-side-button"
              type="button"
              title={sidebarSide === "left" ? "Move sidebar right" : "Move sidebar left"}
              aria-label={sidebarSide === "left" ? "Move sidebar right" : "Move sidebar left"}
              onClick={onToggleSidebarSide}
            >
              {sidebarSide === "left" ? (
                <PanelRightOpen size={14} />
              ) : (
                <PanelLeftOpen size={14} />
              )}
            </button>
          </div>
          {activeView === "objectBrowser" ? (
          <section className="sidebar-section browser-section">
            <div className="section-heading">
              <span>
                {activeMetadata
                  ? `${activeMetadata.schemas.length} schemas`
                  : "public"}
              </span>
              <div className="section-heading-actions">
                <button
                  type="button"
                  title="Schema designer"
                  aria-label="Schema designer"
                  onClick={onOpenBlankSchemaDesigner}
                >
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  title="ER diagram"
                  aria-label="ER diagram"
                  disabled={!hasDiagram(activeMetadata)}
                  onClick={onOpenDiagram}
                >
                  <Share2 size={14} />
                </button>
                <button
                  type="button"
                  title="Refresh objects"
                  aria-label="Refresh objects"
                  disabled={!activeConnectionOpen || activeMetadataLoading}
                  onClick={onRefreshObjects}
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  type="button"
                  title="Close sidebar"
                  aria-label="Close sidebar"
                  onClick={onCloseSidebar}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="object-browser">
              {activeMetadataLoading ? (
                <div className="empty-browser loading" role="status">
                  Loading objects...
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
                          <details
                            className="object-tree"
                            key={objectKey}
                          >
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
                                    ? `Open ${formatObjectName(object)}`
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
                                {objectKindLabel(object)} · {object.columns.length}
                              </small>
                              <button
                                className="object-menu-button"
                                type="button"
                                title="Object actions"
                                aria-label={`Actions for ${object.name}`}
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
                                    objectActionMenuPosition?.key === objectKey
                                      ? "object-action-menu object-action-menu-context"
                                      : "object-action-menu"
                                  }
                                  role="menu"
                                  style={
                                    objectActionMenuPosition?.key === objectKey
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
                                    Open Data
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
                                    Structure
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
                                    Show in ERD
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
                                    Copy Name
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
                                <div className="metadata-empty">No fields</div>
                              )}
                            </div>
                          </details>
                        );
                      })}
                    </details>
                  ))
                ) : (
                  <div className="empty-browser">No objects found</div>
                )
              ) : activeConnection.objects.length > 0 ? (
                activeConnection.objects.map((object) => (
                  <button
                    className="object-row"
                    key={object.name}
                    type="button"
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
              ) : (
                <div className="empty-browser">No objects loaded</div>
              )}
            </div>
          </section>
          ) : (
            <div className="sidebar-panel">
              {activeView === "completion"
                ? completionPanel
                : activeView === "queryHistory"
                  ? historyPanel
                  : gitPanel}
            </div>
          )}
          <div
            className="panel-resizer sidebar-resizer"
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={onBeginResize}
            onKeyDown={onResizeKey}
          />
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
