import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Bot,
  Boxes,
  Check,
  Columns3,
  Flame,
  Folder,
  GitBranch,
  History,
  Layers3,
  ListPlus,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Search,
  Table2,
  TableProperties,
  TerminalSquare,
  X,
  type LucideIcon,
} from "lucide-react";
import { EngineIcon } from "@/components/EngineIcon";
import { hasDiagram } from "@/features/erd";
import type {
  DatabaseMetadata,
  DbEngine,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import { isLakehouseEngine } from "./LakehousePanel";
import type {
  ConnectionDraft,
  WorkspaceConnection,
} from "@/lib/workspace-connection";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator, type TranslationKey } from "@/i18n";
import { workbenchViewIds } from "../types";
import type { WorkbenchViewId } from "../types";
import type { WorkbenchSide } from "../types";

type SnapshotObject = WorkspaceConnection["objects"][number];
type ObjectActionMenuPosition = { key: string; x: number; y: number } | null;
type SidebarViewId = WorkbenchViewId;

type ViewTabMeta = {
  icon: LucideIcon;
  // Tooltip/aria text and the (usually shorter) tab label.
  title: TranslationKey;
  label: TranslationKey;
};

const viewTabMeta: Record<SidebarViewId, ViewTabMeta> = {
  objectBrowser: {
    icon: Table2,
    title: "sidebar.view.tables",
    label: "sidebar.view.tables",
  },
  completion: {
    icon: ListPlus,
    title: "sidebar.view.completion",
    label: "sidebar.view.completion",
  },
  queryHistory: {
    icon: History,
    title: "sidebar.view.history",
    label: "sidebar.view.history",
  },
  plan: { icon: Flame, title: "sidebar.view.plan", label: "sidebar.view.plan" },
  lakehouse: {
    icon: Layers3,
    title: "sidebar.view.lakehouse",
    label: "sidebar.view.lake",
  },
  bi: { icon: BarChart3, title: "sidebar.view.bi", label: "sidebar.view.bi" },
  git: {
    icon: GitBranch,
    title: "sidebar.view.git",
    label: "sidebar.view.git",
  },
  aiChat: { icon: Bot, title: "ai.chat.title", label: "sidebar.view.chat" },
  searchReplace: {
    icon: Search,
    title: "sidebar.view.searchReplace",
    label: "sidebar.view.find",
  },
  rowDetail: {
    icon: TableProperties,
    title: "sidebar.view.rowDetail",
    label: "sidebar.view.rowDetail",
  },
  knowledge: {
    icon: BookOpen,
    title: "sidebar.view.knowledge",
    label: "sidebar.view.knowledge",
  },
};

/**
 * Engines whose lakehouse source-type contract (knowledge/engines.json) names
 * the level between connection and table something other than "schema", keyed
 * by `DbEngine` id.
 *
 * The object browser renders one tree for every engine, so only the vocabulary
 * and the container icon follow the contract; engines absent here stay on
 * schemas.
 */
const containerLabelKeyByEngine: Record<string, TranslationKey> = {
  duckdb: "sidebar.namespacesCount",
  motherduck: "sidebar.namespacesCount",
  iceberg: "sidebar.namespacesCount",
  s3Tables: "sidebar.namespacesCount",
  deltaLake: "sidebar.namespacesCount",
  hudi: "sidebar.namespacesCount",
  hive: "sidebar.databasesCount",
  athena: "sidebar.databasesCount",
};

// Menus in the sidebar are portaled to <body> and positioned with fixed
// viewport coordinates: the sidebar lives inside scroll containers and
// dockview panels whose overflow/stacking clips absolutely-positioned
// popovers (menus silently appeared "not to open" near panel edges).
function floatingMenuStyle(x: number, y: number) {
  return {
    position: "fixed",
    left: x,
    top: y,
    right: "auto",
    zIndex: 60,
  } as const;
}

