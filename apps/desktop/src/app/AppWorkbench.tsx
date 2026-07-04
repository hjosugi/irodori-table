import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryHistoryStore } from "@/features/query-history/query-history-store";
import {
  APP_NAME,
  appMenuCommandCatalog,
  menuBarSections,
} from "@/app/app-config";
import { WorkbenchDialogs } from "@/app/WorkbenchDialogs";
import { WorkbenchSidebar } from "@/app/WorkbenchSidebar";
import { useEditorCommands } from "@/app/controllers/use-editor-commands";
import { useEditorWorkspace } from "@/app/controllers/use-editor-workspace";
import { useErdDiagram } from "@/app/controllers/use-erd-diagram";
import { useHistoryActions } from "@/app/controllers/use-history-actions";
import { useKeybindingManager } from "@/app/controllers/use-keybinding-manager";
import { useWorkbenchConnections } from "@/app/controllers/use-workbench-connections";
import { useWorkbenchCommands } from "@/app/controllers/use-workbench-commands";
import { useResultGridWorkspace } from "@/app/controllers/use-result-grid-workspace";
import { useQueryRunner } from "@/app/controllers/use-query-runner";
import { useSettingsController } from "@/app/controllers/use-settings-controller";
import { useSidebarViews } from "@/app/controllers/use-sidebar-views";
import { useThemeManager } from "@/app/controllers/use-theme-manager";
import { useWorkspaceActions } from "@/app/controllers/use-workspace-actions";
import { ActionToastStack, useActionNotices } from "@/app/ActionToast";
import { useConfirm } from "@/components/ConfirmDialog";
import { ResultsPane } from "@/features/results";
import { QueryEditorPane } from "@/features/query-editor";
import { useSchemaDesignerStore } from "@/features/schema-designer";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
import {
  WorkbenchDockLayout,
  WorkbenchShell,
  createPanelResizeController,
  qualifiedObjectName,
  useWorkbenchStore,
} from "@/features/workbench";
import type { QueryPlanAnalysis } from "@/generated/irodori-api";
import { cssVariables } from "@/theme";
import {
  uiZoomStyleVariables,
} from "./app-workbench-utils";

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
  const editorCommandsRef = useRef<{ runQuery: () => Promise<void> } | null>(
    null,
  );
  const {
    notices: actionNotices,
    showActionNotice,
    dismissNotice,
  } = useActionNotices();
  // Workbench-level confirmation dialog, shared by controllers that gate
  // destructive actions (delete commits, discard-and-reload).
  const { confirm: confirmAction, confirmElement: workbenchConfirmElement } =
    useConfirm();
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = useMemo(() => createTranslator(locale), [locale]);
  const workbenchConnections = useWorkbenchConnections({
    showActionNotice,
    t,
  });
  const {
    activeConnectionId,
    setActiveConnectionId,
    connections,
    connectionById,
    profileById,
    activeConnection,
    activeConnectionOpen,
    activeConnectionReadOnly,
    activeEngine,
    activeConnectionColor,
    activeConnectionStatus,
    activeTransportLabel,
    activeMetadata,
    activeMetadataLoading,
    activeMetadataError,
    metadataByConnection,
    connectedIds,
    objectActionMenu,
    setObjectActionMenu,
    setConnectionManagerOpen,
    editorEngine,
    completionHints,
    connectionActions,
    connectionController,
  } = workbenchConnections;
  const { refreshObjects } = connectionActions;
  const themes = useThemeManager();
  const { theme, themeSwitching } = themes;
  const vimMode = usePreferencesStore((state) => state.vimMode);
  const formatter = usePreferencesStore((state) => state.formatter);
  const sqlLinter = usePreferencesStore((state) => state.sqlLinter);
  const animationsEnabled = usePreferencesStore(
    (state) => state.animationsEnabled,
  );
  const uiZoom = usePreferencesStore((state) => state.uiZoom);
  const sidebars = useSidebarViews();
  const {
    sidebarOpen,
    setSidebarOpen,
    rightSidebarOpen,
    completionOpen,
    historyOpen,
    planOpen,
    biOpen,
    setActiveSidebarView,
    toggleRightSidebar,
  } = sidebars;
  const sidebarWidth = useWorkbenchStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkbenchStore((state) => state.setSidebarWidth);
  const inspectorWidth = useWorkbenchStore((state) => state.inspectorWidth);
  const setInspectorWidth = useWorkbenchStore(
    (state) => state.setInspectorWidth,
  );
  const resultsHeight = useWorkbenchStore((state) => state.resultsHeight);
  const setResultsHeight = useWorkbenchStore((state) => state.setResultsHeight);
  const editorSplitPercent = useWorkbenchStore(
    (state) => state.editorSplitPercent,
  );
  const setEditorSplitPercent = useWorkbenchStore(
    (state) => state.setEditorSplitPercent,
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
  const keybindings = useKeybindingManager({
    runCommand: (commandId) => runCommand(commandId),
    closeTransientOverlays: () => closeTransientOverlaysFromEscape(),
    showActionNotice,
    t,
  });
  const { keymap, activeKeyScope, syncScopeFromTarget } = keybindings;
  const editor = useEditorWorkspace({ keymap, showActionNotice, t });
  const {
    editorGroups,
    query,
    setQuery,
    activeTabLabel,
    editorSplitMode,
    editorSplitRef,
    runMenuOpen,
    setRunMenuOpen,
    activeEditorApi,
    activeEditorSelections,
    activeMainEditorSelection,
    resultShortcutTips,
  } = editor;
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
  // Command palette (Ctrl/Cmd+Shift+P).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [migrationStudioOpen, setMigrationStudioOpen] = useState(false);
  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const settings = useSettingsController({
    themes,
    keybindings,
    showActionNotice,
    t,
  });
  const { queryHistoryResultRows } = settings;
  const setSchemaDesignerOpen = useSchemaDesignerStore(
    (state) => state.setOpen,
  );
  const schemaDraft = useSchemaDesignerStore((state) => state.draft);
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
  const { openDiagramForSearch } = erdDiagram;

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
    resultMemoryBudget,
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
    filtersOpen,
    setFiltersOpen,
    exportMenuOpen,
    setExportMenuOpen,
    activeResult,
    selectionStatus,
    resetEdits,
    resetGridView,
    releaseActiveSpill,
    exportActiveResult,
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

  const queryRunner = useQueryRunner({
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
  const {
    running,
    runEditorSql: runEditorSqlWithRunner,
    runSqlWithParameterPrompt,
    openQueryParameterPrompt,
    executeQuery,
    cancelQuery,
    explainSql,
  } = queryRunner;

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
  const { runEditorSql } = editorCommands;

  const historyActions = useHistoryActions({
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
  const { handleImportFile } = workspaceActions;

  const { runCommand } = useWorkbenchCommands({
    grid,
    editorCommands,
    editorGroups,
    workspace: workspaceActions,
    sidebars,
    settings,
    themes,
    connections: workbenchConnections,
    erd: erdDiagram,
    queryRunner,
    activeEditorApi,
    openQueryHistoryDialog,
    ui: {
      openPalette: () => {
        setPaletteQuery("");
        setPaletteOpen(true);
      },
      openAbout: () => setAboutOpen(true),
      openMigrationStudio: () => setMigrationStudioOpen(true),
      openAiGenerate: () => setAiGenerateOpen(true),
      toggleTerminal: () => setTerminalOpen((open) => !open),
    },
    showActionNotice,
    t,
  });

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

  function renderSidebar(side: "left" | "right") {
    return (
      <WorkbenchSidebar
        side={side}
        sidebars={sidebars}
        erd={erdDiagram}
        workspace={workspaceActions}
        grid={grid}
        editorCommands={editorCommands}
        editorGroups={editorGroups}
        connectionActions={connectionActions}
        plan={{
          analysis: planAnalysis,
          loading: planLoading,
          error: planError,
        }}
        connections={connections}
        connectionById={connectionById}
        profileById={profileById}
        activeConnection={activeConnection}
        activeConnectionId={activeConnectionId}
        activeConnectionOpen={activeConnectionOpen}
        activeMetadata={activeMetadata}
        activeMetadataLoading={activeMetadataLoading}
        activeMetadataError={activeMetadataError}
        connectedIds={connectedIds}
        objectActionMenu={objectActionMenu}
        setObjectActionMenu={setObjectActionMenu}
        setConnectionManagerOpen={setConnectionManagerOpen}
        openBlankSchemaDesigner={openBlankSchemaDesigner}
        openObjectSchemaDesigner={openObjectSchemaDesigner}
        completionHints={completionHints}
        importFileRef={importFileRef}
        editorEngine={editorEngine}
        activeEditorApi={activeEditorApi}
        beginPanelResize={beginPanelResize}
        onPanelResizeKey={onPanelResizeKey}
        showActionNotice={showActionNotice}
      />
    );
  }

  const queryEditorController = editor.buildQueryEditorController({
    running,
    resultActionsAvailable: Boolean(activeResult),
    theme,
    activeMetadata,
    editorEngine,
    runCommand,
    editorCommands,
    workspace: workspaceActions,
    cancelQuery,
    beginPanelResize,
    onPanelResizeKey,
  });

  const resultGridController = grid.buildResultGridController({
    running,
    queryError,
    importFileRef,
    shortcutTips: resultShortcutTips,
    formatObjectName: (object) => qualifiedObjectName(editorEngine, object),
    onImportFile: (file) => void handleImportFile(file),
  });

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

      <WorkbenchDialogs
        themes={themes}
        settings={settings}
        erd={erdDiagram}
        workspace={workspaceActions}
        keybindings={keybindings}
        queryRunner={queryRunner}
        historyActions={historyActions}
        connectionController={connectionController}
        connectionById={connectionById}
        activeConnection={activeConnection}
        activeConnectionId={activeConnectionId}
        activeConnectionOpen={activeConnectionOpen}
        activeMetadata={activeMetadata}
        editorEngine={editorEngine}
        activeEditorApi={activeEditorApi}
        runCommand={runCommand}
        paletteOpen={paletteOpen}
        paletteQuery={paletteQuery}
        setPaletteQuery={setPaletteQuery}
        closePalette={() => setPaletteOpen(false)}
        aboutOpen={aboutOpen}
        closeAbout={() => setAboutOpen(false)}
        migrationStudioOpen={migrationStudioOpen}
        closeMigrationStudio={() => setMigrationStudioOpen(false)}
        aiGenerateOpen={aiGenerateOpen}
        closeAiGenerate={() => setAiGenerateOpen(false)}
        terminalOpen={terminalOpen}
        closeTerminal={() => setTerminalOpen(false)}
        showActionNotice={showActionNotice}
      />

      {workbenchConfirmElement}

      <ActionToastStack notices={actionNotices} onDismiss={dismissNotice} />
    </div>
  );
}
