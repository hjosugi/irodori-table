import { createElement, useRef, useState } from "react";
import type { ShowActionNotice } from "@/app/ActionToast";
import { loadSavedQuery } from "@/app/app-config";
import { selectedSqlFromSelections } from "@/app/app-workbench-utils";
import { EditorTabStrip } from "@/app/EditorTabStrip";
import type { QueryEditorController } from "@/app/controllers/workbench-controllers";
import type { useEditorCommands } from "@/app/controllers/use-editor-commands";
import { useEditorGroups } from "@/app/controllers/use-editor-groups";
import { usePreferencesStore } from "@/features/preferences";
import type {
  EditorGroup,
  EditorSelection,
  SqlEditorHandle,
} from "@/features/query-editor";
import { useWorkbenchStore } from "@/features/workbench";
import { formatKeySequence, type Keymap } from "@/core";
import type { DatabaseMetadata, DbEngine } from "@/generated/irodori-api";
import type { IrodoriTheme } from "@/theme";
import type { useQueryRunner } from "@/app/controllers/use-query-runner";
import type { useWorkspaceActions } from "@/app/controllers/use-workspace-actions";
import type { createPanelResizeController } from "@/features/workbench";

type PanelResize = ReturnType<typeof createPanelResizeController>;

type EditorWorkspaceDeps = {
  keymap: Keymap;
  showActionNotice: ShowActionNotice;
  t: Parameters<typeof useEditorGroups>[0]["t"];
};