// A custom drag payload type carries the dragged view id across the two
// Sidebar instances (left and right). `text/plain` is also set for legacy
// reorder/accessibility, but this typed entry is what the opposite side reads
// to recognise a view being docked onto it — and its mere presence in
// `dataTransfer.types` is readable mid-drag (unlike the value), so the drop
// target can light up before the drop lands.
const VIEW_DND_MIME = "application/x-irodori-view";

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
  /** Every view assigned to this side (hidden ones included), in tab order. */
  sideViews?: readonly SidebarViewId[];
  hiddenViews?: Readonly<Partial<Record<SidebarViewId, boolean>>>;
  onMoveView?: (viewId: SidebarViewId, side: WorkbenchSide) => void;
  onSetViewHidden?: (viewId: SidebarViewId, hidden: boolean) => void;
  onReorderView?: (
    sourceId: SidebarViewId,
    targetId: SidebarViewId,
    position: "before" | "after",
  ) => void;
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
  knowledgePanel: ReactNode;
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
  sideViews,
  hiddenViews,
  onMoveView,
  onSetViewHidden,
  onReorderView,
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
  knowledgePanel,
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
  const createMenuAnchorRef = useRef<HTMLDivElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const [createMenu, setCreateMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [connectionMenu, setConnectionMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const connectionMenuRef = useRef<HTMLDivElement | null>(null);
  const [viewMenu, setViewMenu] = useState<{
    id: SidebarViewId;
    x: number;
    y: number;
  } | null>(null);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);
  const draggedViewRef = useRef<SidebarViewId | null>(null);
  const [viewDragOver, setViewDragOver] = useState<{
    id: SidebarViewId;
    position: "before" | "after";
  } | null>(null);
  // True while a view dragged from the *other* side hovers this side's tab
  // strip: the strip is a drop zone that docks that view here.
  const [sideDropActive, setSideDropActive] = useState(false);
  const locale = usePreferencesStore((state) => state.locale);
  const sidebarViewLabels = usePreferencesStore(
    (state) => state.sidebarViewLabels,
  );
  const { t } = createTranslator(locale);
  const lakehouseConnection = isLakehouseEngine(
    activeConnection.engine as DbEngine,
  );
  const containerLabelKey =
    containerLabelKeyByEngine[activeConnection.engine] ??
    "sidebar.schemasCount";

  useEffect(() => {
    if (!objectActionMenu) {
      setObjectActionMenuPosition(null);
    }
  }, [objectActionMenu]);

  useEffect(() => {
    if (!createMenu) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreateMenu(null);
      }
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (createMenuRef.current?.contains(target) ||
          createMenuAnchorRef.current?.contains(target))
      ) {
        return;
      }
      setCreateMenu(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnPointerDown);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnPointerDown);
    };
  }, [createMenu]);

  useEffect(() => {
    if (!viewMenu) {
      return;
    }
    const close = () => setViewMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewMenu(null);
      }
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && viewMenuRef.current?.contains(target)) {
        return;
      }
      setViewMenu(null);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
    };
  }, [viewMenu]);

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

  // The `⋯` button variant of the object menu anchors below the button
  // instead of at the pointer, but is otherwise the same portaled menu.
  function toggleObjectActionMenu(
    event: ReactMouseEvent<HTMLElement>,
    objectKey: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = clampObjectMenuPosition(rect.right - 218, rect.bottom + 4);
    onSetObjectActionMenu((current) =>
      current === objectKey ? null : objectKey,
    );
    setObjectActionMenuPosition({ key: objectKey, ...anchor });
  }

  function openViewMenu(
    event: ReactMouseEvent<HTMLElement>,
    viewId: SidebarViewId,
  ) {
    if (!onSetViewHidden && !onMoveView) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setViewMenu({
      id: viewId,
      ...clampObjectMenuPosition(event.clientX, event.clientY),
    });
  }

  function handleViewDragStart(
    event: ReactDragEvent<HTMLButtonElement>,
    viewId: SidebarViewId,
  ) {
    draggedViewRef.current = viewId;
    event.dataTransfer.setData("text/plain", viewId);
    // The typed payload is what the opposite side reads to dock the view.
    event.dataTransfer.setData(VIEW_DND_MIME, viewId);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleViewDragOver(
    event: ReactDragEvent<HTMLButtonElement>,
    viewId: SidebarViewId,
  ) {
    const source = draggedViewRef.current;
    if (!onReorderView || !source || source === viewId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const position =
      event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    setViewDragOver((current) =>
      current?.id === viewId && current.position === position
        ? current
        : { id: viewId, position },
    );
  }

  function handleViewDrop(
    event: ReactDragEvent<HTMLButtonElement>,
    viewId: SidebarViewId,
  ) {
    const source = draggedViewRef.current;
    if (!onReorderView || !source || source === viewId) {
      // Not a same-side reorder (e.g. a view dragged in from the other side):
      // let it bubble to the strip drop zone, which docks it here.
      return;
    }
    event.preventDefault();
    // A handled same-side reorder must not also reach the strip's cross-side
    // drop handler.
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const position =
      event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    onReorderView(source, viewId, position);
    draggedViewRef.current = null;
    setViewDragOver(null);
  }

  function handleViewDragEnd() {
    draggedViewRef.current = null;
    setViewDragOver(null);
    setSideDropActive(false);
  }

  // The tab strip is a drop zone for a view dragged in from the *other* side.
  // A drag that started on this side (our ref is set) is a reorder, handled per
  // tab; only a drag with our typed payload and no local source is a cross-side
  // dock move.
  function isForeignViewDrag(event: ReactDragEvent<HTMLDivElement>) {
    return (
      Boolean(onMoveView) &&
      draggedViewRef.current === null &&
      Array.from(event.dataTransfer.types).includes(VIEW_DND_MIME)
    );
  }

  function handleStripDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!isForeignViewDrag(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setSideDropActive(true);
  }

  function handleStripDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) {
      return;
    }
    setSideDropActive(false);
  }

  function handleStripDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (draggedViewRef.current !== null || !onMoveView) {
      setSideDropActive(false);
      return;
    }
    const dropped = event.dataTransfer.getData(VIEW_DND_MIME);
    setSideDropActive(false);
    if (!workbenchViewIds.includes(dropped as SidebarViewId)) {
      return;
    }
    event.preventDefault();
    // moveView no-ops when the view is already on this side or is pinned
    // (object browser), so no extra guard is needed here.
    onMoveView(dropped as SidebarViewId, side);
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
      case "knowledge":
        return knowledgePanel;
      case "objectBrowser":
        return null;
    }
  }

  const tabViews = availableViews ?? workbenchViewIds;
  const manageableViews = sideViews ?? tabViews;
  const canManageViews = Boolean(onSetViewHidden || onMoveView);

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
                    // Without this, the workbench shell's generic context
                    // menu opens on top of this one from the same click.
                    event.stopPropagation();
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
                return createPortal(
                  <div
                    ref={connectionMenuRef}
                    className="object-action-menu"
                    role="menu"
                    style={floatingMenuStyle(
                      connectionMenu.x,
                      connectionMenu.y,
                    )}
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
                  </div>,
                  document.body,
                );
              })()
            : null}
        </nav>
      ) : null}
      {sidebarOpen ? (
        <aside className={`sidebar sidebar-${side}`}>
          <div
            className={`sidebar-view-switcher${
              sideDropActive ? " side-drop-active" : ""
            }`}
            role="tablist"
            aria-label={t("sidebar.views")}
            onDragOver={onMoveView ? handleStripDragOver : undefined}
            onDragLeave={onMoveView ? handleStripDragLeave : undefined}
            onDrop={onMoveView ? handleStripDrop : undefined}
          >
            {tabViews.map((viewId) => {
              const meta = viewTabMeta[viewId];
              const TabIcon = meta.icon;
              const dragClass =
                viewDragOver?.id === viewId
                  ? ` drag-over-${viewDragOver.position}`
                  : "";
              return (
                <button
                  key={viewId}
                  type="button"
                  role="tab"
                  className={
                    `${activeView === viewId ? "active" : ""}${dragClass}`.trim() ||
                    undefined
                  }
                  aria-selected={activeView === viewId}
                  title={t(meta.title)}
                  aria-label={t(meta.title)}
                  draggable={Boolean(onReorderView)}
                  onClick={() => onSelectView(viewId)}
                  onContextMenu={(event) => openViewMenu(event, viewId)}
                  onDragStart={(event) => handleViewDragStart(event, viewId)}
                  onDragOver={(event) => handleViewDragOver(event, viewId)}
                  onDrop={(event) => handleViewDrop(event, viewId)}
                  onDragEnd={handleViewDragEnd}
                >
                  <TabIcon size={14} />
                  {/* Icons only by default - the labelled variant wrapped the
                      switcher to a second row. title/aria-label above keep the
                      name available either way; showing text is a setting. */}
                  {sidebarViewLabels ? <span>{t(meta.label)}</span> : null}
                </button>
              );
            })}
          </div>
          {viewMenu && canManageViews
            ? createPortal(
                <div
                  ref={viewMenuRef}
                  className="object-action-menu"
                  role="menu"
                  aria-label={t("sidebar.viewMenu")}
                  style={floatingMenuStyle(viewMenu.x, viewMenu.y)}
                >
                  {onMoveView ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={viewMenu.id === "objectBrowser"}
                      onClick={() => {
                        onMoveView(
                          viewMenu.id,
                          side === "left" ? "right" : "left",
                        );
                        setViewMenu(null);
                      }}
                    >
                      {side === "left"
                        ? t("sidebar.menu.moveToRightSidebar")
                        : t("sidebar.menu.moveToLeftSidebar")}
                    </button>
                  ) : null}
                  {onSetViewHidden ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={viewMenu.id === "objectBrowser"}
                      onClick={() => {
                        onSetViewHidden(viewMenu.id, true);
                        setViewMenu(null);
                      }}
                    >
                      {t("sidebar.menu.hideView", {
                        name: t(viewTabMeta[viewMenu.id].title),
                      })}
                    </button>
                  ) : null}
                  {onSetViewHidden ? (
                    <>
                      <span className="menu-separator" aria-hidden="true" />
                      {manageableViews.map((viewId) => {
                        const visible = !hiddenViews?.[viewId];
                        return (
                          <button
                            key={viewId}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={visible}
                            disabled={viewId === "objectBrowser"}
                            onClick={() => {
                              onSetViewHidden(viewId, visible);
                              setViewMenu(null);
                            }}
                          >
                            <span>{t(viewTabMeta[viewId].title)}</span>
                            {visible ? <Check size={13} /> : null}
                          </button>
                        );
                      })}
                    </>
                  ) : null}
                </div>,
                document.body,
              )
            : null}
          {activeView === "objectBrowser" ? (
            <section className="sidebar-section browser-section">
              <div className="section-heading">
                <span>
                  {activeMetadata
                    ? t(containerLabelKey, {
                        count: activeMetadata.schemas.length,
                      })
                    : t("sidebar.databaseObjects")}
                </span>
                <div className="section-heading-actions">
                  <div
                    className="schema-create-menu-wrap"
                    ref={createMenuAnchorRef}
                  >
                    <button
                      type="button"
                      title={t("sidebar.newTable")}
                      aria-label={t("sidebar.newTable")}
                      aria-expanded={Boolean(createMenu)}
                      onClick={(event) => {
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        setCreateMenu((open) =>
                          open
                            ? null
                            : clampObjectMenuPosition(
                                rect.right - 190,
                                rect.bottom + 4,
                              ),
                        );
                      }}
                    >
                      <Plus size={14} />
                    </button>
                    {createMenu
                      ? createPortal(
                          <div
                            ref={createMenuRef}
                            className="schema-create-menu"
                            role="menu"
                            style={floatingMenuStyle(
                              createMenu.x,
                              createMenu.y,
                            )}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setCreateMenu(null);
                                onOpenBlankSchemaDesigner();
                              }}
                            >
                              {t("sidebar.menu.newTable")}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setCreateMenu(null);
                                onNewTableFromFile();
                              }}
                            >
                              {t("sidebar.menu.newTableFromFile")}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setCreateMenu(null);
                                onOpenSchemaDiagram();
                              }}
                            >
                              {t("sidebar.menu.designOnCanvas")}
                            </button>
                          </div>,
                          document.body,
                        )
                      : null}
                  </div>
                  <button
                    type="button"
                    title={t("erd.title")}
                    aria-label={t("erd.title")}
                    disabled={!hasDiagram(activeMetadata)}
                    onClick={onOpenDiagram}
                  >
                    {/* Linked rectangles, not linked circles: the Share2 glyph
                        this replaces was indistinguishable from the GitBranch
                        icon on the view switcher right above it. */}
                    <Network size={14} />
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
                          {lakehouseConnection ? (
                            <Boxes size={14} />
                          ) : (
                            <Folder size={14} />
                          )}
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
                                  onClick={(event) =>
                                    toggleObjectActionMenu(event, objectKey)
                                  }
                                >
                                  <MoreHorizontal size={14} />
                                </button>
                                {objectActionMenu === objectKey &&
                                objectActionMenuPosition?.key === objectKey
                                  ? createPortal(
                                      <div
                                        ref={objectActionMenuRef}
                                        className="object-action-menu"
                                        role="menu"
                                        style={floatingMenuStyle(
                                          objectActionMenuPosition.x,
                                          objectActionMenuPosition.y,
                                        )}
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
                                      </div>,
                                      document.body,
                                    )
                                  : null}
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
