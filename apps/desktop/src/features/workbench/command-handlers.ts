import type { SqlEditorTransformAction } from "@/sql/editor-transforms";

type WorkbenchCommandHandlerDeps = {
  editMode: boolean;
  openPalette: () => void;
  openSettings: () => void;
  openKeymap: () => void;
  openHistory: () => void;
  openGit: () => void;
  openHelp: () => void;
  openDeveloperTools: () => void;
  openConnectionManager: () => void;
  openMigrationStudio: () => void;
  openDiagram: () => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  toggleCompletion: () => void;
  toggleHistory: () => void;
  togglePlan: () => void;
  toggleBi: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  newSqlTab: () => void;
  closeActiveTab: () => void;
  saveQuery: () => void;
  saveQueryAs: () => void;
  exitApp: () => Promise<void>;
  runQuery: () => Promise<void>;
  runCurrentQuery: () => Promise<void>;
  runFromStartQuery: () => Promise<void>;
  runAllQuery: () => Promise<void>;
  explainPlan: () => Promise<void>;
  explainAnalyze: () => Promise<void>;
  cancelQuery: () => Promise<void>;
  focusEditor: () => void;
  formatQuery: () => void;
  quickDefinition: () => void;
  showEditorQuickFix: () => void;
  cleanupQuery: () => void;
  toggleEditorComment: () => void;
  transformEditorSelection: (action: SqlEditorTransformAction) => void;
  exportCsv: () => void;
  exportSqlInserts: () => void;
  copySqlInserts: () => Promise<void>;
  copySelectedGridCellOrRow: () => Promise<void>;
  copySelectedGridRow: () => Promise<void>;
  copyVisibleResult: () => Promise<void>;
  canEditActiveResult: () => boolean;
  setEditMode: (value: boolean) => void;
  setCommitError: (value: string | null) => void;
  addNewRow: () => void;
  undoLastEdit: () => void;
  commitEdits: () => Promise<void>;
  generateSql: () => void;
  toggleTerminal: () => void;
  toggleAiChat: () => void;
  toggleSearch: () => void;
  searchInAllTabs: () => void;
};

export function createWorkbenchCommandHandler({
  editMode,
  openPalette,
  openSettings,
  openKeymap,
  openHistory,
  openGit,
  openHelp,
  openDeveloperTools,
  openConnectionManager,
  openMigrationStudio,
  openDiagram,
  toggleTheme,
  toggleSidebar,
  toggleCompletion,
  toggleHistory,
  togglePlan,
  toggleBi,
  zoomIn,
  zoomOut,
  zoomReset,
  newSqlTab,
  closeActiveTab,
  saveQuery,
  saveQueryAs,
  exitApp,
  runQuery,
  runCurrentQuery,
  runFromStartQuery,
  runAllQuery,
  explainPlan,
  explainAnalyze,
  cancelQuery,
  focusEditor,
  formatQuery,
  quickDefinition,
  showEditorQuickFix,
  cleanupQuery,
  toggleEditorComment,
  transformEditorSelection,
  exportCsv,
  exportSqlInserts,
  copySqlInserts,
  copySelectedGridCellOrRow,
  copySelectedGridRow,
  copyVisibleResult,
  canEditActiveResult,
  setEditMode,
  setCommitError,
  addNewRow,
  undoLastEdit,
  commitEdits,
  generateSql,
  toggleTerminal,
  toggleAiChat,
  toggleSearch,
  searchInAllTabs,
}: WorkbenchCommandHandlerDeps) {
  return (id: string) => {
    switch (id) {
      case "palette.open":
        openPalette();
        break;
      case "settings.open":
        openSettings();
        break;
      case "settings.keymap":
        openKeymap();
        break;
      case "theme.toggle":
        toggleTheme();
        break;
      case "view.sidebar.toggle":
        toggleSidebar();
        break;
      case "view.completion.toggle":
        toggleCompletion();
        break;
      case "view.history.toggle":
        toggleHistory();
        break;
      case "view.plan.toggle":
        togglePlan();
        break;
      case "view.bi.toggle":
        toggleBi();
        break;
      case "view.zoomIn":
        zoomIn();
        break;
      case "view.zoomOut":
        zoomOut();
        break;
      case "view.zoomReset":
        zoomReset();
        break;
      case "history.open":
        openHistory();
        break;
      case "git.open":
        openGit();
        break;
      case "help.open":
      case "about.open":
        openHelp();
        break;
      case "developer.openDevtools":
        openDeveloperTools();
        break;
      case "connection.manager":
        openConnectionManager();
        break;
      case "migration.studio":
        openMigrationStudio();
        break;
      case "diagram.show":
        openDiagram();
        break;
      case "tab.new":
        newSqlTab();
        break;
      case "tab.close":
        closeActiveTab();
        break;
      case "file.save":
        saveQuery();
        break;
      case "file.saveAs":
        saveQueryAs();
        break;
      case "app.exit":
        void exitApp();
        break;
      case "query.run":
        void runQuery();
        break;
      case "query.runCurrent":
        void runCurrentQuery();
        break;
      case "query.runFromStart":
        void runFromStartQuery();
        break;
      case "query.runAll":
        void runAllQuery();
        break;
      case "query.explainPlan":
        void explainPlan();
        break;
      case "query.explainAnalyze":
        void explainAnalyze();
        break;
      case "query.cancel":
        void cancelQuery();
        break;
      case "editor.focus":
        focusEditor();
        break;
      case "editor.format":
        void formatQuery();
        break;
      case "editor.quickDefinition":
        quickDefinition();
        break;
      case "editor.quickFix":
        showEditorQuickFix();
        break;
      case "editor.cleanup":
        void cleanupQuery();
        break;
      case "editor.comment.toggle":
        toggleEditorComment();
        break;
      case "editor.transform.uppercase":
        transformEditorSelection("uppercase");
        break;
      case "editor.transform.lowercase":
        transformEditorSelection("lowercase");
        break;
      case "editor.transform.unformat":
        transformEditorSelection("unformat");
        break;
      case "editor.transform.addCommas":
        transformEditorSelection("appendCommas");
        break;
      case "editor.transform.doubleToSingleQuotes":
        transformEditorSelection("doubleToSingleQuotes");
        break;
      case "result.export":
        exportCsv();
        break;
      case "result.exportSqlInserts":
        exportSqlInserts();
        break;
      case "result.copySqlInserts":
        void copySqlInserts();
        break;
      case "result.copySelection":
        void copySelectedGridCellOrRow();
        break;
      case "result.copyRow":
        void copySelectedGridRow();
        break;
      case "result.copyVisible":
        void copyVisibleResult();
        break;
      case "edit.toggle":
        if (editMode) {
          setEditMode(false);
        } else if (canEditActiveResult()) {
          setEditMode(true);
          setCommitError(null);
        } else {
          setCommitError(
            "result editing needs a single table query with a visible key",
          );
        }
        break;
      case "edit.addRow":
        addNewRow();
        break;
      case "edit.undo":
        undoLastEdit();
        break;
      case "edit.commit":
        void commitEdits();
        break;
      case "editor.generateSql":
        generateSql();
        break;
      case "terminal.toggle":
        toggleTerminal();
        break;
      case "view.aiChat.toggle":
        toggleAiChat();
        break;
      case "view.search.toggle":
        toggleSearch();
        break;
      case "editor.searchInAllTabs":
        searchInAllTabs();
        break;
    }
  };
}
