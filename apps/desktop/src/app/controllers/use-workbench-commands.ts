import type { ShowActionNotice } from "@/app/ActionToast";
import { DOCS_URL } from "@/app/app-config";
import { formatUiZoom } from "@/app/app-workbench-utils";
import type { useEditorCommands } from "@/app/controllers/use-editor-commands";
import type { useEditorGroups } from "@/app/controllers/use-editor-groups";
import type { useErdDiagram } from "@/app/controllers/use-erd-diagram";
import type { useQueryRunner } from "@/app/controllers/use-query-runner";
import type { ResultGridWorkspace } from "@/app/controllers/use-result-grid-workspace";
import type { SettingsController } from "@/app/controllers/use-settings-controller";
import type { SidebarViews } from "@/app/controllers/use-sidebar-views";
import type { ThemeManager } from "@/app/controllers/use-theme-manager";
import type { WorkbenchConnections } from "@/app/controllers/use-workbench-connections";
import type { useWorkspaceActions } from "@/app/controllers/use-workspace-actions";
import {
  UI_ZOOM_DEFAULT,
  UI_ZOOM_STEP,
  normalizeUiZoom,
  usePreferencesStore,
} from "@/features/preferences";
import type { SqlEditorHandle } from "@/features/query-editor";
import { useSearchStore } from "@/features/search/search-store";
import { openExternalUrl } from "@/features/settings/tabs/shared";
import { checkAndOfferAppUpdate } from "@/features/updater/use-startup-update-check";
import { createWorkbenchCommandHandler } from "@/features/workbench";
import type { Translator } from "@/i18n";

