import type { ShowActionNotice } from "@/app/ActionToast";
import { selectedSqlFromSelections } from "@/app/app-workbench-utils";
import { writeTextToClipboard } from "@/features/erd";
import type {
  EditorSelection,
  QueryMagicAction,
  SqlEditorHandle,
} from "@/features/query-editor";
import type { ResultExportFormat } from "@/features/results";
import type { Translator } from "@/i18n";
import { errorMessage } from "@/core";
import type {
  DatabaseMetadata,
  QueryPlanCopyFormat,
  QueryPlanMode,
  QueryResult,
} from "@/generated/irodori-api";
import type { SqlFormatterId } from "@/sql/formatter";
import type { SqlEditorTransformAction } from "@/sql/editor-transforms";
import { selectedOrCurrentStatement } from "@/sql/statements";

export type EditorCommandsDeps = {
  query: string;
  activeResult: QueryResult | null | undefined;
  activeConnectionId: string;
  activeConnectionOpen: boolean;
  activeMetadata: DatabaseMetadata | undefined;
  activeMetadataLoading: boolean;
  formatter: SqlFormatterId;
  activeEditorApi: () => SqlEditorHandle | null;
  activeEditorSelections: () => readonly EditorSelection[];
  activeMainEditorSelection: () => EditorSelection;
  setQuery: (value: string) => void;
  setQueryError: (value: unknown | null) => void;
  setRunMenuOpen: (value: boolean) => void;
  runEditorSqlWithRunner: (
    sqlToRun: string,
    options: {
      allowMagic: boolean;
      onMagic: (magic: QueryMagicAction) => Promise<void>;
    },
  ) => Promise<void>;
  runSqlWithParameterPrompt: (sql: string) => Promise<void>;
  openQueryParameterPrompt: (
    sql: string,
    includeCurrentValues: boolean,
  ) => Promise<unknown>;
  explainSql: (sql: string, mode: QueryPlanMode) => Promise<void>;
  refreshObjects: (
    connectionId: string,
    force?: boolean,
    notify?: boolean,
  ) => Promise<void>;
  openDiagramForSearch: (search: string) => void;
  exportActiveResult: (format: ResultExportFormat) => Promise<void>;
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

export function useEditorCommands({
  query,
  activeResult,
  activeConnectionId,
  activeConnectionOpen,
  activeMetadata,
  activeMetadataLoading,
  formatter,
  activeEditorApi,
  activeEditorSelections,
  activeMainEditorSelection,
  setQuery,
  setQueryError,
  setRunMenuOpen,
  runEditorSqlWithRunner,
  runSqlWithParameterPrompt,
  openQueryParameterPrompt,
  explainSql,
  refreshObjects,
  openDiagramForSearch,
  exportActiveResult,
  showActionNotice,
  t,
}: EditorCommandsDeps) {
  async function formatQuery() {
    const result = await activeEditorApi()?.format();
    const error = result?.error ?? null;
    setQueryError(error);
    if (error) {
      showActionNotice("error", t("notice.editor.formatFailed"), error);
    } else if (!result?.changed) {
      showActionNotice(
        "info",
        result?.skipped === "empty"
          ? t("notice.editor.nothingToFormat")
          : t("notice.editor.alreadyFormatted"),
      );
    } else {
      showActionNotice("success", t("notice.editor.formatted"), formatter);
    }
  }

  function showEditorQuickFix() {
    const opened = activeEditorApi()?.showQuickFix() ?? false;
    if (!opened) {
      showActionNotice("info", t("notice.editor.noProblems"));
    }
  }

  async function cleanupQuery() {
    const result = await activeEditorApi()?.cleanup();
    const error = result?.error ?? null;
    setQueryError(error);
    if (error) {
      showActionNotice("error", t("notice.editor.cleanupFailed"), error);
    } else if (!result?.changed) {
      showActionNotice(
        "info",
        result?.skipped === "empty"
          ? t("notice.editor.nothingToCleanup")
          : t("notice.editor.alreadyClean"),
      );
    } else {
      showActionNotice("success", t("notice.editor.cleanupComplete"));
    }
  }

  function transformEditorSelection(action: SqlEditorTransformAction) {
    const changed = activeEditorApi()?.transformSelection(action) ?? false;
    if (!changed) {
      showActionNotice("info", t("notice.editor.nothingChanged"));
      return;
    }
    const label: Record<SqlEditorTransformAction, string> = {
      uppercase: t("notice.editor.uppercased"),
      lowercase: t("notice.editor.lowercased"),
      unformat: t("notice.editor.unformatted"),
      appendCommas: t("notice.editor.commasAdded"),
      doubleToSingleQuotes: t("notice.editor.quotesConverted"),
    };
    showActionNotice("success", label[action]);
  }

  function indentEditorSelection() {
    const changed = activeEditorApi()?.indentSelection() ?? false;
    showActionNotice(
      changed ? "success" : "info",
      changed ? t("notice.editor.indented") : t("notice.editor.nothingChanged"),
    );
  }

  function outdentEditorSelection() {
    const changed = activeEditorApi()?.outdentSelection() ?? false;
    showActionNotice(
      changed ? "success" : "info",
      changed
        ? t("notice.editor.outdented")
        : t("notice.editor.nothingChanged"),
    );
  }

  async function runQuery() {
    setRunMenuOpen(false);
    const selectedSql = selectedSqlFromSelections(
      query,
      activeEditorSelections(),
    );
    if (selectedSql) {
      await runEditorSql(selectedSql, { allowMagic: true });
      return;
    }
    const selection = activeMainEditorSelection();
    const sqlToRun = selectedOrCurrentStatement(
      selection.from,
      selection.to,
      query,
    );
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  async function copyPlanFormat(format: QueryPlanCopyFormat) {
    try {
      await writeTextToClipboard(format.content);
      showActionNotice(
        "success",
        t("notice.workbench.planCopied"),
        format.label,
      );
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  async function runSelectionQuery() {
    setRunMenuOpen(false);
    const sqlToRun = selectedSqlFromSelections(query, activeEditorSelections());
    if (!sqlToRun) {
      showActionNotice("info", t("notice.query.noSelectionToRun"));
      return;
    }
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  async function runCurrentQuery() {
    setRunMenuOpen(false);
    const selection = activeMainEditorSelection();
    const cursor = selection.to;
    const sqlToRun = selectedOrCurrentStatement(cursor, cursor, query);
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  function explainTargetSql() {
    const selectedSql = selectedSqlFromSelections(
      query,
      activeEditorSelections(),
    );
    if (selectedSql) {
      return selectedSql;
    }
    const selection = activeMainEditorSelection();
    const cursor = selection.to;
    return selectedOrCurrentStatement(cursor, cursor, query);
  }

  async function explainCurrentQuery(mode: QueryPlanMode) {
    setRunMenuOpen(false);
    await explainSql(explainTargetSql().trim(), mode);
  }

  async function runFromStartQuery() {
    setRunMenuOpen(false);
    const selection = activeMainEditorSelection();
    const cursor = Math.max(selection.from, selection.to);
    const sqlToRun = query.slice(0, cursor).trim();
    await runEditorSql(sqlToRun, { allowMagic: false });
  }

  async function runAllQuery() {
    setRunMenuOpen(false);
    await runEditorSql(query.trim(), { allowMagic: false });
  }

  async function runEditorSql(
    sqlToRun: string,
    options: { allowMagic: boolean },
  ) {
    await runEditorSqlWithRunner(sqlToRun, {
      ...options,
      onMagic: runQueryMagic,
    });
  }

  async function runQueryMagic(magic: QueryMagicAction) {
    switch (magic.kind) {
      case "error":
        setQueryError(magic.message);
        return;
      case "sql":
        setQuery(magic.sql);
        await runSqlWithParameterPrompt(magic.sql);
        return;
      case "erd":
        if (!activeConnectionOpen) {
          setQueryError(`not connected: ${activeConnectionId}`);
          return;
        }
        if (!activeMetadata && !activeMetadataLoading) {
          await refreshObjects(activeConnectionId, true);
        }
        openDiagramForSearch(magic.search);
        setQueryError(null);
        return;
      case "export":
        if (!activeResult) {
          setQueryError("No result to export yet.");
          return;
        }
        await exportActiveResult(magic.format);
        setQueryError(null);
        return;
      case "params":
        setQuery(magic.sql);
        await openQueryParameterPrompt(magic.sql, true);
        return;
    }
  }

  return {
    formatQuery,
    showEditorQuickFix,
    cleanupQuery,
    transformEditorSelection,
    indentEditorSelection,
    outdentEditorSelection,
    runQuery,
    copyPlanFormat,
    runSelectionQuery,
    runCurrentQuery,
    explainCurrentQuery,
    runFromStartQuery,
    runAllQuery,
    runEditorSql,
  };
}
