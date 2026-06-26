import type { SqlEditorTransformAction } from "@/sql/editor-transforms";

type WorkbenchCommandHandlerDeps = {
  editMode: boolean;
  openPalette: () => void;
  openSettings: () => void;
  openKeymap: () => void;
  openHistory: () => void;
  openGit: () => void;
  openHelp: () => void;
  openConnectionManager: () => void;
  openDiagram: () => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  toggleCompletion: () => void;
  toggleHistory: () => void;
  toggleSidebarSide: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  closeActiveTab: () => void;
  buildSchemaIndex: () => void;
  runQuery: () => Promise<void>;
  runCurrentQuery: () => Promise<void>;
  runFromStartQuery: () => Promise<void>;
  runAllQuery: () => Promise<void>;
  cancelQuery: () => Promise<void>;
  focusEditor: () => void;
  formatQuery: () => void;
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
};

export function createWorkbenchCommandHandler({
  editMode,
  openPalette,
  openSettings,
  openKeymap,
  openHistory,
  openGit,
  openHelp,
  openConnectionManager,
  openDiagram,
  toggleTheme,
  toggleSidebar,
  toggleCompletion,
  toggleHistory,
  toggleSidebarSide,
  zoomIn,
  zoomOut,
  zoomReset,
  closeActiveTab,
  buildSchemaIndex,
  runQuery,
  runCurrentQuery,
  runFromStartQuery,
  runAllQuery,
  cancelQuery,
  focusEditor,
  formatQuery,
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
      case "view.sidebar.swap":
        toggleSidebarSide();
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
      case "connection.manager":
        openConnectionManager();
        break;
      case "diagram.show":
        openDiagram();
        break;
      case "tab.close":
        closeActiveTab();
        break;
      case "schema.indexBuild":
        buildSchemaIndex();
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
      case "query.cancel":
        void cancelQuery();
        break;
      case "editor.focus":
        focusEditor();
        break;
      case "editor.format":
        formatQuery();
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
    }
  };
}