type WorkbenchCommandsDeps = {
  grid: Pick<
    ResultGridWorkspace,
    | "editMode"
    | "setEditMode"
    | "setCommitError"
    | "addNewRow"
    | "undoLastEdit"
    | "commitEdits"
    | "canEditActiveResult"
    | "copySelectedGridCellOrRow"
    | "copySelectedGridRow"
    | "copyVisibleResult"
    | "exportActiveResult"
    | "copyActiveResultSqlInserts"
  >;
  editorCommands: Pick<
    ReturnType<typeof useEditorCommands>,
    | "runQuery"
    | "runCurrentQuery"
    | "runFromStartQuery"
    | "runAllQuery"
    | "explainCurrentQuery"
    | "formatQuery"
    | "showEditorQuickFix"
    | "cleanupQuery"
    | "indentEditorSelection"
    | "outdentEditorSelection"
    | "transformEditorSelection"
  >;
  editorGroups: Pick<
    ReturnType<typeof useEditorGroups>,
    "newSqlTab" | "closeActiveSqlTab" | "query"
  >;
  workspace: Pick<
    ReturnType<typeof useWorkspaceActions>,
    | "saveCurrentQuery"
    | "saveCurrentQueryAsFile"
    | "exitApplication"
    | "openAppDeveloperTools"
  >;
  sidebars: Pick<
    SidebarViews,
    | "setSidebarOpen"
    | "toggleSidebarView"
    | "setActiveSidebarView"
    | "openGitPanel"
  >;
  settings: Pick<SettingsController, "openSettingsSection">;
  themes: Pick<ThemeManager, "activateBuiltInTheme">;
  connections: Pick<WorkbenchConnections, "setConnectionManagerOpen">;
  erd: Pick<ReturnType<typeof useErdDiagram>, "setDiagramOpen">;
  queryRunner: Pick<ReturnType<typeof useQueryRunner>, "cancelQuery">;
  activeEditorApi: () => SqlEditorHandle | null;
  openQueryHistoryDialog: () => void;
  ui: {
    openPalette: () => void;
    openAbout: () => void;
    openMigrationStudio: () => void;
    openAiGenerate: () => void;
    toggleTerminal: () => void;
  };
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

// The single command surface behind the palette, menu bar, and keybindings:
// maps every command id onto the owning workspace hook.
export function useWorkbenchCommands({
  grid,
  editorCommands,
  editorGroups,
  workspace,
  sidebars,
  settings,
  themes,
  connections,
  erd,
  queryRunner,
  activeEditorApi,
  openQueryHistoryDialog,
  ui,
  showActionNotice,
  t,
}: WorkbenchCommandsDeps) {
  const uiZoom = usePreferencesStore((state) => state.uiZoom);
  const setUiZoom = usePreferencesStore((state) => state.setUiZoom);

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
    editMode: grid.editMode,
    openPalette: ui.openPalette,
    openSettings: () => settings.openSettingsSection("general"),
    openKeymap: () => settings.openSettingsSection("keymap"),
    openExtensions: () => settings.openSettingsSection("extensions"),
    checkForUpdates: () => void checkAndOfferAppUpdate(showActionNotice, t),
    openHistory: openQueryHistoryDialog,
    openGit: sidebars.openGitPanel,
    // There is no in-app help dialog; "Open Help" goes to the published docs,
    // the same target as About ▸ Documentation. It used to open About, which
    // made the Help menu's two entries do the same thing.
    openHelp: () => openExternalUrl(DOCS_URL),
    openAbout: ui.openAbout,
    openDeveloperTools: () => void workspace.openAppDeveloperTools(),
    openConnectionManager: () => connections.setConnectionManagerOpen(true),
    openMigrationStudio: ui.openMigrationStudio,
    openDiagram: () => erd.setDiagramOpen(true),
    toggleTheme: () =>
      themes.activateBuiltInTheme((kind) =>
        kind === "dark" ? "light" : "dark",
      ),
    toggleSidebar: () => sidebars.setSidebarOpen((open) => !open),
    toggleCompletion: () => sidebars.toggleSidebarView("completion"),
    toggleHistory: () => sidebars.toggleSidebarView("queryHistory"),
    togglePlan: () => sidebars.toggleSidebarView("plan"),
    toggleBi: () => sidebars.toggleSidebarView("bi"),
    zoomIn: () => updateUiZoom(uiZoom + UI_ZOOM_STEP),
    zoomOut: () => updateUiZoom(uiZoom - UI_ZOOM_STEP),
    zoomReset: () => updateUiZoom(UI_ZOOM_DEFAULT),
    newSqlTab: editorGroups.newSqlTab,
    closeActiveTab: editorGroups.closeActiveSqlTab,
    saveQuery: workspace.saveCurrentQuery,
    saveQueryAs: workspace.saveCurrentQueryAsFile,
    exitApp: workspace.exitApplication,
    runQuery: editorCommands.runQuery,
    runCurrentQuery: editorCommands.runCurrentQuery,
    runFromStartQuery: editorCommands.runFromStartQuery,
    runAllQuery: editorCommands.runAllQuery,
    explainPlan: () => editorCommands.explainCurrentQuery("plan"),
    explainAnalyze: () => editorCommands.explainCurrentQuery("analyze"),
    cancelQuery: queryRunner.cancelQuery,
    focusEditor: () => activeEditorApi()?.focus(),
    formatQuery: editorCommands.formatQuery,
    quickDefinition: () => activeEditorApi()?.quickDefinition(),
    showEditorQuickFix: editorCommands.showEditorQuickFix,
    cleanupQuery: editorCommands.cleanupQuery,
    toggleEditorComment: () => activeEditorApi()?.toggleComment(),
    indentEditorSelection: editorCommands.indentEditorSelection,
    outdentEditorSelection: editorCommands.outdentEditorSelection,
    transformEditorSelection: editorCommands.transformEditorSelection,
    exportCsv: () => grid.exportActiveResult("csv"),
    exportSqlInserts: () => grid.exportActiveResult("sql"),
    copySqlInserts: grid.copyActiveResultSqlInserts,
    copySelectedGridCellOrRow: grid.copySelectedGridCellOrRow,
    copySelectedGridRow: grid.copySelectedGridRow,
    copyVisibleResult: grid.copyVisibleResult,
    canEditActiveResult: grid.canEditActiveResult,
    setEditMode: grid.setEditMode,
    setCommitError: grid.setCommitError,
    addNewRow: grid.addNewRow,
    undoLastEdit: grid.undoLastEdit,
    commitEdits: grid.commitEdits,
    generateSql: ui.openAiGenerate,
    toggleTerminal: ui.toggleTerminal,
    toggleAiChat: () => sidebars.toggleSidebarView("aiChat"),
    toggleSearch: () => sidebars.toggleSidebarView("searchReplace"),
    toggleKnowledge: () => sidebars.toggleSidebarView("knowledge"),
    searchInAllTabs: () => {
      const selection = activeEditorApi()?.getSelection();
      const selected =
        selection && selection.to > selection.from
          ? editorGroups.query.slice(selection.from, selection.to)
          : "";
      useSearchStore.getState().openWith(selected);
      sidebars.setActiveSidebarView("searchReplace");
    },
  });

  return { runCommand };
}
