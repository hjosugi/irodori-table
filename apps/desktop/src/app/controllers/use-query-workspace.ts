import { useRef, useState } from "react";
import type { ShowActionNotice } from "@/app/ActionToast";
import { useEditorCommands } from "@/app/controllers/use-editor-commands";
import type { EditorWorkspace } from "@/app/controllers/use-editor-workspace";
import type { useErdDiagram } from "@/app/controllers/use-erd-diagram";
import { useHistoryActions } from "@/app/controllers/use-history-actions";
import { useQueryRunner } from "@/app/controllers/use-query-runner";
import { useResultGridWorkspace } from "@/app/controllers/use-result-grid-workspace";
import type { SettingsController } from "@/app/controllers/use-settings-controller";
import type { SidebarViews } from "@/app/controllers/use-sidebar-views";
import type { WorkbenchConnections } from "@/app/controllers/use-workbench-connections";
import { usePreferencesStore } from "@/features/preferences";
import { useQueryHistoryStore } from "@/features/query-history/query-history-store";
import type { QueryPlanAnalysis } from "@/generated/irodori-api";
import type { Translator } from "@/i18n";

type QueryWorkspaceDeps = {
  connections: WorkbenchConnections;
  editor: EditorWorkspace;
  sidebars: Pick<SidebarViews, "biOpen" | "setActiveSidebarView">;
  settings: Pick<SettingsController, "queryHistoryResultRows">;
  erd: Pick<ReturnType<typeof useErdDiagram>, "openDiagramForSearch">;
  confirm: Parameters<typeof useResultGridWorkspace>[0]["confirm"];
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

// The whole run-a-query pipeline behind one seam: the result grid, the query
// runner, editor-scoped commands, history load/run/restore, plus the query
// error and EXPLAIN-plan state they share. The long setter hand-offs between
// those four controllers stay inside this file.
export function useQueryWorkspace({
  connections,
  editor,
  sidebars,
  settings,
  erd,
  confirm,
  showActionNotice,
  t,
}: QueryWorkspaceDeps) {
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
    editorEngine,
    connectionActions,
  } = connections;
  const { query, setQuery, activeEditorApi } = editor;
  const uiZoom = usePreferencesStore((state) => state.uiZoom);
  const formatter = usePreferencesStore((state) => state.formatter);
  const appendHistory = useQueryHistoryStore((state) => state.append);
  const closeQueryHistoryDialog = useQueryHistoryStore(
    (state) => state.closeDialog,
  );

  // Query error + EXPLAIN-plan state, fed by the runner, read by the results
  // pane and the plan sidebar panel.
  const [queryError, setQueryError] = useState<string | null>(null);
  const [planAnalysis, setPlanAnalysis] = useState<QueryPlanAnalysis | null>(
    null,
  );
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

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
    confirm,
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

  return {
    grid,
    queryRunner,
    editorCommands,
    historyActions,
    queryError,
    plan: { analysis: planAnalysis, loading: planLoading, error: planError },
    importFileRef,
  };
}

export type QueryWorkspace = ReturnType<typeof useQueryWorkspace>;
