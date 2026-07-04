import type { ShowActionNotice } from "@/app/ActionToast";
import type { QueryHistoryItem } from "@/features/query-history/query-history-store";
import {
  historySnapshotToQueryResult,
  toCount,
  type ResultCellRange,
  type ResultMode,
  type SelectedCell,
} from "@/features/results";
import type { SqlEditorHandle } from "@/features/query-editor";
import type { Translator } from "@/i18n";
import type { QueryResult } from "@/generated/irodori-api";

export type HistoryActionsDeps = {
  activeConnectionId: string;
  setActiveConnectionId: (value: string) => void;
  setQuery: (value: string) => void;
  closeQueryHistoryDialog: () => void;
  activeEditorApi: () => SqlEditorHandle | null;
  runEditorSql: (
    sqlToRun: string,
    options: { allowMagic: boolean },
  ) => Promise<void>;
  releaseActiveSpill: () => void;
  setResult: (value: QueryResult | null) => void;
  setLastRunSql: (value: string) => void;
  setQueryError: (value: unknown | null) => void;
  setResultMode: (value: ResultMode) => void;
  setTableViewObject: (value: null) => void;
  setActiveResultIndex: (value: number) => void;
  resetEdits: () => void;
  resetGridView: () => void;
  setSelectedRowKey: (value: string | null) => void;
  setSelectedCell: (value: SelectedCell) => void;
  setSelectedRange: (value: ResultCellRange) => void;
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

export function useHistoryActions({
  activeConnectionId,
  setActiveConnectionId,
  setQuery,
  closeQueryHistoryDialog,
  activeEditorApi,
  runEditorSql,
  releaseActiveSpill,
  setResult,
  setLastRunSql,
  setQueryError,
  setResultMode,
  setTableViewObject,
  setActiveResultIndex,
  resetEdits,
  resetGridView,
  setSelectedRowKey,
  setSelectedCell,
  setSelectedRange,
  showActionNotice,
  t,
}: HistoryActionsDeps) {
  function loadHistoryItem(item: QueryHistoryItem) {
    if (item.connectionId !== activeConnectionId) {
      setActiveConnectionId(item.connectionId);
    }
    setQuery(item.sql);
    closeQueryHistoryDialog();
    window.setTimeout(() => activeEditorApi()?.focus(), 0);
    showActionNotice(
      "success",
      t("notice.workbench.sqlLoaded"),
      item.connectionName,
    );
  }

  async function runHistoryItem(item: QueryHistoryItem) {
    if (item.connectionId !== activeConnectionId) {
      loadHistoryItem(item);
      showActionNotice(
        "info",
        t("notice.workbench.sqlLoaded"),
        t("notice.workbench.sqlLoadedSwitchedDetail"),
      );
      return;
    }
    setQuery(item.sql);
    closeQueryHistoryDialog();
    await runEditorSql(item.sql, { allowMagic: false });
  }

  function restoreHistoryResult(item: QueryHistoryItem) {
    if (!item.result) {
      showActionNotice(
        "info",
        t("notice.workbench.noResultRetained"),
        t("notice.workbench.noResultRetainedDetail"),
      );
      return;
    }
    releaseActiveSpill();
    setResult(historySnapshotToQueryResult(item.result));
    setLastRunSql(item.sql);
    setQueryError(null);
    setResultMode("data");
    setTableViewObject(null);
    setActiveResultIndex(0);
    resetEdits();
    resetGridView();
    setSelectedRowKey(null);
    setSelectedCell(null);
    setSelectedRange(null);
    closeQueryHistoryDialog();
    showActionNotice(
      "success",
      t("notice.workbench.resultRestored"),
      t("notice.workbench.resultRestoredDetail", {
        count: toCount(item.result.retainedRows),
      }),
    );
  }

  return {
    loadHistoryItem,
    runHistoryItem,
    restoreHistoryResult,
  };
}
