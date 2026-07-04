import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useActionNotices } from "@/app/ActionToast";
import { uiZoomStyleVariables } from "@/app/app-workbench-utils";
import { useEditorCommands } from "@/app/controllers/use-editor-commands";
import { useEditorWorkspace } from "@/app/controllers/use-editor-workspace";
import { useErdDiagram } from "@/app/controllers/use-erd-diagram";
import { useHistoryActions } from "@/app/controllers/use-history-actions";
import { useKeybindingManager } from "@/app/controllers/use-keybinding-manager";
import { useQueryRunner } from "@/app/controllers/use-query-runner";
import { useResultGridWorkspace } from "@/app/controllers/use-result-grid-workspace";
import { useSettingsController } from "@/app/controllers/use-settings-controller";
import { useSidebarViews } from "@/app/controllers/use-sidebar-views";
import { useThemeManager } from "@/app/controllers/use-theme-manager";
import { useWorkbenchCommands } from "@/app/controllers/use-workbench-commands";
import { useWorkbenchConnections } from "@/app/controllers/use-workbench-connections";
import { useWorkbenchOverlays } from "@/app/controllers/use-workbench-overlays";
import { useWorkspaceActions } from "@/app/controllers/use-workspace-actions";
import { useConfirm } from "@/components/ConfirmDialog";
import { usePreferencesStore } from "@/features/preferences";
import { useQueryHistoryStore } from "@/features/query-history/query-history-store";
import { useSchemaDesignerStore } from "@/features/schema-designer";
import {
  createPanelResizeController,
  qualifiedObjectName,
  useWorkbenchStore,
} from "@/features/workbench";
import type { QueryPlanAnalysis } from "@/generated/irodori-api";
import { createTranslator } from "@/i18n";
import { cssVariables } from "@/theme";

// Suppress the native context menu everywhere; the workbench renders its own.
function useNativeContextMenuSuppression() {
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
}

