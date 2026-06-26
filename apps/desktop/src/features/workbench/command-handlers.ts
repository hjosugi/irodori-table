type WorkbenchCommandHandlerDeps = {
  editMode: boolean;
  openPalette: () => void;
  openSettings: () => void;
  openHistory: () => void;
  openGit: () => void;
  openHelp: () => void;
  openConnectionManager: () => void;
  openDiagram: () => void;
  buildSchemaIndex: () => void;
  runQuery: () => Promise<void>;
  runCurrentQuery: () => Promise<void>;
  runFromStartQuery: () => Promise<void>;
  runAllQuery: () => Promise<void>;
  cancelQuery: () => Promise<void>;
  focusEditor: () => void;
  formatQuery: () => void;
  toggleEditorComment: () => void;
  exportCsv: () => void;
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
  openHistory,
  openGit,
  openHelp,
  openConnectionManager,
  openDiagram,
  buildSchemaIndex,
  runQuery,
  runCurrentQuery,
  runFromStartQuery,
  runAllQuery,
  cancelQuery,
  focusEditor,
  formatQuery,
  toggleEditorComment,
  exportCsv,
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
      case "result.export":
        exportCsv();
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
