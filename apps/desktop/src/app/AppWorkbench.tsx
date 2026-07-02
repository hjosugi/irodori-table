import {
  type CSSProperties,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Plus } from "lucide-react";
import {
  queryHistoryMaxItemsHardLimit,
  queryHistoryResultRowsHardLimit,
  useQueryHistoryStore,
  type QueryHistoryItem,
} from "@/features/query-history/query-history-store";
import {
  APP_IDENTIFIER,
  APP_NAME,
  APP_VERSION,
  appCommandCatalog,
  appMenuCommandCatalog,
  fallbackSnapshot,
  loadSavedQuery,
  menuBarSections,
  resultCopyDefaultKeymap,
  savedQueryStorageKey,
} from "@/app/app-config";
import { openTabsForEditorGroup } from "@/app/editor-tabs";
import { AboutDialog } from "@/app/AboutDialog";
import { useResultGridScroll } from "@/app/hooks/useResultGridScroll";
import { useResultGridFiltering } from "@/app/hooks/useResultGridFiltering";
import { useResultGridSelection } from "@/app/hooks/useResultGridSelection";
import type {
  ConnectionController,
  QueryEditorController,
  ResultGridController,
} from "@/app/controllers/workbench-controllers";
import { useConnectionActions } from "@/app/controllers/use-connection-actions";
import { useEditorGroups } from "@/app/controllers/use-editor-groups";
import { useQueryRunner } from "@/app/controllers/use-query-runner";
import { useResultGridEditing } from "@/app/controllers/use-result-grid-editing";
import { useResultGridModel } from "@/app/controllers/use-result-grid-model";
import {
  usePendingResultChangesGuard,
  useResultGridSpillPaging,
} from "@/app/controllers/use-result-grid-runtime";
import { ActionToastStack, useActionNotices } from "@/app/ActionToast";
import { CommandPalette } from "@/app/CommandPalette";
import { useConfirm } from "@/components/ConfirmDialog";
import { GitPanel, useGitStore } from "@/features/git";
import {
  BiPanel,
  ResultsPane,
  WindowedRows,
  buildResultExport,
  buildXlsxBlob,
  formatResultSelectionStatus,
  formatResultGridCell as formatCell,
  historySnapshotToQueryResult,
  resultExportFileName,
  toCount,
  useResultGridStore,
  useResultsStore,
  type ResultExportFormat,
} from "@/features/results";
import {
  ConnectionManagerDialog,
  defaultConnectionColor,
  engineLabel,
  portableProfile,
  settingsProfileFromJson,
  useConnectionStore,
  withStarterProfiles,
  withUniqueProfileIds,
  type WorkspaceConnection,
} from "@/features/connections";
import {
  QueryEditorPane,
  QueryParameterDialog,
  type EditorGroup,
  type EditorSelection,
  type QueryMagicAction,
  type SqlEditorHandle,
} from "@/features/query-editor";
import {
  ImportDialog,
  detectImportFileKind,
  generateImportSql,
  inferImportTableName,
  parseImportText,
  type ImportPreview,
} from "@/features/import";
import {
  ErdDialog,
  buildErdModel,
  downloadBlob,
  erdFileName,
  erdSvgStyle,
  hasDiagram,
  layoutErdModel,
  serializeSvgElement,
  svgMarkupToPngBlob,
  toMermaidErd,
  writePngBlobToClipboard,
  writeTextToClipboard,
  type ErdLayout,
} from "@/features/erd";
import {
  SchemaDesignerDialog,
  buildCreateDatabaseSql,
  buildSchemaSql,
  buildTableSpecDocument,
  ddlFromTableSpecDocument,
  exportTableSpecJson,
  exportTableSpecMarkdown,
  parseTableSpecDocument,
  tableSpecFileName,
  useSchemaDesignerStore,
} from "@/features/schema-designer";
import {
  SchemaDiagramDialog,
  diagramFromMetadata,
  useSchemaDiagramStore,
} from "@/features/schema-diagram";
import { SettingsDialog, type SettingsTab } from "@/features/settings";
import { AiGenerateDialog } from "@/features/ai/AiGenerateDialog";
import { AiChatPanel } from "@/features/ai/chat/AiChatPanel";
import { SearchReplacePanel } from "@/features/search/SearchReplacePanel";
import { useSearchStore } from "@/features/search/search-store";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import {
  UI_ZOOM_DEFAULT,
  UI_ZOOM_STEP,
  normalizeEditorBackgroundOpacity,
  normalizeUiZoom,
  usePreferencesStore,
  type ThemePreference,
} from "@/features/preferences";
import { createTranslator, normalizeLocale } from "@/i18n";
import {
  activeWorkbenchViewForSide,
  createWorkbenchCommandHandler,
  InspectorContent,
  INSPECTOR_WIDTH_MAX,
  INSPECTOR_WIDTH_MIN,
  LakehousePanel,
  PlanPanel,
  RESULTS_HEIGHT_MAX,
  RESULTS_HEIGHT_MIN,
  Sidebar,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  WorkbenchDockLayout,
  WorkbenchShell,
  completionHintsFromMetadata,
  createPanelResizeController,
  objectKindLabel,
  qualifiedObjectName,
  quoteSqlIdentifier,
  tablePreviewSql,
  useWorkbenchStore,
  workbenchRuntimeService,
  workbenchViewsForSide,
  workbenchViewIds,
  type CompletionHint,
  type WorkbenchViewId,
  type WorkbenchViewPlacements,
  type WorkbenchViewVisibility,
} from "@/features/workbench";
import {
  KEY_SEQUENCE_TIMEOUT_MS,
  applyVimKeybindingResolutions as applyVimKeybindingResolutionOverrides,
  errorMessage,
  effectiveKeymap,
  eventToChord,
  findConflicts,
  findVimKeybindingConflicts,
  formatKeySequence,
  type KeybindingScope,
  type Keymap,
  type VimKeybindingConflictResolutions,
  loadOverrides,
  resolveKeybinding,
  saveOverrides,
} from "@/core";
import type {
  DbEngine,
  DbObjectMetadata,
  JobList,
  QueryPlanAnalysis,
  QueryPlanCopyFormat,
  QueryPlanMode,
  QueryResult,
  WorkspaceSnapshot,
} from "@/generated/irodori-api";
import { sqlSnippetsFromJson } from "@/sql/completion";
import { isSqlFormatterId } from "@/sql/formatter";
import { isSqlLinterId } from "@/sql/linter";
import type { SqlEditorTransformAction } from "@/sql/editor-transforms";
import type { SqlMetadataTarget } from "@/sql/metadata-inspection";
import { selectedOrCurrentStatement } from "@/sql/statements";
import {
  cssVariables,
  customThemeEntryFromJson,
  defaultThemeById,
  defaultThemeEntryForKind,
  importThemeJson,
  upsertCustomThemeEntry,
  type ThemeKind,
} from "@/theme";
import {
  GRID_COLUMN_WIDTH,
  GRID_GUTTER_WIDTH,
  GRID_ROW_HEIGHT,
  builtInTheme,
  clampNumber,
  emptyJobList,
  isCellEditorClipboardShortcut,
  isRecord,
  keyScopeFromTarget,
  tauriRuntimeError,
} from "./app-workbench-utils";

// Rendered when no connection is configured yet (fresh install, no samples).
// Keeps `activeConnection` defined so the shell never crashes on an empty
// workspace; querying stays disabled until the user adds a real connection.
const NO_ACTIVE_CONNECTION: WorkspaceConnection = {
  id: "",
  name: "No connection",
  engine: "",
  status: "idle",
  latencyMs: 0,
  proxy: "direct",
  objects: [],
};

function scaledUiPixels(value: number, zoom: number) {
  return Math.max(1, Math.round(value * zoom));
}

function scaledUiFont(value: number, zoom: number) {
  return `${Math.round(value * zoom * 100) / 100}px`;
}

function uiZoomStyleVariables(zoom: number): Record<string, string> {
  const normalized = normalizeUiZoom(zoom);
  return {
    "--ui-zoom": normalized.toFixed(2),
    "--font-ui-xs": scaledUiFont(11, normalized),
    "--font-ui-sm": scaledUiFont(12, normalized),
    "--font-ui-md": scaledUiFont(13, normalized),
    "--font-ui-lg": scaledUiFont(14, normalized),
    "--font-code": scaledUiFont(13, normalized),
    "--editor-line-height": `${scaledUiPixels(20, normalized)}px`,
    "--control-xxs": `${scaledUiPixels(22, normalized)}px`,
    "--control-xs": `${scaledUiPixels(24, normalized)}px`,
    "--control-sm": `${scaledUiPixels(25, normalized)}px`,
    "--control-md": `${scaledUiPixels(27, normalized)}px`,
    "--bar-sm": `${scaledUiPixels(31, normalized)}px`,
    "--bar-md": `${scaledUiPixels(33, normalized)}px`,
    "--status-height": `${scaledUiPixels(22, normalized)}px`,
  };
}

function formatUiZoom(zoom: number) {
  return `${Math.round(normalizeUiZoom(zoom) * 100)}%`;
}

