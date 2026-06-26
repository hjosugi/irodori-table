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
    openConnectionManager: () => calls.push("connections"),
    openDiagram: () => calls.push("diagram"),
    toggleTheme: () => calls.push("theme"),
    toggleSidebar: () => calls.push("sidebar"),
    toggleCompletion: () => calls.push("completion"),
    toggleHistory: () => calls.push("history-toggle"),
    toggleSidebarSide: () => calls.push("sidebar-side"),
    zoomIn: () => calls.push("zoom-in"),
    zoomOut: () => calls.push("zoom-out"),
    zoomReset: () => calls.push("zoom-reset"),
    closeActiveTab: () => calls.push("tab-close"),
    buildSchemaIndex: () => calls.push("schema-index"),
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
    cancelQuery: async () => {
      calls.push("query-cancel");
    },
    focusEditor: () => calls.push("editor-focus"),
    formatQuery: () => calls.push("editor-format"),
    toggleEditorComment: () => calls.push("editor-comment"),
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
    runCommand("view.sidebar.swap");
    runCommand("view.zoomIn");
    runCommand("view.zoomOut");
    runCommand("view.zoomReset");

    expect(calls).toEqual([
      "keymap",
      "theme",
      "sidebar",
      "completion",
      "history-toggle",
      "sidebar-side",
      "zoom-in",
      "zoom-out",
      "zoom-reset",
    ]);
  });
});