// The editor surface behind one seam: editor refs and split state, tab
// groups, the active-editor accessors every other workspace hook uses, run
// labels/shortcut tips derived from the keymap, and a builder for the
// QueryEditorController consumed by QueryEditorPane.
export function useEditorWorkspace({
  keymap,
  showActionNotice,
  t,
}: EditorWorkspaceDeps) {
  const editorApiRef = useRef<SqlEditorHandle>(null);
  const secondaryEditorApiRef = useRef<SqlEditorHandle>(null);
  const editorSplitRef = useRef<HTMLDivElement | null>(null);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const editorSplitMode = useWorkbenchStore((state) => state.editorSplitMode);
  const editorSplitOpen = editorSplitMode !== "single";
  const formatter = usePreferencesStore((state) => state.formatter);
  const vimMode = usePreferencesStore((state) => state.vimMode);
  const sqlLinter = usePreferencesStore((state) => state.sqlLinter);
  const sqlSnippets = usePreferencesStore((state) => state.sqlSnippets);
  const editorBackgroundImage = usePreferencesStore(
    (state) => state.editorBackgroundImage,
  );
  const editorBackgroundOpacity = usePreferencesStore(
    (state) => state.editorBackgroundOpacity,
  );

  const editorGroups = useEditorGroups({
    loadInitialQuery: loadSavedQuery,
    editorSplitMode,
    editorApiRef,
    secondaryEditorApiRef,
    showActionNotice,
    t,
  });
  const {
    activeEditorGroup,
    activeTabLabel,
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
    secondaryQuery,
    selectEditorTab,
    setActiveEditorGroup,
    setEditorGroupQuery,
    setEditorGroupSelection,
    setEditorTabMenu,
    setQuery,
  } = editorGroups;

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

  const selectedEditorSql = selectedSqlFromSelections(query, editorSelections);
  const hasSelectedEditorSql = selectedEditorSql.length > 0;
  const runPrimaryLabel = hasSelectedEditorSql
    ? t("editor.runSelection")
    : t("editor.runCurrent");
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
    shortcutTip(t("shortcuts.newTab"), "tab.new"),
    shortcutTip(t("shortcuts.showCommands"), "palette.open"),
    shortcutTip(t("shortcuts.exportCsv"), "result.export"),
    shortcutTip(t("shortcuts.copyTsv"), "result.copyVisible"),
    shortcutTip(t("shortcuts.toggleEditData"), "edit.toggle"),
    shortcutTip(t("shortcuts.addRow"), "edit.addRow"),
    shortcutTip(t("shortcuts.undoEdit"), "edit.undo"),
    shortcutTip(t("shortcuts.commitEdits"), "edit.commit"),
  ];

  function renderEditorTabStrip(group: EditorGroup) {
    return createElement(EditorTabStrip, {
      group,
      state: editorGroupStates[group],
      menu: editorTabMenu,
      onSelectTab: selectEditorTab,
      onOpenMenu: setEditorTabMenu,
      onCloseMenu: () => setEditorTabMenu(null),
      onNewTab: newSqlTab,
      onRenameTab: renameSqlTab,
      onDuplicateTab: duplicateSqlTab,
      onCloseTab: closeSqlTab,
      onCloseOtherTabs: closeOtherSqlTabs,
      onReopenClosedTab: reopenSqlTab,
    });
  }

  function buildQueryEditorController(extra: {
    running: boolean;
    resultActionsAvailable: boolean;
    theme: IrodoriTheme;
    activeMetadata: DatabaseMetadata | undefined;
    editorEngine: DbEngine;
    runCommand: (commandId: string) => void;
    editorCommands: Pick<
      ReturnType<typeof useEditorCommands>,
      | "runQuery"
      | "runSelectionQuery"
      | "runCurrentQuery"
      | "runFromStartQuery"
      | "runAllQuery"
    >;
    workspace: Pick<
      ReturnType<typeof useWorkspaceActions>,
      "handleImportFile" | "jumpToSqlMetadata"
    >;
    cancelQuery: ReturnType<typeof useQueryRunner>["cancelQuery"];
    beginPanelResize: PanelResize["beginPanelResize"];
    onPanelResizeKey: PanelResize["onPanelResizeKey"];
  }): QueryEditorController {
    return {
      activeTabLabel,
      running: extra.running,
      formatter,
      primaryQuery,
      secondaryQuery,
      onPrimaryQueryChange: (next) => setEditorGroupQuery("primary", next),
      onSecondaryQueryChange: (next) => setEditorGroupQuery("secondary", next),
      renderEditorTabStrip,
      editorEngine: extra.editorEngine,
      activeMetadata: extra.activeMetadata,
      sqlSnippets,
      editorBackgroundImage,
      editorBackgroundOpacity,
      theme: extra.theme,
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
      resultActionsAvailable: extra.resultActionsAvailable,
      runCommand: extra.runCommand,
      runQuery: extra.editorCommands.runQuery,
      runSelectionQuery: extra.editorCommands.runSelectionQuery,
      runCurrentQuery: extra.editorCommands.runCurrentQuery,
      runFromStartQuery: extra.editorCommands.runFromStartQuery,
      runAllQuery: extra.editorCommands.runAllQuery,
      cancelQuery: extra.cancelQuery,
      setRunMenuOpen,
      beginEditorSplitResize: (event) =>
        extra.beginPanelResize("editorSplit", event),
      onEditorSplitResizeKey: (event) =>
        extra.onPanelResizeKey("editorSplit", event),
      onSqlFileDrop: (file) => void extra.workspace.handleImportFile(file),
      onUnsupportedFileDrop: () =>
        showActionNotice(
          "error",
          t("editor.dropFailed"),
          t("editor.dropUnsupportedFile"),
        ),
      sqlFileDropLabel: t("editor.dropSqlFile"),
      onMetadataJump: extra.workspace.jumpToSqlMetadata,
    } satisfies QueryEditorController;
  }

  return {
    editorGroups,
    query,
    setQuery,
    activeTabLabel,
    editorSelections,
    editorSplitMode,
    editorSplitRef,
    runMenuOpen,
    setRunMenuOpen,
    activeEditorApi,
    activeEditorSelections,
    activeMainEditorSelection,
    resultShortcutTips,
    buildQueryEditorController,
  };
}

export type EditorWorkspace = ReturnType<typeof useEditorWorkspace>;