function sqlDownloadFileName(label: string) {
  const base = label
    .replace(/\.sql$/i, "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "query"}.sql`;
}

const MigrationStudioDialog = lazy(() =>
  import("@/features/migration").then((module) => ({
    default: module.MigrationStudioDialog,
  })),
);
const QueryHistoryDialog = lazy(() =>
  import("@/features/query-history/QueryHistoryDialog").then((module) => ({
    default: module.QueryHistoryDialog,
  })),
);

export function AppWorkbench() {
  useEffect(() => {
    const preventNativeContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    const options = { capture: true } as AddEventListenerOptions;
    window.addEventListener("contextmenu", preventNativeContextMenu, options);
    document.addEventListener("contextmenu", preventNativeContextMenu, options);
    return () => {
      window.removeEventListener(
        "contextmenu",
        preventNativeContextMenu,
        options,
      );
      document.removeEventListener(
        "contextmenu",
        preventNativeContextMenu,
        options,
      );
    };
  }, []);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const schemaSpecFileRef = useRef<HTMLInputElement | null>(null);
  const diagramSvgRef = useRef<SVGSVGElement | null>(null);
  const diagramCanvasRef = useRef<HTMLDivElement | null>(null);
  const pendingDiagramSearchRef = useRef<string | null>(null);
  const editorApiRef = useRef<SqlEditorHandle>(null);
  const secondaryEditorApiRef = useRef<SqlEditorHandle>(null);
  const editorSplitRef = useRef<HTMLDivElement | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(fallbackSnapshot);
  const {
    notices: actionNotices,
    showActionNotice,
    dismissNotice,
  } = useActionNotices();
  // Workbench-level confirmation dialog, shared by controllers that gate
  // destructive actions (delete commits, discard-and-reload).
  const { confirm: confirmAction, confirmElement: workbenchConfirmElement } =
    useConfirm();
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const setActiveConnectionId = useConnectionStore(
    (state) => state.setActiveConnectionId,
  );
  const locale = usePreferencesStore((state) => state.locale);
  const setLocale = usePreferencesStore((state) => state.setLocale);
  const { t } = useMemo(() => createTranslator(locale), [locale]);
  const themePreference = usePreferencesStore((state) => state.themePreference);
  const setThemePreference = usePreferencesStore(
    (state) => state.setThemePreference,
  );
  const themeKind = usePreferencesStore((state) => state.themeKind);
  const setThemeKind = usePreferencesStore((state) => state.setThemeKind);
  const activeDefaultThemeId = usePreferencesStore(
    (state) => state.activeDefaultThemeId,
  );
  const setActiveDefaultThemeId = usePreferencesStore(
    (state) => state.setActiveDefaultThemeId,
  );
  const activeCustomThemeId = usePreferencesStore(
    (state) => state.activeCustomThemeId,
  );
  const setActiveCustomThemeId = usePreferencesStore(
    (state) => state.setActiveCustomThemeId,
  );
  const customThemes = usePreferencesStore((state) => state.customThemes);
  const setCustomThemes = usePreferencesStore((state) => state.setCustomThemes);
  const activeCustomTheme = useMemo(
    () =>
      customThemes.find((entry) => entry.id === activeCustomThemeId) ?? null,
    [activeCustomThemeId, customThemes],
  );
  const activeDefaultTheme = useMemo(
    () => defaultThemeEntryForKind(themeKind, activeDefaultThemeId),
    [activeDefaultThemeId, themeKind],
  );
  const theme =
    activeCustomTheme?.theme ?? builtInTheme(themeKind, activeDefaultThemeId);
  const vimMode = usePreferencesStore((state) => state.vimMode);
  const setStoredVimMode = usePreferencesStore((state) => state.setVimMode);
  const formatter = usePreferencesStore((state) => state.formatter);
  const setFormatter = usePreferencesStore((state) => state.setFormatter);
  const sqlLinter = usePreferencesStore((state) => state.sqlLinter);
  const setSqlLinter = usePreferencesStore((state) => state.setSqlLinter);
  const sqlSnippets = usePreferencesStore((state) => state.sqlSnippets);
  const setSqlSnippets = usePreferencesStore((state) => state.setSqlSnippets);
  const editorBackgroundImage = usePreferencesStore(
    (state) => state.editorBackgroundImage,
  );
  const setEditorBackgroundImage = usePreferencesStore(
    (state) => state.setEditorBackgroundImage,
  );
  const editorBackgroundOpacity = usePreferencesStore(
    (state) => state.editorBackgroundOpacity,
  );
  const setEditorBackgroundOpacity = usePreferencesStore(
    (state) => state.setEditorBackgroundOpacity,
  );
  const animationsEnabled = usePreferencesStore(
    (state) => state.animationsEnabled,
  );
  const setAnimationsEnabled = usePreferencesStore(
    (state) => state.setAnimationsEnabled,
  );
  const autoCommit = usePreferencesStore((state) => state.autoCommit);
  const setAutoCommit = usePreferencesStore((state) => state.setAutoCommit);
  const uiZoom = usePreferencesStore((state) => state.uiZoom);
  const setUiZoom = usePreferencesStore((state) => state.setUiZoom);
  const sidebarOpen = useWorkbenchStore((state) => state.sidebarOpen);
  const setSidebarOpen = useWorkbenchStore((state) => state.setSidebarOpen);
  const rightSidebarOpen = useWorkbenchStore((state) => state.rightSidebarOpen);
  const setRightSidebarOpen = useWorkbenchStore(
    (state) => state.setRightSidebarOpen,
  );
  const viewPlacements = useWorkbenchStore((state) => state.viewPlacements);
  const setViewPlacements = useWorkbenchStore(
    (state) => state.setViewPlacements,
  );
  const setViewOpen = useWorkbenchStore((state) => state.setViewOpen);
  const viewVisibility = useWorkbenchStore((state) => state.viewVisibility);
  const setViewVisibility = useWorkbenchStore(
    (state) => state.setViewVisibility,
  );
  const leftSidebarViews = workbenchViewsForSide(viewPlacements, "left");
  const rightSidebarViews = workbenchViewsForSide(viewPlacements, "right");
  const activeLeftSidebarView = activeWorkbenchViewForSide(
    viewVisibility,
    viewPlacements,
    "left",
  );
  const activeRightSidebarView = activeWorkbenchViewForSide(
    viewVisibility,
    viewPlacements,
    "right",
  );
  const sidebarWidth = useWorkbenchStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkbenchStore((state) => state.setSidebarWidth);
  const inspectorWidth = useWorkbenchStore((state) => state.inspectorWidth);
  const setInspectorWidth = useWorkbenchStore(
    (state) => state.setInspectorWidth,
  );
  const resultsHeight = useWorkbenchStore((state) => state.resultsHeight);
  const setResultsHeight = useWorkbenchStore((state) => state.setResultsHeight);
  const editorSplitMode = useWorkbenchStore((state) => state.editorSplitMode);
  const editorSplitPercent = useWorkbenchStore(
    (state) => state.editorSplitPercent,
  );
  const setEditorSplitPercent = useWorkbenchStore(
    (state) => state.setEditorSplitPercent,
  );
  const {
    activeEditorGroup,
    activeTabLabel,
    closeActiveSqlTab,
    closeOtherSqlTabs,
    closeSqlTab,
    duplicateSqlTab,
    editorGroupStates,
    editorSelections,
    editorTabMenu,
    newSqlTab,
    primaryQuery,
    query,
    renameSqlTab,
    reopenSqlTab,
    replaceSearchTab,
    revealSearchMatch,
    searchTabs,
    secondaryQuery,
    selectEditorTab,
    setActiveEditorGroup,
    setEditorGroupQuery,
    setEditorGroupSelection,
    setEditorTabMenu,
    setQuery,
  } = useEditorGroups({
    loadInitialQuery: loadSavedQuery,
    editorSplitMode,
    editorApiRef,
    secondaryEditorApiRef,
    showActionNotice,
    t,
  });
  const { beginPanelResize, onPanelResizeKey } = createPanelResizeController({
    sidebarWidth,
    inspectorWidth,
    resultsHeight,
    editorSplitMode,
    editorSplitRef,
    setSidebarWidth,
    setInspectorWidth,
    setResultsHeight,
    setEditorSplitPercent,
  });
  function setActiveSidebarView(viewId: WorkbenchViewId) {
    const side = viewPlacements[viewId] ?? "left";
    if (side === "right") {
      setRightSidebarOpen(true);
    } else {
      setSidebarOpen(true);
    }
    // The chat panel needs more room than a tree view; open it comfortably wide
    // (without shrinking a side the user already widened).
    if (viewId === "aiChat") {
      const comfortable = 420;
      if (side === "right") {
        setInspectorWidth((current) => Math.max(current, comfortable));
      } else {
        setSidebarWidth((current) => Math.max(current, comfortable));
      }
    }
    setViewVisibility((current) => {
      const next = { ...current };
      workbenchViewIds.forEach((id) => {
        if (viewPlacements[id] === side) {
          next[id] = id === viewId;
        }
      });
      return next;
    });
  }

  function closeSidebarView(viewId: WorkbenchViewId) {
    const side = viewPlacements[viewId] ?? "left";
    setViewOpen(viewId, false);
    if (side === "right") {
      setRightSidebarOpen(false);
      return;
    }
    setActiveSidebarView("objectBrowser");
  }

  function toggleSidebarView(
    viewId: Exclude<WorkbenchViewId, "objectBrowser">,
  ) {
    const side = viewPlacements[viewId] ?? "left";
    const sideOpen = side === "right" ? rightSidebarOpen : sidebarOpen;
    if (sideOpen && viewVisibility[viewId]) {
      closeSidebarView(viewId);
      return;
    }
    setActiveSidebarView(viewId);
  }

  function toggleRightSidebar() {
    if (rightSidebarOpen) {
      setRightSidebarOpen(false);
      return;
    }
    setActiveSidebarView(activeRightSidebarView);
  }

  function openGitPanel() {
    setActiveSidebarView("git");
    void useGitStore.getState().refresh();
  }

  const profiles = useConnectionStore((state) => state.profiles);
  const setProfiles = useConnectionStore((state) => state.setProfiles);
  const selectedProfileId = useConnectionStore(
    (state) => state.selectedProfileId,
  );
  const setSelectedProfileId = useConnectionStore(
    (state) => state.setSelectedProfileId,
  );
  const draft = useConnectionStore((state) => state.draft);
  const setDraft = useConnectionStore((state) => state.setDraft);
  const connectionManagerOpen = useConnectionStore(
    (state) => state.connectionManagerOpen,
  );
  const setConnectionManagerOpen = useConnectionStore(
    (state) => state.setConnectionManagerOpen,
  );
  const connectionSearch = useConnectionStore(
    (state) => state.connectionSearch,
  );
  const setConnectionSearch = useConnectionStore(
    (state) => state.setConnectionSearch,
  );
  const connectedIds = useConnectionStore((state) => state.connectedIds);
  const setConnectedIds = useConnectionStore((state) => state.setConnectedIds);
  const liveConnections = useConnectionStore((state) => state.liveConnections);
  const setLiveConnections = useConnectionStore(
    (state) => state.setLiveConnections,
  );
  const connecting = useConnectionStore((state) => state.connecting);
  const setConnecting = useConnectionStore((state) => state.setConnecting);
  const testingConnection = useConnectionStore(
    (state) => state.testingConnection,
  );
  const setTestingConnection = useConnectionStore(
    (state) => state.setTestingConnection,
  );
  const connectionError = useConnectionStore((state) => state.connectionError);
  const setConnectionError = useConnectionStore(
    (state) => state.setConnectionError,
  );
  const metadataByConnection = useConnectionStore(
    (state) => state.metadataByConnection,
  );
  const setMetadataByConnection = useConnectionStore(
    (state) => state.setMetadataByConnection,
  );
  const metadataLoading = useConnectionStore((state) => state.metadataLoading);
  const setMetadataLoading = useConnectionStore(
    (state) => state.setMetadataLoading,
  );
  const metadataErrors = useConnectionStore((state) => state.metadataErrors);
  const setMetadataErrors = useConnectionStore(
    (state) => state.setMetadataErrors,
  );
  const objectActionMenu = useConnectionStore(
    (state) => state.objectActionMenu,
  );
  const setObjectActionMenu = useConnectionStore(
    (state) => state.setObjectActionMenu,
  );
  const [result, setResult] = useState<QueryResult | null>(null);
  // EXEC-010: when a run spills past the in-memory budget, the grid pages rows from
  // disk through this handle instead of holding them all in JS. `spillInfo` drives
  // the windowed grid path; `spillRef` holds the live LRU page source; the version
  // counter forces the grid view model to recompute as pages arrive.
  const resultOffloadEnabled = useResultsStore(
    (state) => state.resultOffloadEnabled,
  );
  const setResultOffloadEnabled = useResultsStore(
    (state) => state.setResultOffloadEnabled,
  );
  const resultMemoryBudget = useResultsStore(
    (state) => state.resultMemoryBudget,
  );
  const setResultMemoryBudget = useResultsStore(
    (state) => state.setResultMemoryBudget,
  );
  const spillInfo = useResultGridStore((state) => state.spillInfo);
  const setSpillInfo = useResultGridStore((state) => state.setSpillInfo);
  const gridWindowVersion = useResultGridStore(
    (state) => state.gridWindowVersion,
  );
  const setGridWindowVersion = useResultGridStore(
    (state) => state.setGridWindowVersion,
  );
  const bumpGridWindowVersion = useResultGridStore(
    (state) => state.bumpGridWindowVersion,
  );
  const spillRef = useRef<{ handle: string; source: WindowedRows } | null>(
    null,
  );
  const beginPendingPage = useResultGridStore(
    (state) => state.beginPendingPage,
  );
  const endPendingPage = useResultGridStore((state) => state.endPendingPage);
  const clearPendingPages = useResultGridStore(
    (state) => state.clearPendingPages,
  );
  const activeResultIndex = useResultGridStore(
    (state) => state.activeResultIndex,
  );
  const setActiveResultIndex = useResultGridStore(
    (state) => state.setActiveResultIndex,
  );
  const resultMode = useResultGridStore((state) => state.resultMode);
  const setResultMode = useResultGridStore((state) => state.setResultMode);
  const tableViewObject = useResultGridStore((state) => state.tableViewObject);
  const setTableViewObject = useResultGridStore(
    (state) => state.setTableViewObject,
  );
  const [queryError, setQueryError] = useState<string | null>(null);
  const [planAnalysis, setPlanAnalysis] = useState<QueryPlanAnalysis | null>(
    null,
  );
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  // SQL of the last run, used to infer the editable target table.
  const [lastRunSql, setLastRunSql] = useState<string>("");
  // Staged (non-immediate) result editing: changes accumulate until Commit.
  const editMode = useResultGridStore((state) => state.editMode);
  const setEditMode = useResultGridStore((state) => state.setEditMode);
  const cellEdits = useResultGridStore((state) => state.cellEdits);
  const newRows = useResultGridStore((state) => state.newRows);
  const deletedRows = useResultGridStore((state) => state.deletedRows);
  const editUndoDepth = useResultGridStore(
    (state) => state.editUndoStack.length,
  );
  const updateEditDraft = useResultGridStore((state) => state.updateEditDraft);
  const undoEdit = useResultGridStore((state) => state.undoEdit);
  const editingCell = useResultGridStore((state) => state.editingCell);
  const setEditingCell = useResultGridStore((state) => state.setEditingCell);
  const selectedCell = useResultGridStore((state) => state.selectedCell);
  const setSelectedCell = useResultGridStore((state) => state.setSelectedCell);
  const selectedRange = useResultGridStore((state) => state.selectedRange);
  const setSelectedRange = useResultGridStore(
    (state) => state.setSelectedRange,
  );
  const selectedRowKey = useResultGridStore((state) => state.selectedRowKey);
  const setSelectedRowKey = useResultGridStore(
    (state) => state.setSelectedRowKey,
  );
  const committing = useResultGridStore((state) => state.committing);
  const setCommitting = useResultGridStore((state) => state.setCommitting);
  const commitError = useResultGridStore((state) => state.commitError);
  const setCommitError = useResultGridStore((state) => state.setCommitError);
  const resetGridStoreEdits = useResultGridStore((state) => state.resetEdits);
  const resetGridStoreView = useResultGridStore((state) => state.resetGridView);
  const gridRowHeight = scaledUiPixels(GRID_ROW_HEIGHT, uiZoom);
  const gridColumnWidth = scaledUiPixels(GRID_COLUMN_WIDTH, uiZoom);
  const gridGutterColumnWidth = scaledUiPixels(GRID_GUTTER_WIDTH, uiZoom);
  const gridGutterWidth = editMode ? gridGutterColumnWidth : 0;
  const {
    gridScrollTop,
    gridScrollLeft,
    gridViewportHeight,
    gridViewportWidth,
    setGridScrollTop,
    setGridScrollLeft,
    onGridScroll,
    resetGridScrollPosition,
    scrollGridCellIntoView,
  } = useResultGridScroll({
    gridRef,
    result,
    gridRowHeight,
    gridGutterWidth,
    gridColumnWidth,
    setSelectedRowKey,
    setSelectedCell,
    setSelectedRange,
  });
  const {
    sortRules,
    filtersOpen,
    setFiltersOpen,
    quickFilter,
    filterJoin,
    setFilterJoin,
    filterRules,
    updateQuickFilter,
    clearQuickFilter,
    toggleSort,
    addFilterRule,
    updateFilterRule,
    removeFilterRule,
    clearResultFilters,
  } = useResultGridFiltering({ resetGridScrollPosition });
  // Remappable keybindings: defaults merged with user overrides (localStorage).
  const [keymapOverrides, setKeymapOverrides] = useState<Keymap>(loadOverrides);
  const keymap = {
    ...resultCopyDefaultKeymap,
    ...effectiveKeymap(keymapOverrides),
  };
  const [activeKeyScope, setActiveKeyScope] =
    useState<KeybindingScope>("global");
  const [recordingCommand, setRecordingCommand] = useState<string | null>(null);
  const [recordingSequence, setRecordingSequence] = useState<string[]>([]);
  // Command palette (Ctrl/Cmd+Shift+P).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [migrationStudioOpen, setMigrationStudioOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [settingsJsonDraft, setSettingsJsonDraft] = useState("");
  const [settingsJsonError, setSettingsJsonError] = useState<string | null>(
    null,
  );
  const [jobs, setJobs] = useState<JobList>(emptyJobList);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  // ER diagram modal (rendered from metadata through our SVG layout).
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [diagramError, setDiagramError] = useState<string | null>(null);
  const [diagramSearch, setDiagramSearch] = useState("");
  const [diagramSchemaNames, setDiagramSchemaNames] = useState<string[]>([]);
  const [diagramZoom, setDiagramZoom] = useState(1);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const transientOverlayStateRef = useRef({
    workspaceMenuOpen: false,
    runMenuOpen: false,
    exportMenuOpen: false,
    filtersOpen: false,
    objectActionMenu: null as string | null,
  });
  transientOverlayStateRef.current = {
    workspaceMenuOpen,
    runMenuOpen,
    exportMenuOpen,
    filtersOpen,
    objectActionMenu,
  };
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const schemaDesignerOpen = useSchemaDesignerStore((state) => state.open);
  const setSchemaDesignerOpen = useSchemaDesignerStore(
    (state) => state.setOpen,
  );
  const schemaDraft = useSchemaDesignerStore((state) => state.draft);
  const setSchemaDraft = useSchemaDesignerStore((state) => state.setDraft);
  const openBlankSchemaDesigner = useSchemaDesignerStore(
    (state) => state.openBlank,
  );
  const openObjectSchemaDesigner = useSchemaDesignerStore(
    (state) => state.openForObject,
  );
  const schemaDiagramOpen = useSchemaDiagramStore((state) => state.open);
  const openBlankSchemaDiagram = useSchemaDiagramStore(
    (state) => state.openBlank,
  );
  const openSchemaDiagramFromDocument = useSchemaDiagramStore(
    (state) => state.openFromDocument,
  );
  const setSchemaDiagramDocument = useSchemaDiagramStore(
    (state) => state.setDocument,
  );
  const closeSchemaDiagram = useSchemaDiagramStore((state) => state.close);
  const diagramInitializedFor = useRef<string | null>(null);
  const appendHistory = useQueryHistoryStore((state) => state.append);
  const queryHistoryMaxItems = useQueryHistoryStore((state) => state.maxItems);
  const setQueryHistoryMaxItems = useQueryHistoryStore(
    (state) => state.setMaxItems,
  );
  const queryHistoryResultRows = useQueryHistoryStore(
    (state) => state.resultRowLimit,
  );
  const setQueryHistoryResultRows = useQueryHistoryStore(
    (state) => state.setResultRowLimit,
  );
  const openQueryHistoryDialog = useQueryHistoryStore(
    (state) => state.openDialog,
  );
  const closeQueryHistoryDialog = useQueryHistoryStore(
    (state) => state.closeDialog,
  );
  const queryHistoryDialogOpen = useQueryHistoryStore((state) => state.open);
  useEffect(() => {
    workbenchRuntimeService
      .snapshot()
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setActiveConnectionId(nextSnapshot.activeConnectionId);
      })
      .catch(() => {
        setSnapshot(fallbackSnapshot);
      });
  }, []);

  useEffect(() => {
    if (settingsOpen && settingsTab === "jobs") {
      void refreshJobs();
    }
  }, [settingsOpen, settingsTab]);

  const connections = useMemo(() => {
    const byId = new Map<string, WorkspaceConnection>();
    snapshot.connections.forEach((connection) => {
      byId.set(connection.id, connection);
    });
    Object.values(liveConnections).forEach((connection) => {
      byId.set(connection.id, connection);
    });
    return Array.from(byId.values()).map((connection) => ({
      ...connection,
      status: connectedIds.has(connection.id) ? "connected" : connection.status,
    }));
  }, [connectedIds, liveConnections, snapshot.connections]);
  const connectionById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  );
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );
  const filteredProfiles = useMemo(() => {
    const needle = connectionSearch.trim().toLowerCase();
    if (!needle) {
      return profiles;
    }
    return profiles.filter((profile) =>
      `${profile.name} ${profile.id} ${engineLabel(profile.engine)} ${profile.host} ${profile.database} ${profile.url}`
        .toLowerCase()
        .includes(needle),
    );
  }, [connectionSearch, profiles]);

  const activeConnection = useMemo(
    () =>
      connections.find((item) => item.id === activeConnectionId) ??
      connections[0] ??
      NO_ACTIVE_CONNECTION,
    [activeConnectionId, connections],
  );
  const activeProfile = profiles.find(
    (profile) => profile.id === activeConnectionId,
  );
  const activeEngine = activeProfile?.engine ?? draft.engine;
  const editorSplitOpen = editorSplitMode !== "single";
  const activeConnectionOpen = connectedIds.has(activeConnectionId);
  const activeConnectionReadOnly = activeProfile?.readOnly ?? false;
  const activeConnectionColor =
    activeProfile?.color ||
    profileById.get(activeConnectionId)?.color ||
    defaultConnectionColor;
  const activeConnectionStatus = activeConnectionOpen
    ? `${activeConnectionReadOnly ? "Read-only · " : ""}Connected · ${activeConnection.latencyMs} ms`
    : "Disconnected";
  const activeTransportLabel =
    activeConnection.proxy === "direct"
      ? "Direct connection"
      : activeConnection.proxy || "Transport not configured";

  const activeMetadata = metadataByConnection[activeConnectionId];
  const activeMetadataLoading = metadataLoading.has(activeConnectionId);
  const activeMetadataError = metadataErrors[activeConnectionId];
  const completionHints = useMemo(
    () => completionHintsFromMetadata(activeMetadata),
    [activeMetadata],
  );

  function activeEditorApi() {
    if (editorSplitOpen && activeEditorGroup === "secondary") {
      return secondaryEditorApiRef.current ?? editorApiRef.current;
    }
    return editorApiRef.current;
  }

  function activeEditorSelections() {
    return activeEditorApi()?.getSelections() ?? [...editorSelections];
  }

  function activeMainEditorSelection(): EditorSelection {
    return (
      activeEditorApi()?.getSelection() ??
      editorSelections[0] ?? { from: 0, to: 0 }
    );
  }

  function selectedSqlFromSelections(
    sql: string,
    selections: readonly EditorSelection[],
  ) {
    return selections
      .filter((selection) => selection.from !== selection.to)
      .map((selection) =>
        sql
          .slice(
            Math.min(selection.from, selection.to),
            Math.max(selection.from, selection.to),
          )
          .trim(),
      )
      .filter(Boolean)
      .join("\n\n");
  }

  const availableDiagramSchemas = useMemo(
    () =>
      activeMetadata?.schemas
        .filter((schema) =>
          schema.objects.some((object) => object.kind === "table"),
        )
        .map((schema) => schema.name) ?? [],
    [activeMetadata],
  );
  const diagramModel = useMemo(
    () =>
      activeMetadata
        ? buildErdModel(activeMetadata, {
            schemaNames: diagramSchemaNames,
            search: diagramSearch,
          })
        : null,
    [activeMetadata, diagramSchemaNames, diagramSearch],
  );
  const diagramLayout = useMemo<ErdLayout | null>(
    () => (diagramModel ? layoutErdModel(diagramModel) : null),
    [diagramModel],
  );
  const diagramSvgStyle = useMemo(() => erdSvgStyle(theme), [theme]);
  const diagramMermaid = useMemo(
    () => (activeMetadata ? toMermaidErd(activeMetadata) : ""),
    [activeMetadata],
  );

  const {
    updateDraft,
    selectProfile,
    selectSidebarConnection,
    saveDraft,
    addProfile,
    importConnectionFile,
    exportConnectionFile,
    deleteProfile,
    testActiveProfile,
    connectActiveProfile,
    openSqliteSample,
    disconnectActiveProfile,
    refreshObjects,
  } = useConnectionActions({
    draft,
    profiles,
    connectedIds,
    activeConnectionId,
    setDraft,
    setConnectionError,
    setSelectedProfileId,
    setActiveConnectionId,
    setProfiles,
    setConnectionSearch,
    setConnectedIds,
    setLiveConnections,
    setMetadataByConnection,
    setMetadataErrors,
    setMetadataLoading,
    setTestingConnection,
    setConnecting,
    setConnectionManagerOpen,
    showActionNotice,
    t,
  });

  useEffect(() => {
    if (
      activeConnectionOpen &&
      !activeMetadata &&
      !activeMetadataLoading &&
      !activeMetadataError
    ) {
      void refreshObjects(activeConnectionId);
    }
  }, [
    activeConnectionId,
    activeConnectionOpen,
    activeMetadata,
    activeMetadataError,
    activeMetadataLoading,
  ]);

  // Dialect for the editor: prefer the active connection's profile engine,
  // then the connection-form draft, then Postgres.
  const editorEngine = useMemo<DbEngine>(() => {
    const profile = profiles.find((item) => item.id === activeConnectionId);
    return profile?.engine ?? draft.engine ?? "postgres";
  }, [profiles, activeConnectionId, draft.engine]);

  const selectedEditorSql = selectedSqlFromSelections(query, editorSelections);
  const hasSelectedEditorSql = selectedEditorSql.length > 0;
  const runPrimaryLabel = hasSelectedEditorSql
    ? "Run Selection"
    : "Run Current";
  const runShortcutLabel = formatKeySequence(keymap["query.run"] ?? "");
  const runCurrentShortcutLabel = formatKeySequence(
    keymap["query.runCurrent"] ?? "",
  );
  const runFromStartShortcutLabel = formatKeySequence(
    keymap["query.runFromStart"] ?? "",
  );
  const runAllShortcutLabel = formatKeySequence(keymap["query.runAll"] ?? "");
  const shortcutTip = (label: string, commandId: string) => ({
    label,
    shortcut: formatKeySequence(keymap[commandId] ?? "") || null,
  });
  const resultShortcutTips = [
    shortcutTip("New Tab", "tab.new"),
    shortcutTip("Show Commands", "palette.open"),
    shortcutTip("Export CSV", "result.export"),
    shortcutTip("Copy TSV", "result.copyVisible"),
    shortcutTip("Toggle Edit Data", "edit.toggle"),
    shortcutTip("Add Row", "edit.addRow"),
    shortcutTip("Undo Edit", "edit.undo"),
    shortcutTip("Commit Edits", "edit.commit"),
  ];

  const biOpen =
    viewVisibility.bi &&
    (viewPlacements.bi === "right" ? rightSidebarOpen : sidebarOpen);
  const {
    activeFilters,
    activeResult,
    activeResultIndexView,
    chartAvailable,
    chartResultModel,
    copyCellsForRow,
    displayedResultSummary,
    effectiveResultMode,
    filteredOutCount,
    filtersActive,
    firstVisible,
    graphAvailable,
    graphResultModel,
    gridRowStyle,
    gridTotalWidth,
    lastVisible,
    leftColumnPad,
    pendingCount,
    resultColumns,
    resultGridView,
    resultSets,
    rightColumnPad,
    rowDetailTable,
    selectedRowValues,
    showingStructure,
    sortRuleByColumn,
    structureObject,
    totalRows,
    topPad,
    bottomPad,
    unfilteredRowCount,
    visibleColumnIndexes,
    visibleRows,
    visibleRowsRevision,
    webGlAvailable,
  } = useResultGridModel({
    result,
    activeResultIndex,
    resultMode,
    tableViewObject,
    query,
    editorEngine,
    activeMetadata,
    biOpen,
    spillInfo,
    gridWindowVersion,
    editMode,
    cellEdits,
    newRows,
    deletedRows,
    filterRules,
    quickFilter,
    filterJoin,
    sortRules,
    selectedRowKey,
    gridGutterWidth,
    gridGutterColumnWidth,
    gridColumnWidth,
    gridScrollLeft,
    gridViewportWidth,
    gridScrollTop,
    gridViewportHeight,
    gridRowHeight,
  });

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.scrollTop = 0;
      gridRef.current.scrollLeft = 0;
    }
    setGridScrollTop(0);
    setGridScrollLeft(0);
    setSelectedRowKey(null);
    setSelectedCell(null);
    setSelectedRange(null);
  }, [activeResultIndexView, result]);

  const {
    selectedRangeBounds,
    selectionSummary,
    selectGridCell,
    selectGridRow,
    moveSelectedCell,
    selectedDisplayRow,
    selectedRowForCopy,
    selectedGridCopyText,
  } = useResultGridSelection({
    resultGridView,
    resultColumns,
    gridRef,
    totalRows,
    selectedCell,
    selectedRange,
    selectedRowKey,
    setSelectedCell,
    setSelectedRange,
    setSelectedRowKey,
    scrollGridCellIntoView,
    copyCellsForRow,
  });
  const selectionStatus = selectionSummary
    ? formatResultSelectionStatus(selectionSummary)
    : null;
  const {
    selectResultSet,
    resetEdits,
    resetGridView,
    releaseActiveSpill,
    beginCellEdit,
    setCellValue,
    addNewRow,
    enableEditMode,
    discardEdits,
    deleteRow,
    pasteTableAt,
    undoLastEdit,
    copySelectedGridCellOrRow,
    copySelectedGridRow,
    copyVisibleResult,
    onGridKeyDown,
    onGridPaste,
    onGridCopy,
    inferEditTarget,
    canEditActiveResult,
    generateSelectedRowChangeSql,
    commitEdits,
  } = useResultGridEditing({
    result,
    activeResult,
    resultColumns,
    resultGridView,
    totalRows,
    showingStructure,
    selectedRowValues,
    activeConnectionId,
    activeConnectionReadOnly,
    activeEngine,
    lastRunSql,
    metadataByConnection,
    editMode,
    editUndoDepth,
    cellEdits,
    newRows,
    deletedRows,
    editingCell,
    selectedCell,
    setActiveResultIndex,
    setEditMode,
    setEditingCell,
    setSelectedRowKey,
    setSelectedRange,
    setCommitting,
    setCommitError,
    setSpillInfo,
    setGridWindowVersion,
    updateEditDraft,
    undoEdit,
    resetGridStoreEdits,
    resetGridStoreView,
    clearPendingPages,
    setQueryError,
    spillRef,
    resetGridScrollPosition,
    selectGridCell,
    moveSelectedCell,
    selectedDisplayRow,
    selectedRowForCopy,
    selectedGridCopyText,
    copyCellsForRow,
    activeEditorApi,
    runQuery,
    showActionNotice,
    confirm: confirmAction,
    t,
  });

  const {
    running,
    pendingQueryParameters,
    parameterDraftValues,
    setParameterDraftValues,
    setPendingQueryParameters,
    runEditorSql: runEditorSqlWithRunner,
    runSqlWithParameterPrompt,
    openQueryParameterPrompt,
    executeQuery,
    submitQueryParameters,
    cancelQuery,
    explainSql,
  } = useQueryRunner({
    activeConnectionId,
    activeConnectionOpen,
    activeConnectionReadOnly,
    activeConnectionName: activeConnection.name,
    activeConnectionEngine: activeEngine,
    activeEngine,
    resultOffloadEnabled,
    resultMemoryBudget,
    queryHistoryResultRows,
    appendHistory,
    setResult,
    setQueryError,
    setLastRunSql,
    setPlanAnalysis,
    setPlanLoading,
    setPlanError,
    setResultMode,
    setTableViewObject,
    setActiveResultIndex,
    resetEdits,
    resetGridView,
    releaseActiveSpill,
    gridRef,
    setGridScrollTop,
    setGridScrollLeft,
    setSelectedRowKey,
    setSelectedCell,
    setSelectedRange,
    spillRef,
    clearPendingPages,
    setSpillInfo,
    bumpGridWindowVersion,
    refreshObjects,
    openPlanPanel: () => setActiveSidebarView("plan"),
    showActionNotice,
    t,
  });

  usePendingResultChangesGuard({
    pendingCount,
    resetEdits,
    showActionNotice,
    confirm: confirmAction,
    t,
  });
  useResultGridSpillPaging({
    spillInfo,
    spillRef,
    firstVisible,
    lastVisible,
    gridWindowVersion,
    beginPendingPage,
    endPendingPage,
    clearPendingPages,
    bumpGridWindowVersion,
  });

  function updateUiZoom(nextZoom: number) {
    const normalized = normalizeUiZoom(nextZoom);
    setUiZoom(normalized);
    showActionNotice(
      "info",
      t("settings.general.uiZoom.title"),
      formatUiZoom(normalized),
    );
  }

  const runCommand = createWorkbenchCommandHandler({
    editMode,
    openPalette: () => {
      setPaletteQuery("");
      setPaletteOpen(true);
    },
    openSettings: () => openSettingsSection("general"),
    openKeymap: () => openSettingsSection("keymap"),
    openHistory: openQueryHistoryDialog,
    openGit: openGitPanel,
    openHelp: () => setAboutOpen(true),
    openDeveloperTools: () => void openAppDeveloperTools(),
    openConnectionManager: () => setConnectionManagerOpen(true),
    openMigrationStudio: () => setMigrationStudioOpen(true),
    openDiagram: () => setDiagramOpen(true),
    toggleTheme: () =>
      activateBuiltInTheme((kind) => (kind === "dark" ? "light" : "dark")),
    toggleSidebar: () => setSidebarOpen((open) => !open),
    toggleCompletion: () => toggleSidebarView("completion"),
    toggleHistory: () => toggleSidebarView("queryHistory"),
    togglePlan: () => toggleSidebarView("plan"),
    toggleBi: () => toggleSidebarView("bi"),
    zoomIn: () => updateUiZoom(uiZoom + UI_ZOOM_STEP),
    zoomOut: () => updateUiZoom(uiZoom - UI_ZOOM_STEP),
    zoomReset: () => updateUiZoom(UI_ZOOM_DEFAULT),
    newSqlTab,
    closeActiveTab: closeActiveSqlTab,
    saveQuery: saveCurrentQuery,
    saveQueryAs: saveCurrentQueryAsFile,
    exitApp: exitApplication,
    runQuery,
    runCurrentQuery,
    runFromStartQuery,
    runAllQuery,
    explainPlan: () => explainCurrentQuery("plan"),
    explainAnalyze: () => explainCurrentQuery("analyze"),
    cancelQuery,
    focusEditor: () => activeEditorApi()?.focus(),
    formatQuery,
    quickDefinition: () => activeEditorApi()?.quickDefinition(),
    showEditorQuickFix,
    cleanupQuery,
    toggleEditorComment: () => activeEditorApi()?.toggleComment(),
    indentEditorSelection,
    outdentEditorSelection,
    transformEditorSelection,
    exportCsv: () => exportActiveResult("csv"),
    exportSqlInserts: () => exportActiveResult("sql"),
    copySqlInserts: copyActiveResultSqlInserts,
    copySelectedGridCellOrRow,
    copySelectedGridRow,
    copyVisibleResult,
    canEditActiveResult,
    setEditMode,
    setCommitError,
    addNewRow,
    undoLastEdit,
    commitEdits,
    generateSql: () => setAiGenerateOpen(true),
    toggleTerminal: () => setTerminalOpen((open) => !open),
    toggleAiChat: () => toggleSidebarView("aiChat"),
    toggleSearch: () => toggleSidebarView("searchReplace"),
    searchInAllTabs: () => {
      const selection = activeEditorApi()?.getSelection();
      const selected =
        selection && selection.to > selection.from
          ? query.slice(selection.from, selection.to)
          : "";
      useSearchStore.getState().openWith(selected);
      setActiveSidebarView("searchReplace");
    },
  });

  const keymapConflicts = findConflicts(keymap, appCommandCatalog);
  const vimKeymapConflicts = findVimKeybindingConflicts(
    keymap,
    appCommandCatalog,
  );
  const paletteResults = appCommandCatalog.filter((command) =>
    `${command.title} ${command.category}`
      .toLowerCase()
      .includes(paletteQuery.trim().toLowerCase()),
  );

  function activateBuiltInTheme(
    value: ThemeKind | ((kind: ThemeKind) => ThemeKind),
  ) {
    const nextThemeKind =
      typeof value === "function" ? value(themeKind) : value;
    setThemeKind(nextThemeKind);
    setActiveDefaultThemeId(
      defaultThemeEntryForKind(nextThemeKind, activeDefaultThemeId)?.id ?? null,
    );
    setActiveCustomThemeId(null);
  }

  function activateThemePreference(value: ThemePreference) {
    setThemePreference(value);
    setActiveCustomThemeId(null);
  }

  function activateDefaultTheme(themeId: string | null) {
    const entry = defaultThemeById(themeId);
    if (!entry) {
      setActiveDefaultThemeId(
        defaultThemeEntryForKind(themeKind, activeDefaultThemeId)?.id ?? null,
      );
      setActiveCustomThemeId(null);
      return;
    }
    setThemeKind(entry.kind);
    setActiveDefaultThemeId(entry.id);
    setActiveCustomThemeId(null);
  }

  function activateCustomTheme(themeId: string | null) {
    if (!themeId) {
      setActiveCustomThemeId(null);
      return;
    }
    const entry = customThemes.find(
      (customTheme) => customTheme.id === themeId,
    );
    if (!entry) {
      setActiveCustomThemeId(null);
      return;
    }
    setThemeKind(entry.theme.kind);
    setActiveCustomThemeId(entry.id);
  }

  function buildSettingsJson() {
    return JSON.stringify(
      {
        version: 1,
        locale,
        theme: activeCustomTheme?.theme ?? themePreference,
        defaultThemeId: activeDefaultTheme?.id ?? activeDefaultThemeId,
        activeCustomThemeId,
        customThemes,
        editor: {
          animationsEnabled,
          vimMode,
          autoCommit,
          formatter,
          linter: sqlLinter,
          snippets: sqlSnippets,
          backgroundImage: editorBackgroundImage,
          backgroundOpacity: editorBackgroundOpacity,
        },
        queryHistory: {
          maxItems: queryHistoryMaxItems,
          resultRows: queryHistoryResultRows,
        },
        results: {
          offloadEnabled: resultOffloadEnabled,
          memoryBudget: resultMemoryBudget,
        },
        layout: {
          uiZoom,
          sidebarOpen,
          rightSidebarOpen,
          viewPlacements,
          viewVisibility,
          sidebarWidth,
          inspectorWidth,
          resultsHeight,
        },
        activeConnectionId,
        keymapOverrides,
        connections: profiles.map(portableProfile),
      },
      null,
      2,
    );
  }

  function openSettingsSection(tab: SettingsTab) {
    setSettingsTab(tab);
    setSettingsOpen(true);
    if (tab === "json") {
      setSettingsJsonDraft(buildSettingsJson());
      setSettingsJsonError(null);
    }
  }

  function setVimMode(value: boolean) {
    setStoredVimMode(value);
    if (value) {
      openSettingsSection("keymap");
    }
  }

  async function refreshJobs() {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const next = await workbenchRuntimeService.jobsList();
      setJobs(next);
    } catch (error) {
      const message = errorMessage(error);
      setJobsError(message);
      setJobs(emptyJobList);
    } finally {
      setJobsLoading(false);
    }
  }

  function resetSettingsJsonDraft() {
    setSettingsJsonDraft(buildSettingsJson());
    setSettingsJsonError(null);
    showActionNotice(
      "info",
      t("notice.workbench.settingsJsonReset"),
      t("notice.workbench.settingsJsonResetDetail"),
    );
  }

  function applySettingsJson() {
    try {
      const parsed = JSON.parse(settingsJsonDraft) as unknown;
      if (!isRecord(parsed)) {
        throw new Error("settings JSON root must be an object");
      }
      if (typeof parsed.locale === "string") {
        const nextLocale = normalizeLocale(parsed.locale);
        setLocale(nextLocale);
        parsed.locale = nextLocale;
      }
      let themeNotice: string | null = null;
      let nextCustomThemes = customThemes;
      let nextActiveCustomThemeId: string | null | undefined;
      if (Array.isArray(parsed.customThemes)) {
        nextCustomThemes = [];
        for (const [index, value] of parsed.customThemes.entries()) {
          nextCustomThemes.push(
            customThemeEntryFromJson(value, index, nextCustomThemes),
          );
        }
        setCustomThemes(nextCustomThemes);
      }
      if (typeof parsed.theme === "string" && defaultThemeById(parsed.theme)) {
        const entry = defaultThemeById(parsed.theme);
        if (entry) {
          setThemeKind(entry.kind);
          setActiveDefaultThemeId(entry.id);
          setActiveCustomThemeId(null);
          parsed.theme = entry.kind;
          parsed.defaultThemeId = entry.id;
          nextActiveCustomThemeId = null;
          themeNotice = t("settings.theme.activeTheme.builtinNameDescription", {
            name: entry.name,
          });
        }
      } else if (
        parsed.theme === "system" ||
        parsed.theme === "dark" ||
        parsed.theme === "light"
      ) {
        activateThemePreference(parsed.theme);
        nextActiveCustomThemeId = null;
      } else if (isRecord(parsed.theme)) {
        const themeSource = parsed.theme;
        const importResult = importThemeJson(themeSource, themeKind);
        const nextTheme = importResult.theme;
        parsed.theme = nextTheme;
        themeNotice =
          importResult.source === "vscode"
            ? importResult.warnings.length > 0
              ? t("notice.workbench.vscodeThemeConvertedWarnings", {
                  name: nextTheme.name,
                  count: importResult.warnings.length,
                })
              : t("notice.workbench.vscodeThemeConverted", {
                  name: nextTheme.name,
                })
            : t("settings.theme.activeTheme.customDescription", {
                name: nextTheme.name,
              });
        const savedTheme = upsertCustomThemeEntry(nextCustomThemes, nextTheme);
        nextCustomThemes = savedTheme.entries;
        setCustomThemes(nextCustomThemes);
        setThemeKind(nextTheme.kind);
        setActiveCustomThemeId(savedTheme.id);
        nextActiveCustomThemeId = savedTheme.id;
        parsed.activeCustomThemeId = savedTheme.id;
        parsed.customThemes = nextCustomThemes;
      } else if (isRecord(parsed.vscodeTheme)) {
        const fallbackKind =
          parsed.theme === "light" || parsed.theme === "dark"
            ? parsed.theme
            : themeKind;
        const importResult = importThemeJson(parsed.vscodeTheme, fallbackKind);
        const savedTheme = upsertCustomThemeEntry(
          nextCustomThemes,
          importResult.theme,
        );
        nextCustomThemes = savedTheme.entries;
        setCustomThemes(nextCustomThemes);
        setThemeKind(importResult.theme.kind);
        setActiveCustomThemeId(savedTheme.id);
        parsed.theme = importResult.theme;
        parsed.activeCustomThemeId = savedTheme.id;
        parsed.customThemes = nextCustomThemes;
        delete parsed.vscodeTheme;
        nextActiveCustomThemeId = savedTheme.id;
        themeNotice =
          importResult.warnings.length > 0
            ? t("notice.workbench.vscodeThemeConvertedWarnings", {
                name: importResult.theme.name,
                count: importResult.warnings.length,
              })
            : t("notice.workbench.vscodeThemeConverted", {
                name: importResult.theme.name,
              });
      } else if (
        typeof parsed.activeCustomThemeId === "string" &&
        nextCustomThemes.some(
          (entry) => entry.id === parsed.activeCustomThemeId,
        )
      ) {
        const entry = nextCustomThemes.find(
          (themeEntry) => themeEntry.id === parsed.activeCustomThemeId,
        );
        if (entry) {
          setThemeKind(entry.theme.kind);
          setActiveCustomThemeId(entry.id);
          nextActiveCustomThemeId = entry.id;
          themeNotice = t("settings.theme.activeTheme.customDescription", {
            name: entry.name,
          });
        }
      }
      if (typeof parsed.defaultThemeId === "string") {
        const entry = defaultThemeById(parsed.defaultThemeId);
        if (entry) {
          setActiveDefaultThemeId(entry.id);
          parsed.defaultThemeId = entry.id;
          if (!themeNotice) {
            themeNotice = t(
              "settings.theme.activeTheme.builtinNameDescription",
              {
                name: entry.name,
              },
            );
          }
        }
      }
      if (
        nextActiveCustomThemeId === undefined &&
        Array.isArray(parsed.customThemes)
      ) {
        setActiveCustomThemeId(null);
      }
      if (isRecord(parsed.editor)) {
        if (typeof parsed.editor.animationsEnabled === "boolean") {
          setAnimationsEnabled(parsed.editor.animationsEnabled);
        }
        if (typeof parsed.editor.vimMode === "boolean") {
          setStoredVimMode(parsed.editor.vimMode);
        }
        if (typeof parsed.editor.autoCommit === "boolean") {
          setAutoCommit(parsed.editor.autoCommit);
        }
        if (
          typeof parsed.editor.formatter === "string" &&
          isSqlFormatterId(parsed.editor.formatter)
        ) {
          setFormatter(parsed.editor.formatter);
        }
        if (
          typeof parsed.editor.linter === "string" &&
          isSqlLinterId(parsed.editor.linter)
        ) {
          setSqlLinter(parsed.editor.linter);
        }
        if ("snippets" in parsed.editor) {
          const nextSnippets = sqlSnippetsFromJson(parsed.editor.snippets);
          setSqlSnippets(nextSnippets);
        }
        if (typeof parsed.editor.backgroundImage === "string") {
          setEditorBackgroundImage(parsed.editor.backgroundImage);
        }
        if ("backgroundOpacity" in parsed.editor) {
          const nextOpacity = Number(parsed.editor.backgroundOpacity);
          if (Number.isFinite(nextOpacity)) {
            setEditorBackgroundOpacity(nextOpacity);
            parsed.editor.backgroundOpacity =
              normalizeEditorBackgroundOpacity(nextOpacity);
          }
        }
      }
      if ("snippets" in parsed) {
        const nextSnippets = sqlSnippetsFromJson(parsed.snippets);
        setSqlSnippets(nextSnippets);
      }
      if (isRecord(parsed.queryHistory)) {
        const nextMaxItems = Number(parsed.queryHistory.maxItems);
        if (Number.isFinite(nextMaxItems)) {
          setQueryHistoryMaxItems(
            clampNumber(nextMaxItems, 0, queryHistoryMaxItemsHardLimit),
          );
        }
        const nextResultRows = Number(parsed.queryHistory.resultRows);
        if (Number.isFinite(nextResultRows)) {
          setQueryHistoryResultRows(
            clampNumber(nextResultRows, 0, queryHistoryResultRowsHardLimit),
          );
        }
      }
      if (isRecord(parsed.results)) {
        if (typeof parsed.results.offloadEnabled === "boolean") {
          setResultOffloadEnabled(parsed.results.offloadEnabled);
        }
        const nextMemoryBudget = Number(parsed.results.memoryBudget);
        if (Number.isFinite(nextMemoryBudget)) {
          setResultMemoryBudget(clampNumber(nextMemoryBudget, 1_000, 100_000));
        }
      }
      if (isRecord(parsed.layout)) {
        const nextUiZoom = Number(parsed.layout.uiZoom);
        if (Number.isFinite(nextUiZoom)) {
          setUiZoom(nextUiZoom);
          parsed.layout.uiZoom = normalizeUiZoom(nextUiZoom);
        }
        if (typeof parsed.layout.sidebarOpen === "boolean") {
          setSidebarOpen(parsed.layout.sidebarOpen);
        }
        if (typeof parsed.layout.rightSidebarOpen === "boolean") {
          setRightSidebarOpen(parsed.layout.rightSidebarOpen);
        }
        if (
          parsed.layout.sidebarSide === "left" ||
          parsed.layout.sidebarSide === "right"
        ) {
          setRightSidebarOpen(parsed.layout.sidebarSide === "right");
        }
        const viewPlacements = parsed.layout.viewPlacements;
        if (isRecord(viewPlacements)) {
          const importedPlacements: Partial<WorkbenchViewPlacements> = {};
          for (const viewId of workbenchViewIds) {
            const side = viewPlacements[viewId];
            if (side === "left" || side === "right") {
              importedPlacements[viewId] = side;
            }
          }
          setViewPlacements((current) => {
            return { ...current, ...importedPlacements };
          });
        }
        const viewVisibility = parsed.layout.viewVisibility;
        if (isRecord(viewVisibility)) {
          const importedVisibility: Partial<WorkbenchViewVisibility> = {};
          for (const viewId of workbenchViewIds) {
            const open = viewVisibility[viewId];
            if (typeof open === "boolean") {
              importedVisibility[viewId] = open;
            }
          }
          setViewVisibility((current) => {
            return { ...current, ...importedVisibility };
          });
        }
        const nextSidebarWidth = Number(parsed.layout.sidebarWidth);
        if (Number.isFinite(nextSidebarWidth)) {
          setSidebarWidth(
            clampNumber(nextSidebarWidth, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX),
          );
        }
        const nextInspectorWidth = Number(parsed.layout.inspectorWidth);
        if (Number.isFinite(nextInspectorWidth)) {
          setInspectorWidth(
            clampNumber(
              nextInspectorWidth,
              INSPECTOR_WIDTH_MIN,
              INSPECTOR_WIDTH_MAX,
            ),
          );
        }
        const nextResultsHeight = Number(parsed.layout.resultsHeight);
        if (Number.isFinite(nextResultsHeight)) {
          setResultsHeight(
            clampNumber(
              nextResultsHeight,
              RESULTS_HEIGHT_MIN,
              RESULTS_HEIGHT_MAX,
            ),
          );
        }
      }
      if (isRecord(parsed.keymapOverrides)) {
        const nextKeymap: Keymap = {};
        for (const [commandId, chord] of Object.entries(
          parsed.keymapOverrides,
        )) {
          if (typeof chord === "string") {
            nextKeymap[commandId] = chord;
          }
        }
        setKeymapOverrides(nextKeymap);
        saveOverrides(nextKeymap);
      }
      if (Array.isArray(parsed.connections)) {
        const nextProfiles = withStarterProfiles(
          withUniqueProfileIds(
            parsed.connections.map((profile, index) =>
              settingsProfileFromJson(profile, index),
            ),
          ),
        );
        if (nextProfiles.length > 0) {
          const selectedId =
            typeof parsed.activeConnectionId === "string" &&
            nextProfiles.some(
              (profile) => profile.id === parsed.activeConnectionId,
            )
              ? parsed.activeConnectionId
              : nextProfiles[0].id;
          const selectedProfile =
            nextProfiles.find((profile) => profile.id === selectedId) ??
            nextProfiles[0];
          setProfiles(nextProfiles);
          setSelectedProfileId(selectedProfile.id);
          setActiveConnectionId(selectedProfile.id);
          setDraft(selectedProfile);
        }
      }
      setSettingsJsonDraft(JSON.stringify(parsed, null, 2));
      setSettingsJsonError(null);
      showActionNotice(
        "success",
        t("notice.workbench.settingsApplied"),
        themeNotice ?? t("notice.workbench.settingsAppliedDetail"),
      );
    } catch (error) {
      const message = errorMessage(error);
      setSettingsJsonError(message);
      showActionNotice(
        "error",
        t("notice.workbench.settingsJsonFailed"),
        message,
      );
    }
  }

  async function openAppDeveloperTools() {
    try {
      await workbenchRuntimeService.openDeveloperTools();
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.devToolsUnavailable"),
        errorMessage(error),
      );
    }
  }

  // Keep the keydown listener stable while reading the latest state via refs.
  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;
  const activeKeyScopeRef = useRef(activeKeyScope);
  activeKeyScopeRef.current = activeKeyScope;
  const recordingRef = useRef(recordingCommand);
  recordingRef.current = recordingCommand;
  const pendingKeySequenceRef = useRef<string[]>([]);
  const pendingKeyTimerRef = useRef<number | null>(null);
  const recordingSequenceRef = useRef<string[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  function clearPendingKeySequence() {
    pendingKeySequenceRef.current = [];
    if (pendingKeyTimerRef.current !== null) {
      window.clearTimeout(pendingKeyTimerRef.current);
      pendingKeyTimerRef.current = null;
    }
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function cancelRecording() {
    clearRecordingTimer();
    recordingRef.current = null;
    recordingSequenceRef.current = [];
    setRecordingCommand(null);
    setRecordingSequence([]);
  }

  function closeTransientOverlaysFromEscape() {
    const open = transientOverlayStateRef.current;
    if (
      !open.workspaceMenuOpen &&
      !open.runMenuOpen &&
      !open.exportMenuOpen &&
      !open.filtersOpen &&
      !open.objectActionMenu
    ) {
      return false;
    }
    setWorkspaceMenuOpen(false);
    setRunMenuOpen(false);
    setExportMenuOpen(false);
    setFiltersOpen(false);
    setObjectActionMenu(null);
    return true;
  }

  function commitRecordedKeybinding(
    commandId: string,
    sequence: readonly string[],
  ) {
    const chord = sequence.join(" ");
    if (!chord) {
      cancelRecording();
      return;
    }
    clearRecordingTimer();
    setKeymapOverrides((prev) => {
      const next = { ...prev, [commandId]: chord };
      saveOverrides(next);
      return next;
    });
    recordingRef.current = null;
    recordingSequenceRef.current = [];
    setRecordingCommand(null);
    setRecordingSequence([]);
  }

  function beginRecording(commandId: string) {
    if (recordingRef.current === commandId) {
      cancelRecording();
      return;
    }
    clearRecordingTimer();
    recordingRef.current = commandId;
    recordingSequenceRef.current = [];
    setRecordingCommand(commandId);
    setRecordingSequence([]);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Recording a rebind: one or two non-modifier chords become the new sequence.
      const recording = recordingRef.current;
      if (recording) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelRecording();
          return;
        }
        const chord = eventToChord(event);
        if (!chord) {
          return;
        }
        event.preventDefault();
        clearRecordingTimer();
        const next = [...recordingSequenceRef.current, chord];
        recordingSequenceRef.current = next;
        setRecordingSequence(next);
        if (next.length >= 2) {
          commitRecordedKeybinding(recording, next);
        } else {
          recordingTimerRef.current = window.setTimeout(() => {
            commitRecordedKeybinding(recording, recordingSequenceRef.current);
          }, KEY_SEQUENCE_TIMEOUT_MS);
        }
        return;
      }
      if (event.key === "Escape" && closeTransientOverlaysFromEscape()) {
        event.preventDefault();
        event.stopPropagation();
        clearPendingKeySequence();
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing && isCellEditorClipboardShortcut(event, target)) {
        return;
      }
      const scope = keyScopeFromTarget(target, activeKeyScopeRef.current);
      if (scope !== activeKeyScopeRef.current) {
        activeKeyScopeRef.current = scope;
        setActiveKeyScope(scope);
      }
      const chord = eventToChord(event);
      if (!chord) {
        return;
      }
      const map = keymapRef.current;
      const hadPending = pendingKeySequenceRef.current.length > 0;
      const resolution = resolveKeybinding({
        keymap: map,
        scope,
        chord,
        pending: pendingKeySequenceRef.current,
        commands: appCommandCatalog,
        allowBare: !typing,
      });
      if (resolution.kind === "pending") {
        event.preventDefault();
        pendingKeySequenceRef.current = resolution.pending;
        if (pendingKeyTimerRef.current !== null) {
          window.clearTimeout(pendingKeyTimerRef.current);
        }
        pendingKeyTimerRef.current = window.setTimeout(
          clearPendingKeySequence,
          KEY_SEQUENCE_TIMEOUT_MS,
        );
        return;
      }
      clearPendingKeySequence();
      if (resolution.kind === "command") {
        event.preventDefault();
        runCommandRef.current(resolution.commandId);
        return;
      }
      if (hadPending) {
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearPendingKeySequence();
      clearRecordingTimer();
    };
  }, []);

  // Initialize diagram filters per connection when the ERD modal opens.
  useEffect(() => {
    if (!diagramOpen) {
      diagramInitializedFor.current = null;
      return;
    }
    if (!activeMetadata || !hasDiagram(activeMetadata)) {
      setDiagramError(
        "No tables to diagram yet — connect and load metadata first.",
      );
      return;
    }
    setDiagramError(null);
    const initKey = `${activeConnectionId}:${activeMetadata.schemas
      .map((schema) => schema.name)
      .join("|")}`;
    if (diagramInitializedFor.current !== initKey) {
      setDiagramSchemaNames(
        activeMetadata.schemas
          .filter((schema) =>
            schema.objects.some((object) => object.kind === "table"),
          )
          .map((schema) => schema.name),
      );
      setDiagramSearch(pendingDiagramSearchRef.current ?? "");
      pendingDiagramSearchRef.current = null;
      setDiagramZoom(1);
      diagramInitializedFor.current = initKey;
    }
  }, [activeConnectionId, activeMetadata, diagramOpen]);

  function resetKeybinding(commandId: string) {
    if (recordingCommand === commandId) {
      cancelRecording();
    }
    setKeymapOverrides((prev) => {
      const next = { ...prev };
      delete next[commandId];
      saveOverrides(next);
      return next;
    });
  }

  function applyVimKeybindingPlan(
    resolutions: VimKeybindingConflictResolutions,
  ) {
    cancelRecording();
    setKeymapOverrides((prev) => {
      const currentKeymap = {
        ...resultCopyDefaultKeymap,
        ...effectiveKeymap(prev),
      };
      const conflicts = findVimKeybindingConflicts(
        currentKeymap,
        appCommandCatalog,
      );
      const next = applyVimKeybindingResolutionOverrides(
        prev,
        conflicts,
        resolutions,
      );
      saveOverrides(next);
      return next;
    });
    showActionNotice(
      "success",
      t("notice.workbench.vimShortcutsUpdated"),
      t("notice.workbench.vimShortcutsUpdatedDetail"),
    );
  }

  const importSqlPreview = importPreview
    ? generateImportSql(
        importPreview.tableName,
        importPreview.columns,
        importPreview.rows,
      )
    : "";
  const schemaSqlPreview = buildSchemaSql(schemaDraft);

  function loadHistoryItem(item: QueryHistoryItem) {
    if (item.connectionId !== activeConnectionId) {
      setActiveConnectionId(item.connectionId);
    }
    setQuery(item.sql);
    closeQueryHistoryDialog();
    window.setTimeout(() => activeEditorApi()?.focus(), 0);
    showActionNotice(
      "success",
      t("notice.workbench.sqlLoaded"),
      item.connectionName,
    );
  }

  async function runHistoryItem(item: QueryHistoryItem) {
    if (item.connectionId !== activeConnectionId) {
      loadHistoryItem(item);
      showActionNotice(
        "info",
        t("notice.workbench.sqlLoaded"),
        t("notice.workbench.sqlLoadedSwitchedDetail"),
      );
      return;
    }
    setQuery(item.sql);
    closeQueryHistoryDialog();
    await runEditorSql(item.sql, { allowMagic: false });
  }

  function restoreHistoryResult(item: QueryHistoryItem) {
    if (!item.result) {
      showActionNotice(
        "info",
        t("notice.workbench.noResultRetained"),
        t("notice.workbench.noResultRetainedDetail"),
      );
      return;
    }
    releaseActiveSpill();
    setResult(historySnapshotToQueryResult(item.result));
    setLastRunSql(item.sql);
    setQueryError(null);
    setResultMode("data");
    setTableViewObject(null);
    setActiveResultIndex(0);
    resetEdits();
    resetGridView();
    setSelectedRowKey(null);
    setSelectedCell(null);
    setSelectedRange(null);
    closeQueryHistoryDialog();
    showActionNotice(
      "success",
      t("notice.workbench.resultRestored"),
      t("notice.workbench.resultRestoredDetail", {
        count: toCount(item.result.retainedRows),
      }),
    );
  }

  async function saveExportBlob(blob: Blob, fileName: string) {
    // Desktop: offer a native "Save As" dialog so the user chooses the location
    // (the file name is pre-filled). Falls back to a browser download in the web
    // preview, or if the native fs path is unavailable/denied — so export always
    // works even before the desktop fs capability is wired up.
    if (!tauriRuntimeError()) {
      try {
        const [{ save }, { writeFile }] = await Promise.all([
          import("@tauri-apps/plugin-dialog"),
          import("@tauri-apps/plugin-fs"),
        ]);
        const path = await save({ defaultPath: fileName });
        if (path === null) {
          return; // user cancelled the dialog
        }
        await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
        showActionNotice("success", t("notice.grid.exportSaved"), path);
        return;
      } catch {
        // Native save not available yet — fall through to the browser download.
      }
    }
    downloadBlob(blob, fileName);
    showActionNotice("success", t("notice.grid.exportStarted"), fileName);
  }

  async function exportActiveResult(format: ResultExportFormat) {
    const exportResult = activeResult;
    if (!exportResult) {
      showActionNotice("info", t("notice.grid.noResultToExport"));
      return;
    }
    const target = inferEditTarget();
    const fileName = resultExportFileName(activeConnectionId, format);
    try {
      let blob: Blob;
      if (format === "xlsx") {
        blob = await buildXlsxBlob(exportResult, target?.table ?? "Result");
      } else {
        const exported = buildResultExport(
          exportResult,
          format,
          target?.table ?? "query_result",
        );
        blob = new Blob([exported.bom ? "\uFEFF" : "", exported.content], {
          type: exported.mime,
        });
      }
      setExportMenuOpen(false);
      await saveExportBlob(blob, fileName);
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.grid.exportFailed"),
        errorMessage(error),
      );
    }
  }

  async function copyActiveResultSqlInserts() {
    const exportResult = activeResult;
    if (!exportResult) {
      showActionNotice("info", t("notice.grid.noResultToCopy"));
      return;
    }
    const target = inferEditTarget();
    const exported = buildResultExport(
      exportResult,
      "sql",
      target?.table ?? "query_result",
    );
    try {
      await writeTextToClipboard(exported.content);
      showActionNotice(
        "success",
        t("notice.grid.insertSqlCopied"),
        t("notice.grid.rowCountDetail", {
          count: toCount(exportResult.rows.length),
        }),
      );
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  async function copyActiveResultAs(format: ResultExportFormat) {
    if (format === "sql") {
      await copyActiveResultSqlInserts();
      return;
    }
    const exportResult = activeResult;
    if (!exportResult) {
      showActionNotice("info", t("notice.grid.noResultToCopy"));
      return;
    }
    const target = inferEditTarget();
    const exported = buildResultExport(
      exportResult,
      format,
      target?.table ?? "query_result",
    );
    try {
      await writeTextToClipboard(exported.content);
      showActionNotice(
        "success",
        t("notice.grid.copiedAs", { format: format.toUpperCase() }),
        t("notice.grid.rowCountDetail", {
          count: toCount(exportResult.rows.length),
        }),
      );
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  function currentDiagramSvgMarkup() {
    const svg = diagramSvgRef.current;
    if (!svg || !diagramLayout) {
      throw new Error("No ERD is rendered");
    }
    return {
      markup: serializeSvgElement(svg),
      width: diagramLayout.width,
      height: diagramLayout.height,
    };
  }

  function downloadDiagramSvg() {
    try {
      const { markup } = currentDiagramSvgMarkup();
      downloadBlob(
        new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
        erdFileName(activeConnectionId, "svg"),
      );
      setDiagramError(null);
      showActionNotice(
        "success",
        t("notice.workbench.erdSvgExported"),
        erdFileName(activeConnectionId, "svg"),
      );
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", t("notice.workbench.erdExportFailed"), message);
    }
  }

  async function downloadDiagramPng() {
    try {
      const { markup, width, height } = currentDiagramSvgMarkup();
      const blob = await svgMarkupToPngBlob(markup, width, height);
      downloadBlob(blob, erdFileName(activeConnectionId, "png"));
      setDiagramError(null);
      showActionNotice(
        "success",
        t("notice.workbench.erdPngExported"),
        erdFileName(activeConnectionId, "png"),
      );
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", t("notice.workbench.erdExportFailed"), message);
    }
  }

  async function copyDiagramSvg() {
    try {
      const { markup } = currentDiagramSvgMarkup();
      await writeTextToClipboard(markup);
      setDiagramError(null);
      showActionNotice("success", t("notice.workbench.erdSvgCopied"));
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", t("notice.workbench.copyFailed"), message);
    }
  }

  async function copyDiagramPng() {
    try {
      const { markup, width, height } = currentDiagramSvgMarkup();
      const blob = await svgMarkupToPngBlob(markup, width, height);
      await writePngBlobToClipboard(blob);
      setDiagramError(null);
      showActionNotice("success", t("notice.workbench.erdPngCopied"));
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", t("notice.workbench.copyFailed"), message);
    }
  }

  function currentTableSpecDocument() {
    if (!activeMetadata) {
      throw new Error("No schema metadata is loaded");
    }
    return buildTableSpecDocument(activeMetadata, {
      connectionId: activeConnectionId,
      connectionName: activeConnection.name,
      schemaNames: diagramSchemaNames,
      search: diagramSearch,
    });
  }

  function downloadTableSpecMarkdown() {
    try {
      const exported = exportTableSpecMarkdown(currentTableSpecDocument());
      downloadBlob(
        new Blob([exported.content], { type: exported.mime }),
        tableSpecFileName(activeConnectionId, exported.extension),
      );
      setDiagramError(null);
      showActionNotice(
        "success",
        t("notice.workbench.tableSpecExported"),
        "Markdown",
      );
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice(
        "error",
        t("notice.workbench.tableSpecExportFailed"),
        message,
      );
    }
  }

  function downloadTableSpecJson() {
    try {
      const exported = exportTableSpecJson(currentTableSpecDocument());
      downloadBlob(
        new Blob([exported.content], { type: exported.mime }),
        tableSpecFileName(activeConnectionId, exported.extension),
      );
      setDiagramError(null);
      showActionNotice(
        "success",
        t("notice.workbench.tableSpecExported"),
        "JSON",
      );
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice(
        "error",
        t("notice.workbench.tableSpecExportFailed"),
        message,
      );
    }
  }

  async function handleSchemaSpecFile(file: File) {
    try {
      const spec = parseTableSpecDocument(await file.text());
      const sql = ddlFromTableSpecDocument(spec);
      setQuery(sql);
      setDiagramOpen(false);
      setDiagramError(null);
      showActionNotice("success", t("notice.workbench.ddlFromSpec"), file.name);
      window.setTimeout(() => activeEditorApi()?.focus(), 0);
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice(
        "error",
        t("notice.workbench.specImportFailed"),
        message,
      );
    } finally {
      if (schemaSpecFileRef.current) {
        schemaSpecFileRef.current.value = "";
      }
    }
  }

  function createDatabaseSqlFromDiagram() {
    try {
      const sql = buildCreateDatabaseSql(currentTableSpecDocument());
      setQuery(sql);
      setDiagramOpen(false);
      setDiagramError(null);
      showActionNotice("success", t("notice.workbench.createDbSqlGenerated"));
      window.setTimeout(() => activeEditorApi()?.focus(), 0);
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice(
        "error",
        t("notice.workbench.createDbSqlFailed"),
        message,
      );
    }
  }

  function editDiagramTableColumns(tableId: string) {
    const object = activeMetadata?.schemas
      .flatMap((schema) => schema.objects)
      .find(
        (item) =>
          item.kind === "table" && `${item.schema}.${item.name}` === tableId,
      );
    if (!object) {
      return;
    }
    setDiagramOpen(false);
    openObjectSchemaDesigner(object);
  }

  function openSchemaDiagramDesigner() {
    if (activeMetadata && hasDiagram(activeMetadata)) {
      openSchemaDiagramFromDocument(diagramFromMetadata(activeMetadata));
    } else {
      openBlankSchemaDiagram();
    }
  }

  function editDiagramInDesigner() {
    if (!activeMetadata) {
      return;
    }
    openSchemaDiagramFromDocument(
      diagramFromMetadata(activeMetadata, {
        schemaNames: diagramSchemaNames,
        search: diagramSearch,
      }),
    );
    setDiagramOpen(false);
  }

  function seedSchemaDiagramFromDb() {
    if (activeMetadata) {
      setSchemaDiagramDocument(diagramFromMetadata(activeMetadata));
    }
  }

  function putDiagramDesignerSqlInEditor(sql: string) {
    setQuery(sql);
    closeSchemaDiagram();
    showActionNotice("success", t("notice.workbench.createDbSqlGenerated"));
    window.setTimeout(() => activeEditorApi()?.focus(), 0);
  }

  async function copyDiagramDesignerSql(sql: string) {
    try {
      await writeTextToClipboard(sql);
      showActionNotice("success", t("notice.workbench.schemaSqlCopied"));
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  function fitDiagramToViewport() {
    if (!diagramLayout || !diagramCanvasRef.current) {
      return;
    }
    const bounds = diagramCanvasRef.current.getBoundingClientRect();
    const nextZoom = clampNumber(
      Math.min(
        bounds.width / diagramLayout.width,
        bounds.height / diagramLayout.height,
      ),
      0.25,
      1.25,
    );
    setDiagramZoom(nextZoom);
    window.requestAnimationFrame(() => {
      if (diagramCanvasRef.current) {
        diagramCanvasRef.current.scrollTop = 0;
        diagramCanvasRef.current.scrollLeft = 0;
      }
    });
  }

  async function handleImportFile(file: File) {
    const kind = detectImportFileKind(file.name);
    setImportPreview(null);
    if (!kind) {
      showActionNotice(
        "error",
        t("notice.workbench.importFailed"),
        t("notice.workbench.importUnsupportedDetail"),
      );
      return;
    }
    const text = await file.text();
    if (kind === "sql") {
      setQuery(text);
      showActionNotice("success", t("notice.workbench.sqlLoaded"), file.name);
      return;
    }
    if (kind === "excel") {
      showActionNotice(
        "error",
        t("notice.workbench.importFailed"),
        t("notice.workbench.importExcelDetail"),
      );
      return;
    }
    try {
      const parsed = parseImportText(text, kind);
      setImportPreview({
        ...parsed,
        fileName: file.name,
        format: kind,
        tableName: inferImportTableName(file.name),
      });
      showActionNotice(
        "success",
        t("notice.workbench.importPreviewReady"),
        t("notice.workbench.importPreviewReadyDetail", {
          name: file.name,
          count: toCount(parsed.totalRows),
        }),
      );
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.importFailed"),
        errorMessage(error),
      );
    }
  }

  function putImportSqlInEditor() {
    if (!importPreview) {
      return;
    }
    setQuery(
      generateImportSql(
        importPreview.tableName,
        importPreview.columns,
        importPreview.rows,
      ),
    );
    setImportPreview(null);
    showActionNotice(
      "success",
      t("notice.workbench.importSqlGenerated"),
      importPreview.tableName,
    );
  }

  function putMigrationTextInEditor(text: string) {
    setQuery(text);
    setMigrationStudioOpen(false);
    showActionNotice("success", t("notice.workbench.migrationOutputLoaded"));
  }

  async function copyMigrationText(text: string, label: string) {
    try {
      await writeTextToClipboard(text);
      showActionNotice("success", t("notice.workbench.labelCopied", { label }));
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  async function openTableData(object: DbObjectMetadata) {
    if (object.kind !== "table" && object.kind !== "view") {
      return;
    }
    const sql = tablePreviewSql(editorEngine, object);
    setQuery(sql);
    setObjectActionMenu(null);
    setTableViewObject(object);
    setResultMode("data");
    if (activeConnectionOpen) {
      await executeQuery(sql, undefined, { sourceObject: object });
    }
  }

  function openSnapshotObject(object: WorkspaceConnection["objects"][number]) {
    if (object.kind === "procedure") {
      return;
    }
    const sql =
      editorEngine === "sqlserver"
        ? `select top (200) * from ${quoteSqlIdentifier(editorEngine, object.name)};`
        : `select * from ${quoteSqlIdentifier(editorEngine, object.name)} limit 200;`;
    setQuery(sql);
    if (activeConnectionOpen) {
      void executeQuery(sql);
    }
  }

  function showObjectInDiagram(object: DbObjectMetadata) {
    pendingDiagramSearchRef.current = object.name;
    setDiagramSearch(object.name);
    setDiagramOpen(true);
    setObjectActionMenu(null);
  }

  function jumpToSqlMetadata(target: SqlMetadataTarget) {
    openObjectSchemaDesigner(target.object);
    setObjectActionMenu(null);
  }

  function putSchemaSqlInEditor() {
    setQuery(buildSchemaSql(schemaDraft));
    setSchemaDesignerOpen(false);
    showActionNotice(
      "success",
      t("notice.workbench.schemaSqlGenerated"),
      schemaDraft.table,
    );
  }

  async function copySchemaSql() {
    try {
      await writeTextToClipboard(schemaSqlPreview);
      showActionNotice("success", t("notice.workbench.schemaSqlCopied"));
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  function insertCompletionHint(hint: CompletionHint) {
    activeEditorApi()?.insertText(hint.insertText);
    activeEditorApi()?.focus();
  }

  function saveCurrentQuery() {
    try {
      window.localStorage.setItem(savedQueryStorageKey, query);
      showActionNotice(
        "success",
        t("notice.workbench.querySaved"),
        activeTabLabel ?? "scratch",
      );
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.querySaveFailed"),
        errorMessage(error),
      );
    }
  }

  function saveCurrentQueryAsFile() {
    const fileName = sqlDownloadFileName(activeTabLabel ?? "query.sql");
    downloadBlob(
      new Blob([query], { type: "application/sql;charset=utf-8" }),
      fileName,
    );
    showActionNotice(
      "success",
      t("notice.workbench.sqlExportStarted"),
      fileName,
    );
  }

  async function exitApplication() {
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      showActionNotice(
        "info",
        t("notice.workbench.exitUnavailable"),
        t("notice.workbench.exitUnavailableDetail"),
      );
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.exitFailed"),
        errorMessage(error),
      );
    }
  }

  async function copyAppDiagnostics() {
    const diagnostics = [
      `${APP_NAME} ${APP_VERSION}`,
      `Identifier: ${APP_IDENTIFIER}`,
      `Runtime: ${tauriRuntimeError() ? "browser preview" : "Tauri desktop"}`,
      `Theme: ${theme.kind}`,
      `Active connection: ${activeConnectionId}`,
      `Connection status: ${activeConnectionOpen ? "connected" : "closed"}`,
      `Engine: ${activeEngine}`,
      `User agent: ${navigator.userAgent}`,
    ].join("\n");
    try {
      await navigator.clipboard?.writeText(diagnostics);
      showActionNotice("success", t("notice.workbench.diagnosticsCopied"));
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  async function formatQuery() {
    const result = await activeEditorApi()?.format();
    const error = result?.error ?? null;
    setQueryError(error);
    if (error) {
      showActionNotice("error", t("notice.editor.formatFailed"), error);
    } else if (!result?.changed) {
      showActionNotice(
        "info",
        result?.skipped === "empty"
          ? t("notice.editor.nothingToFormat")
          : t("notice.editor.alreadyFormatted"),
      );
    } else {
      showActionNotice("success", t("notice.editor.formatted"), formatter);
    }
  }

  function showEditorQuickFix() {
    const opened = activeEditorApi()?.showQuickFix() ?? false;
    if (!opened) {
      showActionNotice("info", t("notice.editor.noProblems"));
    }
  }

  async function cleanupQuery() {
    const result = await activeEditorApi()?.cleanup();
    const error = result?.error ?? null;
    setQueryError(error);
    if (error) {
      showActionNotice("error", t("notice.editor.cleanupFailed"), error);
    } else if (!result?.changed) {
      showActionNotice(
        "info",
        result?.skipped === "empty"
          ? t("notice.editor.nothingToCleanup")
          : t("notice.editor.alreadyClean"),
      );
    } else {
      showActionNotice("success", t("notice.editor.cleanupComplete"));
    }
  }

  function transformEditorSelection(action: SqlEditorTransformAction) {
    const changed = activeEditorApi()?.transformSelection(action) ?? false;
    if (!changed) {
      showActionNotice("info", t("notice.editor.nothingChanged"));
      return;
    }
    const label: Record<SqlEditorTransformAction, string> = {
      uppercase: t("notice.editor.uppercased"),
      lowercase: t("notice.editor.lowercased"),
      unformat: t("notice.editor.unformatted"),
      appendCommas: t("notice.editor.commasAdded"),
      doubleToSingleQuotes: t("notice.editor.quotesConverted"),
    };
    showActionNotice("success", label[action]);
  }

  function indentEditorSelection() {
    const changed = activeEditorApi()?.indentSelection() ?? false;
    showActionNotice(
      changed ? "success" : "info",
      changed ? t("notice.editor.indented") : t("notice.editor.nothingChanged"),
    );
  }

  function outdentEditorSelection() {
    const changed = activeEditorApi()?.outdentSelection() ?? false;
    showActionNotice(
      changed ? "success" : "info",
      changed
        ? t("notice.editor.outdented")
        : t("notice.editor.nothingChanged"),
    );
  }

  async function runQuery() {
    setRunMenuOpen(false);
    const selectedSql = selectedSqlFromSelections(
      query,
      activeEditorSelections(),
    );
    if (selectedSql) {
      await runEditorSql(selectedSql, { allowMagic: true });
      return;
    }
    const selection = activeMainEditorSelection();
    const sqlToRun = selectedOrCurrentStatement(
      selection.from,
      selection.to,
      query,
    );
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  async function copyPlanFormat(format: QueryPlanCopyFormat) {
    try {
      await writeTextToClipboard(format.content);
      showActionNotice(
        "success",
        t("notice.workbench.planCopied"),
        format.label,
      );
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  async function runSelectionQuery() {
    setRunMenuOpen(false);
    const sqlToRun = selectedSqlFromSelections(query, activeEditorSelections());
    if (!sqlToRun) {
      showActionNotice("info", t("notice.query.noSelectionToRun"));
      return;
    }
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  async function runCurrentQuery() {
    setRunMenuOpen(false);
    const selection = activeMainEditorSelection();
    const cursor = selection.to;
    const sqlToRun = selectedOrCurrentStatement(cursor, cursor, query);
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  function explainTargetSql() {
    const selectedSql = selectedSqlFromSelections(
      query,
      activeEditorSelections(),
    );
    if (selectedSql) {
      return selectedSql;
    }
    const selection = activeMainEditorSelection();
    const cursor = selection.to;
    return selectedOrCurrentStatement(cursor, cursor, query);
  }

  async function explainCurrentQuery(mode: QueryPlanMode) {
    setRunMenuOpen(false);
    await explainSql(explainTargetSql().trim(), mode);
  }

  async function runFromStartQuery() {
    setRunMenuOpen(false);
    const selection = activeMainEditorSelection();
    const cursor = Math.max(selection.from, selection.to);
    const sqlToRun = query.slice(0, cursor).trim();
    await runEditorSql(sqlToRun, { allowMagic: false });
  }

  async function runAllQuery() {
    setRunMenuOpen(false);
    await runEditorSql(query.trim(), { allowMagic: false });
  }

  async function runEditorSql(
    sqlToRun: string,
    options: { allowMagic: boolean },
  ) {
    await runEditorSqlWithRunner(sqlToRun, {
      ...options,
      onMagic: runQueryMagic,
    });
  }

  async function runQueryMagic(magic: QueryMagicAction) {
    switch (magic.kind) {
      case "error":
        setQueryError(magic.message);
        return;
      case "sql":
        setQuery(magic.sql);
        await runSqlWithParameterPrompt(magic.sql);
        return;
      case "erd":
        if (!activeConnectionOpen) {
          setQueryError(`not connected: ${activeConnectionId}`);
          return;
        }
        if (!activeMetadata && !activeMetadataLoading) {
          await refreshObjects(activeConnectionId, true);
        }
        pendingDiagramSearchRef.current = magic.search;
        setDiagramSearch(magic.search);
        setDiagramOpen(true);
        setQueryError(null);
        return;
      case "export":
        if (!activeResult) {
          setQueryError("No result to export yet.");
          return;
        }
        exportActiveResult(magic.format);
        setQueryError(null);
        return;
      case "params":
        setQuery(magic.sql);
        await openQueryParameterPrompt(magic.sql, true);
        return;
    }
  }

  const completionOpen =
    viewVisibility.completion &&
    (viewPlacements.completion === "right" ? rightSidebarOpen : sidebarOpen);
  const historyOpen =
    viewVisibility.queryHistory &&
    (viewPlacements.queryHistory === "right" ? rightSidebarOpen : sidebarOpen);
  const planOpen =
    viewVisibility.plan &&
    (viewPlacements.plan === "right" ? rightSidebarOpen : sidebarOpen);
  const appStyle = useMemo(
    () =>
      ({
        ...cssVariables(theme),
        ...uiZoomStyleVariables(uiZoom),
      }) as CSSProperties,
    [theme, uiZoom],
  );

  // Briefly enable color transitions only while the theme is actually changing,
  // so light/dark switches fade instead of snapping — without leaving a
  // permanent transition on every surface (which would make hover feel laggy).
  const [themeSwitching, setThemeSwitching] = useState(false);
  const themeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${themeKind}|${activeDefaultThemeId ?? ""}|${activeCustomThemeId ?? ""}`;
    if (themeKeyRef.current === null) {
      themeKeyRef.current = key;
      return;
    }
    if (themeKeyRef.current === key) return;
    themeKeyRef.current = key;
    setThemeSwitching(true);
    const timer = window.setTimeout(() => setThemeSwitching(false), 280);
    return () => window.clearTimeout(timer);
  }, [themeKind, activeDefaultThemeId, activeCustomThemeId]);

  function renderEditorTabStrip(group: EditorGroup) {
    const state = editorGroupStates[group];
    const groupOpenTabs = openTabsForEditorGroup(state);
    const closedTabsAvailable = state.tabs.some(
      (tab) => !state.openTabIds.includes(tab.id),
    );
    const menuOpenForGroup = editorTabMenu?.group === group;
    return (
      <div
        className="tab-strip editor-tab-strip"
        onContextMenu={(event) => event.stopPropagation()}
      >
        {groupOpenTabs.map((tab) => (
          <button
            className={tab.id === state.activeTabId ? "tab active" : "tab"}
            key={tab.id}
            type="button"
            title={tab.label}
            onClick={() => selectEditorTab(group, tab.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              selectEditorTab(group, tab.id);
              setEditorTabMenu({
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
          title="New SQL tab"
          aria-label="New SQL tab"
          onClick={() => newSqlTab(group)}
        >
          <Plus size={14} />
        </button>
        {menuOpenForGroup && editorTabMenu ? (
          <div
            className="app-menu-popover editor-tab-menu"
            role="menu"
            style={{ left: editorTabMenu.x, top: editorTabMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const { group } = editorTabMenu;
                setEditorTabMenu(null);
                newSqlTab(group);
              }}
            >
              <span>New SQL Tab</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const { group, tabId } = editorTabMenu;
                setEditorTabMenu(null);
                renameSqlTab(group, tabId);
              }}
            >
              <span>Rename Tab</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const { group, tabId } = editorTabMenu;
                setEditorTabMenu(null);
                duplicateSqlTab(group, tabId);
              }}
            >
              <span>Duplicate Tab</span>
            </button>
            <span className="menu-separator" aria-hidden="true" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const { group, tabId } = editorTabMenu;
                setEditorTabMenu(null);
                closeSqlTab(group, tabId);
              }}
            >
              <span>Close Tab</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={groupOpenTabs.length <= 1}
              onClick={() => {
                const { group, tabId } = editorTabMenu;
                setEditorTabMenu(null);
                closeOtherSqlTabs(group, tabId);
              }}
            >
              <span>Close Other Tabs</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!closedTabsAvailable}
              onClick={() => {
                const { group } = editorTabMenu;
                setEditorTabMenu(null);
                reopenSqlTab(group);
              }}
            >
              <span>Reopen Closed Tab</span>
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderSidebar(side: "left" | "right") {
    const right = side === "right";
    return (
      <Sidebar
        sidebarOpen={right ? rightSidebarOpen : sidebarOpen}
        side={side}
        activeView={right ? activeRightSidebarView : activeLeftSidebarView}
        availableViews={right ? rightSidebarViews : leftSidebarViews}
        showConnectionRail={!right}
        completionPanel={
          <InspectorContent
            activeConnectionId={activeConnectionId}
            editorEngine={editorEngine}
            connectionById={connectionById}
            activeMetadataLoading={activeMetadataLoading}
            activeMetadataError={activeMetadataError}
            completionHints={completionHints}
            onInsertCompletionHint={insertCompletionHint}
            onInsertSql={(sql) => activeEditorApi()?.insertText(sql)}
            onLoadHistorySql={setQuery}
            onCloseCompletion={() => closeSidebarView("completion")}
            showCompletion
            showHistory={false}
          />
        }
        historyPanel={
          <InspectorContent
            activeConnectionId={activeConnectionId}
            editorEngine={editorEngine}
            connectionById={connectionById}
            activeMetadataLoading={activeMetadataLoading}
            activeMetadataError={activeMetadataError}
            completionHints={completionHints}
            onInsertCompletionHint={insertCompletionHint}
            onInsertSql={(sql) => activeEditorApi()?.insertText(sql)}
            onLoadHistorySql={setQuery}
            onCloseHistory={() => closeSidebarView("queryHistory")}
            showCompletion={false}
            showHistory
          />
        }
        planPanel={
          <PlanPanel
            plan={planAnalysis}
            loading={planLoading}
            error={planError}
            activeConnectionOpen={activeConnectionOpen}
            activeConnectionName={activeConnection.name}
            onExplainPlan={() => void explainCurrentQuery("plan")}
            onExplainAnalyze={() => void explainCurrentQuery("analyze")}
            onCopyFormat={(format) => void copyPlanFormat(format)}
            onClose={() => closeSidebarView("plan")}
          />
        }
        lakehousePanel={
          <LakehousePanel
            editorEngine={editorEngine}
            activeConnectionName={activeConnection.name}
            activeConnectionOpen={activeConnectionOpen}
            activeMetadata={activeMetadata}
            onInsertSql={(sql) => activeEditorApi()?.insertText(sql)}
            onLoadSql={setQuery}
            onClose={() => closeSidebarView("lakehouse")}
          />
        }
        biPanel={
          <BiPanel
            result={activeResult}
            chartModel={chartResultModel}
            chartAvailable={chartAvailable}
            onOpenChartMode={() => setResultMode("chart")}
            onClose={() => closeSidebarView("bi")}
          />
        }
        gitPanel={
          <GitPanel variant="sidebar" onClose={() => closeSidebarView("git")} />
        }
        aiChatPanel={
          <AiChatPanel
            activeConnectionId={activeConnectionId}
            activeConnectionName={activeConnection.name}
            activeConnectionOpen={activeConnectionOpen}
            engine={editorEngine}
            onInsertSql={(sql) => activeEditorApi()?.insertText(sql)}
            onClose={() => closeSidebarView("aiChat")}
            notify={showActionNotice}
          />
        }
        searchReplacePanel={
          <SearchReplacePanel
            tabs={searchTabs}
            onReveal={revealSearchMatch}
            onReplaceTab={replaceSearchTab}
            onClose={() => closeSidebarView("searchReplace")}
          />
        }
        connections={connections}
        profileById={profileById}
        activeConnectionId={activeConnectionId}
        activeConnection={activeConnection}
        activeConnectionOpen={activeConnectionOpen}
        activeMetadata={activeMetadata}
        activeMetadataLoading={activeMetadataLoading}
        activeMetadataError={activeMetadataError}
        connectedIds={connectedIds}
        objectActionMenu={objectActionMenu}
        objectKindLabel={objectKindLabel}
        formatObjectName={(object) => qualifiedObjectName(editorEngine, object)}
        onAddProfile={() => {
          addProfile();
          setConnectionManagerOpen(true);
        }}
        onOpenConnectionManager={() => setConnectionManagerOpen(true)}
        onOpenSqliteSample={() => void openSqliteSample()}
        onSelectConnection={selectSidebarConnection}
        onOpenBlankSchemaDesigner={openBlankSchemaDesigner}
        onNewTableFromFile={() => importFileRef.current?.click()}
        onOpenObjectSchemaDesigner={openObjectSchemaDesigner}
        onOpenDiagram={() => setDiagramOpen(true)}
        onOpenSchemaDiagram={openSchemaDiagramDesigner}
        onRefreshObjects={() => refreshObjects(activeConnectionId, true, true)}
        onOpenTableData={(object) => void openTableData(object)}
        onOpenSnapshotObject={openSnapshotObject}
        onShowObjectInDiagram={showObjectInDiagram}
        onSetObjectActionMenu={setObjectActionMenu}
        onSelectView={setActiveSidebarView}
        onCloseSidebar={() =>
          right ? setRightSidebarOpen(false) : setSidebarOpen(false)
        }
        dockResize
        onBeginResize={(event) =>
          beginPanelResize(right ? "rightSidebar" : "sidebar", event)
        }
        onResizeKey={(event) =>
          onPanelResizeKey(right ? "rightSidebar" : "sidebar", event)
        }
      />
    );
  }

  const queryEditorController = {
    activeTabLabel,
    running,
    formatter,
    primaryQuery,
    secondaryQuery,
    onPrimaryQueryChange: (next) => setEditorGroupQuery("primary", next),
    onSecondaryQueryChange: (next) => setEditorGroupQuery("secondary", next),
    renderEditorTabStrip,
    editorEngine,
    activeMetadata,
    sqlSnippets,
    editorBackgroundImage,
    editorBackgroundOpacity,
    theme,
    vimMode,
    sqlLinter,
    editorApiRef,
    secondaryEditorApiRef,
    editorSplitRef,
    editorSplitOpen,
    editorSplitMode,
    activeEditorGroup,
    setActiveEditorGroup,
    setEditorSelection: setEditorGroupSelection,
    runPrimaryLabel,
    runShortcutLabel,
    runCurrentShortcutLabel,
    runFromStartShortcutLabel,
    runAllShortcutLabel,
    runMenuOpen,
    hasSelectedEditorSql,
    resultActionsAvailable: Boolean(activeResult),
    runCommand,
    saveCurrentQuery,
    runQuery,
    runSelectionQuery,
    runCurrentQuery,
    runFromStartQuery,
    runAllQuery,
    cancelQuery,
    setRunMenuOpen,
    beginEditorSplitResize: (event) => beginPanelResize("editorSplit", event),
    onEditorSplitResizeKey: (event) => onPanelResizeKey("editorSplit", event),
    onSqlFileDrop: (file) => void handleImportFile(file),
    onUnsupportedFileDrop: () =>
      showActionNotice(
        "error",
        t("editor.dropFailed"),
        t("editor.dropUnsupportedFile"),
      ),
    sqlFileDropLabel: t("editor.dropSqlFile"),
    onMetadataJump: jumpToSqlMetadata,
  } satisfies QueryEditorController;

  const resultGridController = {
    running,
    readOnly: activeConnectionReadOnly,
    tableViewObject,
    resultMode: effectiveResultMode,
    chartModel: chartResultModel,
    graphModel: graphResultModel,
    chartAvailable,
    graphAvailable,
    webGlAvailable,
    resultSets,
    activeResult,
    hasResult: Boolean(activeResult),
    activeResultIndex: activeResultIndexView,
    queryError,
    commitError,
    pendingCount,
    displayedResultSummary,
    resultColumns,
    exportMenuOpen,
    shortcutTips: resultShortcutTips,
    showingStructure,
    structureObject,
    editorEngine,
    unfilteredRowCount,
    totalRows,
    gridRef,
    importFileRef,
    activeMetadata,
    activeConnectionId,
    formatObjectName: (object) => qualifiedObjectName(editorEngine, object),
    formatCount: toCount,
    onResultModeChange: setResultMode,
    onSelectResultSet: selectResultSet,
    onExportActiveResult: exportActiveResult,
    onToggleExportMenu: () => setExportMenuOpen((open) => !open),
    onCloseExportMenu: () => setExportMenuOpen(false),
    onCopyVisibleResult: () => void copyVisibleResult(),
    onCopyResultAs: (format: ResultExportFormat) =>
      void copyActiveResultAs(format),
    onImportFile: (file) => void handleImportFile(file),
    filtering: {
      quickFilter,
      filtersOpen,
      filtersActive,
      activeFilters,
      filteredOutCount,
      filterJoin,
      filterRules,
      sortRuleByColumn,
      sortRules,
      onQuickFilterChange: updateQuickFilter,
      onClearQuickFilter: clearQuickFilter,
      onToggleFilters: () => setFiltersOpen((open) => !open),
      onSetFilterJoin: setFilterJoin,
      onAddFilterRule: addFilterRule,
      onUpdateFilterRule: updateFilterRule,
      onRemoveFilterRule: removeFilterRule,
      onClearResultFilters: clearResultFilters,
      onToggleSort: toggleSort,
      onCloseFilters: () => setFiltersOpen(false),
    },
    editing: {
      editMode,
      editUndoDepth,
      committing,
      cellEdits,
      editingCell,
      canEditActiveResult,
      onAddNewRow: addNewRow,
      onUndoEdit: undoLastEdit,
      onCommitEdits: () => void commitEdits(),
      onDiscardEdits: discardEdits,
      onGenerateRowChangeSql: generateSelectedRowChangeSql,
      onEnableEditMode: enableEditMode,
      onBeginCellEdit: beginCellEdit,
      onSetCellValue: setCellValue,
      onDeleteRow: deleteRow,
      onPasteTableAt: pasteTableAt,
      onEndCellEdit: () => setEditingCell(null),
    },
    selection: {
      selectedRowKey,
      selectedCell,
      selectedRangeBounds,
      selectedRowValues,
      rowDetailTable,
      onSelectGridRow: selectGridRow,
      onSelectGridCell: selectGridCell,
      onCloseRowDetail: () => {
        setSelectedRowKey(null);
        setSelectedCell(null);
        setSelectedRange(null);
      },
    },
    gridGeometry: {
      gridRowStyle,
      gridTotalWidth,
      gridRowHeight,
      gridColumnWidth,
      leftColumnPad,
      rightColumnPad,
      topPad,
      bottomPad,
      firstVisible,
      visibleColumnIndexes,
      visibleRows,
      visibleRowsRevision,
      onGridScroll,
      onGridKeyDown,
      onGridPaste,
      onGridCopy,
    },
  } satisfies ResultGridController;

  const connectionController = connectionManagerOpen
    ? ({
        profiles: filteredProfiles,
        connectedIds,
        selectedProfileId,
        draft,
        search: connectionSearch,
        error: connectionError,
        activeConnectionOpen,
        testing: testingConnection,
        connecting,
        onClose: () => setConnectionManagerOpen(false),
        onSearchChange: setConnectionSearch,
        onAddProfile: addProfile,
        onImportProfiles: (file) => void importConnectionFile(file),
        onExportProfiles: exportConnectionFile,
        onSelectProfile: selectProfile,
        onUpdateDraft: updateDraft,
        onDeleteProfile: () => void deleteProfile(),
        onDisconnect: () => void disconnectActiveProfile(),
        onSave: () => saveDraft(),
        onTest: () => void testActiveProfile(),
        onConnect: connectActiveProfile,
      } satisfies ConnectionController)
    : null;

  return (
    <div
      className="app-root"
      data-theme={theme.kind}
      data-animations={animationsEnabled ? "on" : "off"}
      data-theme-switching={themeSwitching ? "on" : undefined}
      style={appStyle}
    >
      <WorkbenchShell
        appName={APP_NAME}
        themeKind={theme.kind}
        activeKeyScope={activeKeyScope}
        leftSidebarOpen={sidebarOpen}
        rightSidebarOpen={rightSidebarOpen}
        completionOpen={completionOpen}
        historyOpen={historyOpen}
        planOpen={planOpen}
        sidebarWidth={sidebarWidth}
        inspectorWidth={inspectorWidth}
        resultsHeight={resultsHeight}
        editorSplitPercent={editorSplitPercent}
        menuBarSections={menuBarSections}
        commandCatalog={appMenuCommandCatalog}
        keymap={keymap}
        activeConnectionName={activeConnection.name}
        activeConnectionEngine={activeConnection.engine}
        activeConnectionColor={activeConnectionColor}
        activeConnectionStatus={activeConnectionStatus}
        activeTransportLabel={activeTransportLabel}
        vimMode={vimMode}
        queryLineCount={query.split("\n").length}
        sqlLintEnabled={sqlLinter === "gentle"}
        running={running}
        selectionStatus={selectionStatus}
        shellStyle={appStyle}
        onScopeFocus={(event) => {
          const scope = keyScopeFromTarget(event.target, "global");
          activeKeyScopeRef.current = scope;
          setActiveKeyScope(scope);
        }}
        onScopeMouseDown={(event) => {
          const scope = keyScopeFromTarget(event.target, activeKeyScope);
          activeKeyScopeRef.current = scope;
          setActiveKeyScope(scope);
        }}
        onToggleLeftSidebar={() => setSidebarOpen((open) => !open)}
        onToggleRightSidebar={toggleRightSidebar}
        onOpenConnectionManager={() => setConnectionManagerOpen(true)}
        onRunCommand={runCommand}
        onCloseWorkspaceMenu={() => setWorkspaceMenuOpen(false)}
        dockLayout
        leftSidebar={null}
        rightSidebar={null}
      >
        <WorkbenchDockLayout
          leftSidebarOpen={sidebarOpen}
          rightSidebarOpen={rightSidebarOpen}
          sidebarWidth={sidebarWidth}
          inspectorWidth={inspectorWidth}
          resultsHeight={resultsHeight}
          leftSidebar={renderSidebar("left")}
          rightSidebar={renderSidebar("right")}
          editor={
            <div className="editor-and-inspector">
              <QueryEditorPane {...queryEditorController} />
            </div>
          }
          results={<ResultsPane {...resultGridController} />}
        />
      </WorkbenchShell>

      {connectionController ? (
        <ConnectionManagerDialog {...connectionController} />
      ) : null}

      {migrationStudioOpen ? (
        <Suspense fallback={null}>
          <MigrationStudioDialog
            onClose={() => setMigrationStudioOpen(false)}
            onCopyText={(text, label) => void copyMigrationText(text, label)}
            onPutTextInEditor={putMigrationTextInEditor}
          />
        </Suspense>
      ) : null}

      <AiGenerateDialog
        open={aiGenerateOpen}
        onClose={() => setAiGenerateOpen(false)}
        connectionId={activeConnectionId}
        engine={editorEngine}
        onInsert={(sql) => activeEditorApi()?.insertText(sql)}
        notify={showActionNotice}
      />

      {terminalOpen && (
        <div className="terminal-dock">
          <TerminalPanel onClose={() => setTerminalOpen(false)} />
        </div>
      )}

      {settingsOpen ? (
        <SettingsDialog
          settingsTab={settingsTab}
          onOpenSection={openSettingsSection}
          onClose={() => setSettingsOpen(false)}
          locale={locale}
          setLocale={setLocale}
          vimMode={vimMode}
          setVimMode={setVimMode}
          editorBackgroundImage={editorBackgroundImage}
          setEditorBackgroundImage={setEditorBackgroundImage}
          editorBackgroundOpacity={editorBackgroundOpacity}
          setEditorBackgroundOpacity={setEditorBackgroundOpacity}
          animationsEnabled={animationsEnabled}
          setAnimationsEnabled={setAnimationsEnabled}
          autoCommit={autoCommit}
          setAutoCommit={setAutoCommit}
          uiZoom={uiZoom}
          setUiZoom={setUiZoom}
          themePreference={themePreference}
          themeKind={themeKind}
          setThemePreference={activateThemePreference}
          setThemeKind={activateBuiltInTheme}
          activeDefaultThemeId={activeDefaultTheme?.id ?? activeDefaultThemeId}
          activeDefaultThemeName={activeDefaultTheme?.name ?? null}
          setActiveDefaultThemeId={activateDefaultTheme}
          customThemes={customThemes}
          activeCustomThemeId={activeCustomThemeId}
          activeCustomThemeName={activeCustomTheme?.name ?? null}
          setActiveCustomThemeId={activateCustomTheme}
          clearCustomTheme={() => activateBuiltInTheme(theme.kind)}
          formatter={formatter}
          setFormatter={setFormatter}
          sqlLinter={sqlLinter}
          setSqlLinter={setSqlLinter}
          sqlSnippets={sqlSnippets}
          setSqlSnippets={setSqlSnippets}
          resultOffloadEnabled={resultOffloadEnabled}
          setResultOffloadEnabled={setResultOffloadEnabled}
          resultMemoryBudget={resultMemoryBudget}
          setResultMemoryBudget={setResultMemoryBudget}
          queryHistoryMaxItems={queryHistoryMaxItems}
          setQueryHistoryMaxItems={setQueryHistoryMaxItems}
          queryHistoryResultRows={queryHistoryResultRows}
          setQueryHistoryResultRows={setQueryHistoryResultRows}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          commandCatalog={appCommandCatalog}
          keymap={keymap}
          keymapOverrides={keymapOverrides}
          keymapConflicts={keymapConflicts}
          vimKeymapConflicts={vimKeymapConflicts}
          recordingCommand={recordingCommand}
          recordingSequence={recordingSequence}
          runCommand={runCommand}
          beginRecording={beginRecording}
          resetKeybinding={resetKeybinding}
          applyVimKeybindingResolutions={applyVimKeybindingPlan}
          jobs={jobs}
          jobsLoading={jobsLoading}
          jobsError={jobsError}
          refreshJobs={refreshJobs}
          settingsJsonDraft={settingsJsonDraft}
          setSettingsJsonDraft={setSettingsJsonDraft}
          settingsJsonError={settingsJsonError}
          setSettingsJsonError={setSettingsJsonError}
          resetSettingsJsonDraft={resetSettingsJsonDraft}
          applySettingsJson={applySettingsJson}
        />
      ) : null}

      {aboutOpen ? (
        <AboutDialog
          appName={APP_NAME}
          appVersion={APP_VERSION}
          appIdentifier={APP_IDENTIFIER}
          runtimeLabel={
            tauriRuntimeError() ? "Browser preview" : "Tauri desktop"
          }
          activeConnectionLabel={`${activeConnection.name} \u00b7 ${
            activeConnectionOpen ? "connected" : "closed"
          }`}
          onClose={() => setAboutOpen(false)}
          onCopyDiagnostics={() => void copyAppDiagnostics()}
        />
      ) : null}

      {queryHistoryDialogOpen ? (
        <Suspense fallback={null}>
          <QueryHistoryDialog
            activeConnectionId={activeConnectionId}
            activeConnectionOpen={activeConnectionOpen}
            running={running}
            connectionById={connectionById}
            onLoad={loadHistoryItem}
            onRun={(item) => void runHistoryItem(item)}
            onRestoreResult={restoreHistoryResult}
          />
        </Suspense>
      ) : null}

      {pendingQueryParameters ? (
        <QueryParameterDialog
          pending={pendingQueryParameters}
          values={parameterDraftValues}
          onValuesChange={setParameterDraftValues}
          onClose={() => setPendingQueryParameters(null)}
          onSubmit={submitQueryParameters}
        />
      ) : null}

      {paletteOpen ? (
        <CommandPalette
          query={paletteQuery}
          commands={paletteResults}
          keymap={keymap}
          onQueryChange={setPaletteQuery}
          onRunCommand={runCommand}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}

      {importPreview ? (
        <ImportDialog
          preview={importPreview}
          sqlPreview={importSqlPreview}
          onPreviewChange={setImportPreview}
          onClose={() => {
            setImportPreview(null);
          }}
          onPutSqlInEditor={putImportSqlInEditor}
          formatCell={formatCell}
          formatCount={toCount}
        />
      ) : null}

      {schemaDesignerOpen ? (
        <SchemaDesignerDialog
          draft={schemaDraft}
          sqlPreview={schemaSqlPreview}
          onDraftChange={setSchemaDraft}
          onClose={() => setSchemaDesignerOpen(false)}
          onCopySql={() => void copySchemaSql()}
          onPutSqlInEditor={putSchemaSqlInEditor}
        />
      ) : null}

      {diagramOpen ? (
        <ErdDialog
          activeConnectionName={activeConnection.name}
          model={diagramModel}
          layout={diagramLayout}
          svgRef={diagramSvgRef}
          canvasRef={diagramCanvasRef}
          svgStyle={diagramSvgStyle}
          zoom={diagramZoom}
          search={diagramSearch}
          schemaNames={diagramSchemaNames}
          availableSchemas={availableDiagramSchemas}
          error={diagramError}
          metadataLoaded={Boolean(activeMetadata)}
          onClose={() => setDiagramOpen(false)}
          onFit={fitDiagramToViewport}
          onZoomChange={setDiagramZoom}
          onSearchChange={setDiagramSearch}
          onSchemaNamesChange={setDiagramSchemaNames}
          onCopySvg={copyDiagramSvg}
          onCopyPng={() => void copyDiagramPng()}
          onDownloadSvg={downloadDiagramSvg}
          onDownloadPng={() => void downloadDiagramPng()}
          onDownloadSpecMarkdown={downloadTableSpecMarkdown}
          onDownloadSpecJson={downloadTableSpecJson}
          onLoadSpecDdl={() => schemaSpecFileRef.current?.click()}
          onCreateDatabaseSql={createDatabaseSqlFromDiagram}
          onEditInDesigner={editDiagramInDesigner}
          onSelectTable={editDiagramTableColumns}
          onCopyMermaid={() => {
            if (activeMetadata) {
              void navigator.clipboard?.writeText(diagramMermaid);
            }
          }}
        />
      ) : null}

      {schemaDiagramOpen ? (
        <SchemaDiagramDialog
          onClose={closeSchemaDiagram}
          onPutSqlInEditor={putDiagramDesignerSqlInEditor}
          onCopySql={(sql) => void copyDiagramDesignerSql(sql)}
          onSeedFromDb={seedSchemaDiagramFromDb}
          canSeedFromDb={Boolean(activeMetadata && hasDiagram(activeMetadata))}
        />
      ) : null}

      <input
        ref={schemaSpecFileRef}
        type="file"
        accept=".json,.irodori-schema.json,application/json"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            void handleSchemaSpecFile(file);
          }
        }}
      />

      {workbenchConfirmElement}

      <ActionToastStack notices={actionNotices} onDismiss={dismissNotice} />
    </div>
  );
}
