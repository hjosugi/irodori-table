import { useRef } from "react";
import type { ShowActionNotice } from "@/app/ActionToast";
import type { EditorWorkspace } from "@/app/controllers/use-editor-workspace";
import type { useErdDiagram } from "@/app/controllers/use-erd-diagram";
import type { QueryWorkspace } from "@/app/controllers/use-query-workspace";
import type { SettingsController } from "@/app/controllers/use-settings-controller";
import type { SidebarViews } from "@/app/controllers/use-sidebar-views";
import type { ThemeManager } from "@/app/controllers/use-theme-manager";
import { useWorkbenchCommands } from "@/app/controllers/use-workbench-commands";
import type { WorkbenchConnections } from "@/app/controllers/use-workbench-connections";
import type { WorkbenchLayout } from "@/app/controllers/use-workbench-layout";
import type { WorkbenchOverlays } from "@/app/controllers/use-workbench-overlays";
import { useWorkspaceActions } from "@/app/controllers/use-workspace-actions";
import { useQueryHistoryStore } from "@/features/query-history/query-history-store";
import { useSchemaDesignerStore } from "@/features/schema-designer";
import { qualifiedObjectName } from "@/features/workbench";
import type { Translator } from "@/i18n";

type WorkbenchActionsDeps = {
  connections: WorkbenchConnections;
  editor: EditorWorkspace;
  themes: ThemeManager;
  overlays: WorkbenchOverlays;
  sidebars: SidebarViews;
  settings: SettingsController;
  erd: ReturnType<typeof useErdDiagram>;
  queryWorkspace: QueryWorkspace;
  layout: WorkbenchLayout;
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

// The action surface on top of the domains: workspace-level actions
// (save/import/export, schema designer glue), the single runCommand handler
// behind palette/menu/keys, the Escape handler for transient menus, and the
// finished prop bundles for the two center panes.
export function useWorkbenchActions({
  connections,
  editor,
  themes,
  overlays,
  sidebars,
  settings,
  erd,
  queryWorkspace,
  layout,
  showActionNotice,
  t,
}: WorkbenchActionsDeps) {
  const { grid, queryRunner, editorCommands, queryError, importFileRef } =
    queryWorkspace;
  const setSchemaDesignerOpen = useSchemaDesignerStore(
    (state) => state.setOpen,
  );
  const schemaDraft = useSchemaDesignerStore((state) => state.draft);
  const openObjectSchemaDesigner = useSchemaDesignerStore(
    (state) => state.openForObject,
  );
  const openQueryHistoryDialog = useQueryHistoryStore(
    (state) => state.openDialog,
  );

  const workspace = useWorkspaceActions({
    query: editor.query,
    activeTabLabel: editor.activeTabLabel,
    activeConnectionId: connections.activeConnectionId,
    activeConnectionOpen: connections.activeConnectionOpen,
    activeEngine: connections.activeEngine,
    editorEngine: connections.editorEngine,
    themeKind: themes.theme.kind,
    schemaDraft,
    setQuery: editor.setQuery,
    setMigrationStudioOpen: overlays.setMigrationStudioOpen,
    setSchemaDesignerOpen,
    setObjectActionMenu: connections.setObjectActionMenu,
    setTableViewObject: grid.setTableViewObject,
    setResultMode: grid.setResultMode,
    activeEditorApi: editor.activeEditorApi,
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
    activeEditorApi: editor.activeEditorApi,
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
    connections.setObjectActionMenu(null);
    return true;
  }

  // Finished prop bundles for the two center panes.
  const queryEditorController = editor.buildQueryEditorController({
    running: queryRunner.running,
    resultActionsAvailable: Boolean(grid.activeResult),
    theme: themes.theme,
    activeMetadata: connections.activeMetadata,
    editorEngine: connections.editorEngine,
    runCommand,
    editorCommands,
    workspace,
    cancelQuery: queryRunner.cancelQuery,
    beginPanelResize: layout.beginPanelResize,
    onPanelResizeKey: layout.onPanelResizeKey,
  });
  const resultGridController = grid.buildResultGridController({
    running: queryRunner.running,
    queryError,
    importFileRef,
    shortcutTips: editor.resultShortcutTips,
    formatObjectName: (object) =>
      qualifiedObjectName(connections.editorEngine, object),
    onImportFile: (file) => void workspace.handleImportFile(file),
  });

  return {
    workspace,
    runCommand,
    closeTransientOverlaysFromEscape,
    queryEditorController,
    resultGridController,
  };
}

export type WorkbenchActions = ReturnType<typeof useWorkbenchActions>;
