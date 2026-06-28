import { describe, expect, it } from "vitest";
import { createWorkbenchCommandHandler } from "@/features/workbench/command-handlers";
import type { SqlEditorTransformAction } from "@/sql/editor-transforms";

function createHandler(calls: string[]) {
  return createWorkbenchCommandHandler({
    editMode: false,
    openPalette: () => calls.push("palette"),
    openSettings: () => calls.push("settings"),
    openKeymap: () => calls.push("keymap"),
    openHistory: () => calls.push("history"),
    openGit: () => calls.push("git"),
    openHelp: () => calls.push("help"),
    openDeveloperTools: () => calls.push("devtools"),
    openConnectionManager: () => calls.push("connections"),
    openMigrationStudio: () => calls.push("migration"),
    openDiagram: () => calls.push("diagram"),
    toggleTheme: () => calls.push("theme"),
    toggleSidebar: () => calls.push("sidebar"),
    toggleCompletion: () => calls.push("completion"),
    toggleHistory: () => calls.push("history-toggle"),
    togglePlan: () => calls.push("plan-toggle"),
    toggleBi: () => calls.push("bi-toggle"),
    zoomIn: () => calls.push("zoom-in"),
    zoomOut: () => calls.push("zoom-out"),
    zoomReset: () => calls.push("zoom-reset"),
    newSqlTab: () => calls.push("tab-new"),
    closeActiveTab: () => calls.push("tab-close"),
    saveQuery: () => calls.push("save"),
    saveQueryAs: () => calls.push("save-as"),
    exitApp: async () => {
      calls.push("exit");
    },
    runQuery: async () => {
      calls.push("query-run");
    },
    runCurrentQuery: async () => {
      calls.push("query-current");
    },
    runFromStartQuery: async () => {
      calls.push("query-from-start");
    },
    runAllQuery: async () => {
      calls.push("query-all");
    },
    explainPlan: async () => {
      calls.push("explain-plan");
    },
    explainAnalyze: async () => {
      calls.push("explain-analyze");
    },
    cancelQuery: async () => {
      calls.push("query-cancel");
    },
    focusEditor: () => calls.push("editor-focus"),
    formatQuery: () => calls.push("editor-format"),
    quickDefinition: () => calls.push("editor-definition"),
    showEditorQuickFix: () => calls.push("editor-quick-fix"),
    cleanupQuery: () => calls.push("editor-cleanup"),
    toggleEditorComment: () => calls.push("editor-comment"),
    indentEditorSelection: () => calls.push("editor-indent"),
    outdentEditorSelection: () => calls.push("editor-outdent"),
    transformEditorSelection: (action: SqlEditorTransformAction) =>
      calls.push(`transform:${action}`),
    exportCsv: () => calls.push("export-csv"),
    exportSqlInserts: () => calls.push("export-sql"),
    copySqlInserts: async () => {
      calls.push("copy-sql");
    },
    copySelectedGridCellOrRow: async () => {
      calls.push("copy-selection");
    },
    copySelectedGridRow: async () => {
      calls.push("copy-row");
    },
    copyVisibleResult: async () => {
      calls.push("copy-visible");
    },
    canEditActiveResult: () => true,
    setEditMode: (value) => calls.push(`edit:${String(value)}`),
    setCommitError: (value) => calls.push(`error:${value ?? ""}`),
    addNewRow: () => calls.push("add-row"),
    undoLastEdit: () => calls.push("undo-edit"),
    commitEdits: async () => {
      calls.push("commit-edits");
    },
    generateSql: () => calls.push("generate-sql"),
    toggleTerminal: () => calls.push("toggle-terminal"),
    toggleAiChat: () => calls.push("toggle-aichat"),
    toggleSearch: () => calls.push("toggle-search"),
    searchInAllTabs: () => calls.push("search-all-tabs"),
  });
}

describe("createWorkbenchCommandHandler", () => {
  it("routes workspace menu commands", () => {
    const calls: string[] = [];
    const runCommand = createHandler(calls);

    runCommand("settings.keymap");
    runCommand("theme.toggle");
    runCommand("view.sidebar.toggle");
    runCommand("view.completion.toggle");
    runCommand("view.history.toggle");
    runCommand("view.bi.toggle");
    runCommand("view.zoomIn");
    runCommand("view.zoomOut");
    runCommand("view.zoomReset");
    runCommand("tab.new");
    runCommand("file.save");
    runCommand("file.saveAs");
    runCommand("app.exit");
    runCommand("developer.openDevtools");
    runCommand("migration.studio");
    runCommand("query.cancel");

    expect(calls).toEqual([
      "keymap",
      "theme",
      "sidebar",
      "completion",
      "history-toggle",
      "bi-toggle",
      "zoom-in",
      "zoom-out",
      "zoom-reset",
      "tab-new",
      "save",
      "save-as",
      "exit",
      "devtools",
      "migration",
      "query-cancel",
    ]);
  });

  it("routes editor transform commands", () => {
    const calls: string[] = [];
    const runCommand = createHandler(calls);

    runCommand("editor.transform.uppercase");
    runCommand("editor.transform.lowercase");
    runCommand("editor.transform.unformat");
    runCommand("editor.transform.addCommas");
    runCommand("editor.transform.doubleToSingleQuotes");
    runCommand("editor.indent");
    runCommand("editor.outdent");

    expect(calls).toEqual([
      "transform:uppercase",
      "transform:lowercase",
      "transform:unformat",
      "transform:appendCommas",
      "transform:doubleToSingleQuotes",
      "editor-indent",
      "editor-outdent",
    ]);
  });
});