// The workbench composition root. Every domain controller is created and
// cross-wired here, in dependency order, and nowhere else; views receive the
// finished `Workbench` object through WorkbenchProvider and never wire
// controllers together themselves.
//
// Reading order mirrors the dependency chain:
//   notices/confirm/i18n -> connections -> keybindings -> editor -> grid ->
//   query runner -> editor commands -> history/workspace actions -> commands.
export function useWorkbench() {
  useNativeContextMenuSuppression();

  // Cross-cutting services: toasts, the shared confirm dialog, i18n.
  const {
    notices: actionNotices,
    showActionNotice,
    dismissNotice,
  } = useActionNotices();
  // Workbench-level confirmation dialog, shared by controllers that gate
  // destructive actions (delete commits, discard-and-reload).
  const { confirm: confirmAction, confirmElement } = useConfirm();
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = useMemo(() => createTranslator(locale), [locale]);
  const uiZoom = usePreferencesStore((state) => state.uiZoom);
  const formatter = usePreferencesStore((state) => state.formatter);

  // Domain controllers with no dependencies on other controllers.
  const themes = useThemeManager();
  const sidebars = useSidebarViews();
  const overlays = useWorkbenchOverlays();
  const connections = useWorkbenchConnections({ showActionNotice, t });
  const {
    activeConnectionId,
    activeConnection,
    activeConnectionOpen,
    activeConnectionReadOnly,
    activeEngine,
    activeMetadata,
    activeMetadataLoading,
    metadataByConnection,
    setActiveConnectionId,
    setObjectActionMenu,
    editorEngine,
    connectionActions,
  } = connections;

  // Feature stores the wiring below needs; views subscribe on their own.
  const setSchemaDesignerOpen = useSchemaDesignerStore(
    (state) => state.setOpen,
  );
  const schemaDraft = useSchemaDesignerStore((state) => state.draft);
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

  // Query-plan panel state, fed by the query runner and read by the sidebar.
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
  const { keymap } = keybindings;

  const editor = useEditorWorkspace({ keymap, showActionNotice, t });
  const { query, setQuery, activeEditorApi } = editor;

  // Dock layout dimensions plus the drag/keyboard resize controller.
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
  const { beginPanelResize, onPanelResizeKey } = createPanelResizeController({
    sidebarWidth,
    inspectorWidth,
    resultsHeight,
    editorSplitMode: editor.editorSplitMode,
    editorSplitRef: editor.editorSplitRef,
    setSidebarWidth,
    setInspectorWidth,
    setResultsHeight,
    setEditorSplitPercent,
  });

  const settings = useSettingsController({
    themes,
    keybindings,
    showActionNotice,
    t,
  });

  const erd = useErdDiagram({
    activeConnectionId,
    activeConnectionName: activeConnection.name,
    activeMetadata,
    theme: themes.theme,
    setQuery,
    activeEditorApi,
    openObjectSchemaDesigner,
    showActionNotice,
    t,
  });

  // The grid needs to re-run the current query (edit commits, refresh), but
  // editor commands are created after the grid; bridge with a ref.
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const editorCommandsRef = useRef<{ runQuery: () => Promise<void> } | null>(
    null,
  );
  const grid = useResultGridWorkspace({
    uiZoom,
    query,
    editorEngine,
    activeEngine,
    activeMetadata,
    metadataByConnection,
    activeConnectionId,
    activeConnectionReadOnly,
    biOpen: sidebars.biOpen,
    activeEditorApi,
    runQuery: async () => {
      await editorCommandsRef.current?.runQuery();
    },
    setQueryError,
    confirm: confirmAction,
    showActionNotice,
    t,
  });

  const queryRunner = useQueryRunner({
    activeConnectionId,
    activeConnectionOpen,
    activeConnectionReadOnly,
    activeConnectionName: activeConnection.name,
    activeConnectionEngine: activeEngine,
    activeEngine,
    resultOffloadEnabled: grid.resultOffloadEnabled,
    resultMemoryBudget: grid.resultMemoryBudget,
    queryHistoryResultRows: settings.queryHistoryResultRows,
    appendHistory,
    setResult: grid.setResult,
    setQueryError,
    setLastRunSql: grid.setLastRunSql,
    setPlanAnalysis,
    setPlanLoading,
    setPlanError,
    setResultMode: grid.setResultMode,
    setTableViewObject: grid.setTableViewObject,
    setActiveResultIndex: grid.setActiveResultIndex,
    resetEdits: grid.resetEdits,
    resetGridView: grid.resetGridView,
    releaseActiveSpill: grid.releaseActiveSpill,
    gridRef: grid.gridRef,
    setGridScrollTop: grid.setGridScrollTop,
    setGridScrollLeft: grid.setGridScrollLeft,
    setSelectedRowKey: grid.setSelectedRowKey,
    setSelectedCell: grid.setSelectedCell,
    setSelectedRange: grid.setSelectedRange,
    spillRef: grid.spillRef,
    clearPendingPages: grid.clearPendingPages,
    setSpillInfo: grid.setSpillInfo,
    bumpGridWindowVersion: grid.bumpGridWindowVersion,
    refreshObjects: connectionActions.refreshObjects,
    openPlanPanel: () => sidebars.setActiveSidebarView("plan"),
    showActionNotice,
    t,
  });

  const editorCommands = useEditorCommands({
    query,
    activeResult: grid.activeResult,
    activeConnectionId,
    activeConnectionOpen,
    activeMetadata,
    activeMetadataLoading,
    formatter,
    activeEditorApi,
    activeEditorSelections: editor.activeEditorSelections,
    activeMainEditorSelection: editor.activeMainEditorSelection,
    setQuery,
    setQueryError,
    setRunMenuOpen: editor.setRunMenuOpen,
    runEditorSqlWithRunner: queryRunner.runEditorSql,
    runSqlWithParameterPrompt: queryRunner.runSqlWithParameterPrompt,
    openQueryParameterPrompt: queryRunner.openQueryParameterPrompt,
    explainSql: queryRunner.explainSql,
    refreshObjects: connectionActions.refreshObjects,
    openDiagramForSearch: erd.openDiagramForSearch,
    exportActiveResult: grid.exportActiveResult,
    showActionNotice,
    t,
  });
  editorCommandsRef.current = { runQuery: editorCommands.runQuery };

  const historyActions = useHistoryActions({
    activeConnectionId,
    setActiveConnectionId,
    setQuery,
    closeQueryHistoryDialog,
    activeEditorApi,
    runEditorSql: editorCommands.runEditorSql,
    releaseActiveSpill: grid.releaseActiveSpill,
    setResult: grid.setResult,
    setLastRunSql: grid.setLastRunSql,
    setQueryError,
    setResultMode: grid.setResultMode,
    setTableViewObject: grid.setTableViewObject,
    setActiveResultIndex: grid.setActiveResultIndex,
    resetEdits: grid.resetEdits,
    resetGridView: grid.resetGridView,
    setSelectedRowKey: grid.setSelectedRowKey,
    setSelectedCell: grid.setSelectedCell,
    setSelectedRange: grid.setSelectedRange,
    showActionNotice,
    t,
  });

  const workspace = useWorkspaceActions({
    query,
    activeTabLabel: editor.activeTabLabel,
    activeConnectionId,
    activeConnectionOpen,
    activeEngine,
    editorEngine,
    themeKind: themes.theme.kind,
    schemaDraft,
    setQuery,
    setMigrationStudioOpen: overlays.setMigrationStudioOpen,
    setSchemaDesignerOpen,
    setObjectActionMenu,
    setTableViewObject: grid.setTableViewObject,
    setResultMode: grid.setResultMode,
    activeEditorApi,
    executeQuery: queryRunner.executeQuery,
    openObjectSchemaDesigner,
    openDiagramForSearch: erd.openDiagramForSearch,
    showActionNotice,
    t,
  });

  // The single command surface behind the palette, menu bar, and keybindings.
  const { runCommand } = useWorkbenchCommands({
    grid,
    editorCommands,
    editorGroups: editor.editorGroups,
    workspace,
    sidebars,
    settings,
    themes,
    connections,
    erd,
    queryRunner,
    activeEditorApi,
    openQueryHistoryDialog,
    ui: {
      openPalette: overlays.openPalette,
      openAbout: overlays.openAbout,
      openMigrationStudio: overlays.openMigrationStudio,
      openAiGenerate: overlays.openAiGenerate,
      toggleTerminal: overlays.toggleTerminal,
    },
    showActionNotice,
    t,
  });

  // Escape closes whichever transient menu/popup is open; the ref keeps the
  // stable keybinding listener reading current values without re-binding.
  const transientOverlayStateRef = useRef({
    workspaceMenuOpen: false,
    runMenuOpen: false,
    exportMenuOpen: false,
    filtersOpen: false,
    objectActionMenu: null as string | null,
  });
  transientOverlayStateRef.current = {
    workspaceMenuOpen: overlays.workspaceMenuOpen,
    runMenuOpen: editor.runMenuOpen,
    exportMenuOpen: grid.exportMenuOpen,
    filtersOpen: grid.filtersOpen,
    objectActionMenu: connections.objectActionMenu,
  };
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
    overlays.setWorkspaceMenuOpen(false);
    editor.setRunMenuOpen(false);
    grid.setExportMenuOpen(false);
    grid.setFiltersOpen(false);
    setObjectActionMenu(null);
    return true;
  }

  // Finished prop bundles for the two center panes.
  const queryEditorController = editor.buildQueryEditorController({
    running: queryRunner.running,
    resultActionsAvailable: Boolean(grid.activeResult),
    theme: themes.theme,
    activeMetadata,
    editorEngine,
    runCommand,
    editorCommands,
    workspace,
    cancelQuery: queryRunner.cancelQuery,
    beginPanelResize,
    onPanelResizeKey,
  });
  const resultGridController = grid.buildResultGridController({
    running: queryRunner.running,
    queryError,
    importFileRef,
    shortcutTips: editor.resultShortcutTips,
    formatObjectName: (object) => qualifiedObjectName(editorEngine, object),
    onImportFile: (file) => void workspace.handleImportFile(file),
  });

  const appStyle = useMemo(
    () =>
      ({
        ...cssVariables(themes.theme),
        ...uiZoomStyleVariables(uiZoom),
      }) as CSSProperties,
    [themes.theme, uiZoom],
  );

  return {
    // Cross-cutting services.
    t,
    appStyle,
    notices: { list: actionNotices, show: showActionNotice, dismiss: dismissNotice },
    confirmElement,
    // Domain controllers, one per workspace concern.
    connections,
    themes,
    sidebars,
    overlays,
    keybindings,
    editor,
    grid,
    queryRunner,
    editorCommands,
    historyActions,
    workspace,
    erd,
    settings,
    // Cross-domain surfaces produced by the wiring above.
    runCommand,
    plan: { analysis: planAnalysis, loading: planLoading, error: planError },
    layout: {
      sidebarWidth,
      inspectorWidth,
      resultsHeight,
      editorSplitPercent,
      beginPanelResize,
      onPanelResizeKey,
    },
    importFileRef,
    queryEditorController,
    resultGridController,
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;
