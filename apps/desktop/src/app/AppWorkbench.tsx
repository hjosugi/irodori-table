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
} from "@/app/app-config";
import { AboutDialog } from "@/app/AboutDialog";
import { EditorTabStrip } from "@/app/EditorTabStrip";
import type {
  ConnectionController,
  QueryEditorController,
} from "@/app/controllers/workbench-controllers";
import { useConnectionActions } from "@/app/controllers/use-connection-actions";
import { useEditorCommands } from "@/app/controllers/use-editor-commands";
import { useEditorGroups } from "@/app/controllers/use-editor-groups";
import { useErdDiagram } from "@/app/controllers/use-erd-diagram";
import { useHistoryActions } from "@/app/controllers/use-history-actions";
import { useKeybindingManager } from "@/app/controllers/use-keybinding-manager";
import { useResultGridWorkspace } from "@/app/controllers/use-result-grid-workspace";
import { useQueryRunner } from "@/app/controllers/use-query-runner";
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
  formatResultGridCell as formatCell,
  toCount,
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
import { formatKeySequence } from "@/core";
import type {
  DbEngine,
  QueryPlanAnalysis,
  WorkspaceSnapshot,
} from "@/generated/irodori-api";
import { cssVariables } from "@/theme";
import {
  NO_ACTIVE_CONNECTION,
  formatUiZoom,
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
  const [queryError, setQueryError] = useState<string | null>(null);
  const [planAnalysis, setPlanAnalysis] = useState<QueryPlanAnalysis | null>(
    null,
  );
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  // Remappable keybindings: overrides, chord resolution on a stable
  // window-level listener, and rebind recording live in the keybinding
  // manager. `runCommand` and the overlay closer are declared further down but
  // only invoked from event handlers, so the lazy closures are safe.
  const {
    keymap,
    keymapOverrides,
    replaceKeymapOverrides,
    activeKeyScope,
    syncScopeFromTarget,
    recordingCommand,
    recordingSequence,
    beginRecording,
    resetKeybinding,
    applyVimKeybindingPlan,
    keymapConflicts,
    vimKeymapConflicts,
  } = useKeybindingManager({
    runCommand: (commandId) => runCommand(commandId),
    closeTransientOverlays: () => closeTransientOverlaysFromEscape(),
    showActionNotice,
    t,
  });
  // Command palette (Ctrl/Cmd+Shift+P).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [migrationStudioOpen, setMigrationStudioOpen] = useState(false);
  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
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

  const grid = useResultGridWorkspace({
    uiZoom,
    query,
    editorEngine,
    activeEngine,
    activeMetadata,
    metadataByConnection,
    activeConnectionId,
    activeConnectionReadOnly,
    biOpen,
    activeEditorApi,
    runQuery: async () => {
      await editorCommandsRef.current?.runQuery();
    },
    setQueryError,
    confirm: confirmAction,
    showActionNotice,
    t,
  });
  const {
    setResult,
    setLastRunSql,
    resultOffloadEnabled,
    setResultOffloadEnabled,
    resultMemoryBudget,
    setResultMemoryBudget,
    gridRef,
    spillRef,
    setSpillInfo,
    clearPendingPages,
    bumpGridWindowVersion,
    setGridScrollTop,
    setGridScrollLeft,
    setSelectedRowKey,
    setSelectedCell,
    setSelectedRange,
    setResultMode,
    setTableViewObject,
    setActiveResultIndex,
    editMode,
    setEditMode,
    setCommitError,
    filtersOpen,
    setFiltersOpen,
    exportMenuOpen,
    setExportMenuOpen,
    activeResult,
    chartResultModel,
    chartAvailable,
    selectionStatus,
    resetEdits,
    resetGridView,
    releaseActiveSpill,
    addNewRow,
    undoLastEdit,
    commitEdits,
    canEditActiveResult,
    copySelectedGridCellOrRow,
    copySelectedGridRow,
    copyVisibleResult,
    exportActiveResult,
    copyActiveResultSqlInserts,
  } = grid;
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

  const paletteResults = appCommandCatalog.filter((command) =>
    `${command.title} ${command.category}`
      .toLowerCase()
      .includes(paletteQuery.trim().toLowerCase()),
  );

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


  const resultGridController = grid.buildResultGridController({
    running,
    queryError,
    importFileRef,
    shortcutTips: resultShortcutTips,
    formatObjectName: (object) => qualifiedObjectName(editorEngine, object),
    onImportFile: (file) => void handleImportFile(file),
  });

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
        onScopeFocus={(event) => syncScopeFromTarget(event.target, "global")}
        onScopeMouseDown={(event) =>
          syncScopeFromTarget(event.target, activeKeyScope)
        }
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
