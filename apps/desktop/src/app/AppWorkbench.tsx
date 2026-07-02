import {
  type CSSProperties,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryHistoryStore } from "@/features/query-history/query-history-store";
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
} from "@/app/app-config";
import { AboutDialog } from "@/app/AboutDialog";
import { EditorTabStrip } from "@/app/EditorTabStrip";
import { useResultGridScroll } from "@/app/hooks/useResultGridScroll";
import { useResultGridFiltering } from "@/app/hooks/useResultGridFiltering";
import { useResultGridSelection } from "@/app/hooks/useResultGridSelection";
import type {
  ConnectionController,
  QueryEditorController,
  ResultGridController,
} from "@/app/controllers/workbench-controllers";
import { useConnectionActions } from "@/app/controllers/use-connection-actions";
import { useEditorCommands } from "@/app/controllers/use-editor-commands";
import { useEditorGroups } from "@/app/controllers/use-editor-groups";
import { useErdDiagram } from "@/app/controllers/use-erd-diagram";
import { useHistoryActions } from "@/app/controllers/use-history-actions";
import { useQueryRunner } from "@/app/controllers/use-query-runner";
import { useResultExport } from "@/app/controllers/use-result-export";
import { useResultGridEditing } from "@/app/controllers/use-result-grid-editing";
import { useResultGridModel } from "@/app/controllers/use-result-grid-model";
import {
  usePendingResultChangesGuard,
  useResultGridSpillPaging,
} from "@/app/controllers/use-result-grid-runtime";
import { useSettingsController } from "@/app/controllers/use-settings-controller";
import { useSidebarViews } from "@/app/controllers/use-sidebar-views";
import { useThemeManager } from "@/app/controllers/use-theme-manager";
import { useWorkspaceActions } from "@/app/controllers/use-workspace-actions";
import { ActionToastStack, useActionNotices } from "@/app/ActionToast";
import { CommandPalette } from "@/app/CommandPalette";
import { useConfirm } from "@/components/ConfirmDialog";
import { GitPanel } from "@/features/git";
import {
  BiPanel,
  ResultsPane,
  WindowedRows,
  formatResultSelectionStatus,
  formatResultGridCell as formatCell,
  toCount,
  useResultGridStore,
  useResultsStore,
  type ResultExportFormat,
} from "@/features/results";
import {
  ConnectionManagerDialog,
  defaultConnectionColor,
  engineLabel,
  useConnectionStore,
  type WorkspaceConnection,
} from "@/features/connections";
import {
  QueryEditorPane,
  QueryParameterDialog,
  type EditorGroup,
  type EditorSelection,
  type SqlEditorHandle,
} from "@/features/query-editor";
import { ImportDialog } from "@/features/import";
import { ErdDialog, hasDiagram } from "@/features/erd";
import {
  SchemaDesignerDialog,
  useSchemaDesignerStore,
} from "@/features/schema-designer";
import { SchemaDiagramDialog } from "@/features/schema-diagram";
import { SettingsDialog } from "@/features/settings";
import { AiGenerateDialog } from "@/features/ai/AiGenerateDialog";
import { AiChatPanel } from "@/features/ai/chat/AiChatPanel";
import { SearchReplacePanel } from "@/features/search/SearchReplacePanel";
import { useSearchStore } from "@/features/search/search-store";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import {
  UI_ZOOM_DEFAULT,
  UI_ZOOM_STEP,
  normalizeUiZoom,
  usePreferencesStore,
} from "@/features/preferences";
import { createTranslator } from "@/i18n";
import {
  createWorkbenchCommandHandler,
  InspectorContent,
  LakehousePanel,
  PlanPanel,
  Sidebar,
  WorkbenchDockLayout,
  WorkbenchShell,
  completionHintsFromMetadata,
  createPanelResizeController,
  objectKindLabel,
  qualifiedObjectName,
  useWorkbenchStore,
  workbenchRuntimeService,
} from "@/features/workbench";
import {
  KEY_SEQUENCE_TIMEOUT_MS,
  applyVimKeybindingResolutions as applyVimKeybindingResolutionOverrides,
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
  QueryPlanAnalysis,
  QueryResult,
  WorkspaceSnapshot,
} from "@/generated/irodori-api";
import { cssVariables } from "@/theme";
import {
  GRID_COLUMN_WIDTH,
  GRID_GUTTER_WIDTH,
  GRID_ROW_HEIGHT,
  NO_ACTIVE_CONNECTION,
  formatUiZoom,
  isCellEditorClipboardShortcut,
  keyScopeFromTarget,
  scaledUiPixels,
  selectedSqlFromSelections,
  tauriRuntimeError,
  uiZoomStyleVariables,
} from "./app-workbench-utils";

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
  const editorApiRef = useRef<SqlEditorHandle>(null);
  const secondaryEditorApiRef = useRef<SqlEditorHandle>(null);
  const editorSplitRef = useRef<HTMLDivElement | null>(null);
  const editorCommandsRef = useRef<{ runQuery: () => Promise<void> } | null>(
    null,
  );
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
  const themes = useThemeManager();
  const {
    theme,
    themeKind,
    themePreference,
    activeDefaultTheme,
    activeDefaultThemeId,
    activeCustomTheme,
    activeCustomThemeId,
    customThemes,
    themeSwitching,
    activateBuiltInTheme,
    activateThemePreference,
    activateDefaultTheme,
    activateCustomTheme,
  } = themes;
  const vimMode = usePreferencesStore((state) => state.vimMode);
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
  const sidebars = useSidebarViews();
  const {
    sidebarOpen,
    setSidebarOpen,
    rightSidebarOpen,
    setRightSidebarOpen,
    leftSidebarViews,
    rightSidebarViews,
    activeLeftSidebarView,
    activeRightSidebarView,
    completionOpen,
    historyOpen,
    planOpen,
    biOpen,
    setActiveSidebarView,
    closeSidebarView,
    toggleSidebarView,
    toggleRightSidebar,
    openGitPanel,
  } = sidebars;
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
  function replaceKeymapOverrides(next: Keymap) {
    setKeymapOverrides(next);
    saveOverrides(next);
  }
  const [activeKeyScope, setActiveKeyScope] =
    useState<KeybindingScope>("global");
  const [recordingCommand, setRecordingCommand] = useState<string | null>(null);
  const [recordingSequence, setRecordingSequence] = useState<string[]>([]);
  // Command palette (Ctrl/Cmd+Shift+P).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [migrationStudioOpen, setMigrationStudioOpen] = useState(false);
  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const settings = useSettingsController({
    themes,
    keybindings: { keymapOverrides, replaceKeymapOverrides },
    showActionNotice,
    t,
  });
  const {
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    openSettingsSection,
    setVimMode,
    settingsJsonDraft,
    setSettingsJsonDraft,
    settingsJsonError,
    setSettingsJsonError,
    resetSettingsJsonDraft,
    applySettingsJson,
    jobs,
    jobsLoading,
    jobsError,
    refreshJobs,
    queryHistoryMaxItems,
    setQueryHistoryMaxItems,
    queryHistoryResultRows,
    setQueryHistoryResultRows,
  } = settings;
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
  const appendHistory = useQueryHistoryStore((state) => state.append);
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

  const erdDiagram = useErdDiagram({
    activeConnectionId,
    activeConnectionName: activeConnection.name,
    activeMetadata,
    theme,
    setQuery,
    activeEditorApi,
    openObjectSchemaDesigner,
    showActionNotice,
    t,
  });
  const {
    schemaSpecFileRef,
    diagramSvgRef,
    diagramCanvasRef,
    diagramOpen,
    setDiagramOpen,
    diagramError,
    diagramSearch,
    setDiagramSearch,
    diagramSchemaNames,
    setDiagramSchemaNames,
    diagramZoom,
    setDiagramZoom,
    schemaDiagramOpen,
    closeSchemaDiagram,
    availableDiagramSchemas,
    diagramModel,
    diagramLayout,
    diagramSvgStyle,
    openDiagramForSearch,
    downloadDiagramSvg,
    downloadDiagramPng,
    copyDiagramSvg,
    copyDiagramPng,
    downloadTableSpecMarkdown,
    downloadTableSpecJson,
    handleSchemaSpecFile,
    createDatabaseSqlFromDiagram,
    editDiagramTableColumns,
    openSchemaDiagramDesigner,
    editDiagramInDesigner,
    seedSchemaDiagramFromDb,
    putDiagramDesignerSqlInEditor,
    copyDiagramDesignerSql,
    fitDiagramToViewport,
    copyDiagramMermaid,
  } = erdDiagram;

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
    runQuery: async () => {
      await editorCommandsRef.current?.runQuery();
    },
    showActionNotice,
    confirm: confirmAction,
    t,
  });

  const { exportActiveResult, copyActiveResultSqlInserts, copyActiveResultAs } =
    useResultExport({
      activeResult,
      activeConnectionId,
      inferEditTarget,
      setExportMenuOpen,
      showActionNotice,
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

  const editorCommands = useEditorCommands({
    query,
    activeResult,
    activeConnectionId,
    activeConnectionOpen,
    activeMetadata,
    activeMetadataLoading,
    formatter,
    activeEditorApi,
    activeEditorSelections,
    activeMainEditorSelection,
    setQuery,
    setQueryError,
    setRunMenuOpen,
    runEditorSqlWithRunner,
    runSqlWithParameterPrompt,
    openQueryParameterPrompt,
    explainSql,
    refreshObjects,
    openDiagramForSearch,
    exportActiveResult,
    showActionNotice,
    t,
  });
  editorCommandsRef.current = { runQuery: editorCommands.runQuery };
  const {
    formatQuery,
    showEditorQuickFix,
    cleanupQuery,
    transformEditorSelection,
    indentEditorSelection,
    outdentEditorSelection,
    runQuery,
    copyPlanFormat,
    runSelectionQuery,
    runCurrentQuery,
    explainCurrentQuery,
    runFromStartQuery,
    runAllQuery,
    runEditorSql,
  } = editorCommands;

  const { loadHistoryItem, runHistoryItem, restoreHistoryResult } =
    useHistoryActions({
      activeConnectionId,
      setActiveConnectionId,
      setQuery,
      closeQueryHistoryDialog,
      activeEditorApi,
      runEditorSql,
      releaseActiveSpill,
      setResult,
      setLastRunSql,
      setQueryError,
      setResultMode,
      setTableViewObject,
      setActiveResultIndex,
      resetEdits,
      resetGridView,
      setSelectedRowKey,
      setSelectedCell,
      setSelectedRange,
      showActionNotice,
      t,
    });

  const workspaceActions = useWorkspaceActions({
    query,
    activeTabLabel,
    activeConnectionId,
    activeConnectionOpen,
    activeEngine,
    editorEngine,
    themeKind: theme.kind,
    schemaDraft,
    setQuery,
    setMigrationStudioOpen,
    setSchemaDesignerOpen,
    setObjectActionMenu,
    setTableViewObject,
    setResultMode,
    activeEditorApi,
    executeQuery,
    openObjectSchemaDesigner,
    openDiagramForSearch,
    showActionNotice,
    t,
  });
  const {
    importPreview,
    setImportPreview,
    importSqlPreview,
    schemaSqlPreview,
    handleImportFile,
    putImportSqlInEditor,
    putMigrationTextInEditor,
    copyMigrationText,
    openTableData,
    openSnapshotObject,
    showObjectInDiagram,
    jumpToSqlMetadata,
    putSchemaSqlInEditor,
    copySchemaSql,
    insertCompletionHint,
    saveCurrentQuery,
    saveCurrentQueryAsFile,
    exitApplication,
    copyAppDiagnostics,
    openAppDeveloperTools,
  } = workspaceActions;

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

  const appStyle = useMemo(
    () =>
      ({
        ...cssVariables(theme),
        ...uiZoomStyleVariables(uiZoom),
      }) as CSSProperties,
    [theme, uiZoom],
  );

  function renderEditorTabStrip(group: EditorGroup) {
    return (
      <EditorTabStrip
        group={group}
        state={editorGroupStates[group]}
        menu={editorTabMenu}
        onSelectTab={selectEditorTab}
        onOpenMenu={setEditorTabMenu}
        onCloseMenu={() => setEditorTabMenu(null)}
        onNewTab={newSqlTab}
        onRenameTab={renameSqlTab}
        onDuplicateTab={duplicateSqlTab}
        onCloseTab={closeSqlTab}
        onCloseOtherTabs={closeOtherSqlTabs}
        onReopenClosedTab={reopenSqlTab}
      />
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
          onCopyMermaid={() => void copyDiagramMermaid()}
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
