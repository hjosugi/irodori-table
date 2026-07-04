import { type FormEvent, useEffect, useRef, useState } from "react";
import { useMachine } from "@xstate/react";

import { type ShowActionNotice } from "@/app/ActionToast";
import {
  createQueryHistoryResultSnapshot,
  type QueryHistoryItem,
} from "@/features/query-history/query-history-store";
import {
  WindowedRows,
  createWindowedRowsProxy,
  toCount,
  type ResultCellRange,
  type SelectedCell,
} from "@/features/results";
import {
  buildParameterInputs,
  loadQueryParameterMemory,
  parseQueryMagic,
  queryParameterMemoryStorageKey,
  type PendingQueryParameters,
  type QueryMagicAction,
  type QueryParameterMemory,
} from "@/features/query-editor";
import {
  queryService as defaultQueryService,
  type QueryService,
} from "@/features/workbench";
import { errorMessage, isRetryableError } from "@/core";
import type { Translator } from "@/i18n";
import {
  isQueryBusy,
  queryLifecycleMachine,
} from "@/lib/query/query-lifecycle-machine";
import type {
  DbEngine,
  DbObjectMetadata,
  QueryParameterInput,
  QueryPlanAnalysis,
  QueryPlanMode,
  QueryResult,
  QueryResultSet,
  SpillRunResult,
} from "@/generated/irodori-api";
import { sqlMayWrite } from "@/sql/read-only";
import {
  RESULT_WINDOW_MAX_RESIDENT_PAGES,
  RESULT_WINDOW_PAGE_SIZE,
  tauriRuntimeError,
} from "../app-workbench-utils";

function isQueryCancelledMessage(message: string) {
  const normalized = message.trim().toLowerCase();
  return normalized === "cancelled" || normalized.includes("query cancelled");
}

export type RunEditorSqlOptions = {
  allowMagic: boolean;
  onMagic: (magic: QueryMagicAction) => Promise<void>;
};

export type ExecuteQueryOptions = {
  sourceObject?: DbObjectMetadata;
};

export type QueryRunnerDeps = {
  queryService?: QueryService;
  activeConnectionId: string;
  activeConnectionOpen: boolean;
  activeConnectionReadOnly: boolean;
  activeConnectionName: string;
  activeConnectionEngine: DbEngine;
  activeEngine: DbEngine;
  resultOffloadEnabled: boolean;
  resultMemoryBudget: number;
  queryHistoryResultRows: number;
  appendHistory: (item: QueryHistoryItem) => void;
  setResult: (value: QueryResult | null) => void;
  setQueryError: (value: unknown | null) => void;
  setLastRunSql: (value: string) => void;
  setPlanAnalysis: (value: QueryPlanAnalysis | null) => void;
  setPlanLoading: (value: boolean) => void;
  setPlanError: (value: string | null) => void;
  setResultMode: (value: "data") => void;
  setTableViewObject: (value: DbObjectMetadata | null) => void;
  setActiveResultIndex: (value: number) => void;
  resetEdits: () => void;
  resetGridView: () => void;
  releaseActiveSpill: () => void;
  gridRef: { current: HTMLDivElement | null };
  setGridScrollTop: (value: number) => void;
  setGridScrollLeft: (value: number) => void;
  setSelectedRowKey: (value: string | null) => void;
  setSelectedCell: (value: SelectedCell) => void;
  setSelectedRange: (value: ResultCellRange) => void;
  spillRef: { current: { handle: string; source: WindowedRows } | null };
  clearPendingPages: () => void;
  setSpillInfo: (value: { handle: string; total: number } | null) => void;
  bumpGridWindowVersion: () => void;
  refreshObjects: (connectionId: string, force?: boolean) => Promise<void>;
  openPlanPanel: () => void;
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

export function useQueryRunner(deps: QueryRunnerDeps) {
  const {
    queryService = defaultQueryService,
    activeConnectionId,
    activeConnectionOpen,
    activeConnectionReadOnly,
    activeConnectionName,
    activeConnectionEngine,
    activeEngine,
    resultOffloadEnabled,
    resultMemoryBudget,
    queryHistoryResultRows,
    appendHistory,
    setResult,
    setQueryError,
    setLastRunSql,
    setPlanAnalysis,
    setPlanLoading,
    setPlanError,
    setResultMode,
    setTableViewObject,
    setActiveResultIndex,
    resetEdits,
    resetGridView,
    releaseActiveSpill,
    gridRef,
    setGridScrollTop,
    setGridScrollLeft,
    setSelectedRowKey,
    setSelectedCell,
    setSelectedRange,
    spillRef,
    clearPendingPages,
    setSpillInfo,
    bumpGridWindowVersion,
    refreshObjects,
    openPlanPanel,
    showActionNotice,
    t,
  } = deps;

  const [queryRun, sendQueryRun] = useMachine(queryLifecycleMachine);
  const running = isQueryBusy(String(queryRun.value));
  const runningQueryIdRef = useRef<string | null>(null);
  const cancelRequestedQueryIdRef = useRef<string | null>(null);
  const [queryParameterMemory, setQueryParameterMemory] =
    useState<QueryParameterMemory>(loadQueryParameterMemory);
  const [pendingQueryParameters, setPendingQueryParameters] =
    useState<PendingQueryParameters | null>(null);
  const [parameterDraftValues, setParameterDraftValues] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    window.localStorage.setItem(
      queryParameterMemoryStorageKey,
      JSON.stringify(queryParameterMemory),
    );
  }, [queryParameterMemory]);

  function validateSqlRun(sqlToRun: string) {
    if (!activeConnectionOpen) {
      const message = t("notice.query.notConnectedDetail", {
        id: activeConnectionId,
      });
      setQueryError(message);
      showActionNotice("error", t("notice.query.runFailed"), message);
      return false;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setQueryError(runtimeError);
      showActionNotice("error", t("notice.query.runFailed"), runtimeError);
      return false;
    }
    if (!sqlToRun) {
      setQueryError("query is empty");
      showActionNotice("info", t("notice.query.nothingToRun"));
      return false;
    }
    return true;
  }

  function blockReadOnlySql(sqlToRun: string) {
    if (!activeConnectionReadOnly || !sqlMayWrite(sqlToRun)) {
      return false;
    }
    const message = t("notice.query.readOnlyDetail");
    setQueryError(message);
    showActionNotice("error", t("notice.query.readOnly"), message);
    return true;
  }

  async function runEditorSql(
    sqlToRun: string,
    { allowMagic, onMagic }: RunEditorSqlOptions,
  ) {
    if (!validateSqlRun(sqlToRun)) {
      return;
    }
    const magic = allowMagic ? parseQueryMagic(sqlToRun, activeEngine) : null;
    if (magic) {
      await onMagic(magic);
      return;
    }
    await runSqlWithParameterPrompt(sqlToRun);
  }

  async function runSqlWithParameterPrompt(sqlToRun: string) {
    if (blockReadOnlySql(sqlToRun)) {
      return;
    }
    const openedPrompt = await openQueryParameterPrompt(sqlToRun, false);
    if (openedPrompt) {
      return;
    }
    await executeQuery(sqlToRun);
  }

  async function openQueryParameterPrompt(
    sqlToRun: string,
    requirePrompt: boolean,
  ) {
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setQueryError(runtimeError);
      showActionNotice(
        "error",
        t("notice.query.parameterScanFailed"),
        runtimeError,
      );
      return true;
    }
    try {
      const promptSet = await queryService.queryParameters(sqlToRun);
      if (promptSet.prompts.length > 0) {
        const remembered = queryParameterMemory[promptSet.signature] ?? {};
        setParameterDraftValues(
          Object.fromEntries(
            promptSet.prompts.map((prompt) => [
              prompt.id,
              remembered[prompt.id] ?? "",
            ]),
          ),
        );
        setPendingQueryParameters({ sql: sqlToRun, promptSet });
        setQueryError(null);
        return true;
      }
      if (requirePrompt) {
        setQueryError("No query parameters found in this SQL.");
        showActionNotice("info", t("notice.query.noParameters"));
        return true;
      }
    } catch (error) {
      const message = errorMessage(error);
      setQueryError(error);
      showActionNotice("error", t("notice.query.parameterScanFailed"), message);
      return true;
    }
    return false;
  }

  async function executeQuery(
    sqlToRun: string,
    params?: QueryParameterInput[],
    options: ExecuteQueryOptions = {},
  ) {
    if (!activeConnectionOpen) {
      const message = t("notice.query.notConnectedDetail", {
        id: activeConnectionId,
      });
      setQueryError(message);
      showActionNotice("error", t("notice.query.runFailed"), message);
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setQueryError(runtimeError);
      showActionNotice("error", t("notice.query.runFailed"), runtimeError);
      return;
    }
    if (!sqlToRun.trim()) {
      setQueryError("query is empty");
      showActionNotice("info", t("notice.query.nothingToRun"));
      return;
    }
    if (blockReadOnlySql(sqlToRun)) {
      return;
    }
    sendQueryRun({ type: "SUBMIT", sql: sqlToRun });
    setQueryError(null);
    setLastRunSql(sqlToRun);
    setResultMode("data");
    setTableViewObject(options.sourceObject ?? null);
    setActiveResultIndex(0);
    resetEdits();
    resetGridView();
    releaseActiveSpill();
    if (gridRef.current) {
      gridRef.current.scrollTop = 0;
      gridRef.current.scrollLeft = 0;
    }
    setGridScrollTop(0);
    setGridScrollLeft(0);
    setSelectedRowKey(null);
    setSelectedCell(null);
    setSelectedRange(null);
    const started = performance.now();
    const ranAt = new Date().toISOString();
    const queryId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    runningQueryIdRef.current = queryId;
    const cancelRequestedForRun = () =>
      cancelRequestedQueryIdRef.current === queryId;
    const showCancelledRun = () => {
      setQueryError(null);
      showActionNotice("info", t("notice.query.cancelled"));
    };
    let publishRaf: number | null = null;
    const appendErrorHistory = (message: string) => {
      appendHistory({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        connectionId: activeConnectionId,
        connectionName: activeConnectionName,
        engine: activeConnectionEngine,
        sql: sqlToRun,
        status: "error",
        rowCount: 0,
        elapsedMs: Math.max(1, Math.round(performance.now() - started)),
        truncated: false,
        error: message,
        ranAt,
      });
    };
    try {
      const streamResultSets: QueryResultSet[] = [];
      const ensureResultSet = (index: number) => {
        while (streamResultSets.length <= index) {
          const statementIndex = streamResultSets.length;
          streamResultSets.push({
            statementIndex,
            statement: `statement ${statementIndex + 1}`,
            columns: [],
            rows: [],
            rowCount: 0n,
            elapsedMs: 0n,
            truncated: false,
          });
        }
        return streamResultSets[index];
      };
      const publishStreamResultNow = () => {
        if (publishRaf !== null) {
          window.cancelAnimationFrame(publishRaf);
          publishRaf = null;
        }
        const first = ensureResultSet(0);
        setResult({
          columns: first.columns,
          rows: [...first.rows],
          rowCount: first.rowCount,
          elapsedMs: first.elapsedMs,
          truncated: first.truncated,
          message: first.message,
          resultSets:
            streamResultSets.length > 1
              ? streamResultSets.map((set) => ({
                  ...set,
                  rows: [...set.rows],
                }))
              : undefined,
        });
      };
      const scheduleStreamResultPublish = () => {
        if (publishRaf !== null) {
          return;
        }
        publishRaf = window.requestAnimationFrame(() => {
          publishRaf = null;
          publishStreamResultNow();
        });
      };
      const appendOkHistory = (
        rowCount: number,
        elapsedMs: number,
        truncated: boolean,
        result: ReturnType<typeof createQueryHistoryResultSnapshot>,
      ) => {
        appendHistory({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          connectionId: activeConnectionId,
          connectionName: activeConnectionName,
          engine: activeConnectionEngine,
          sql: sqlToRun,
          status: "ok",
          rowCount,
          elapsedMs,
          truncated,
          result,
          ranAt,
        });
      };
      const refreshMetadataForDdl = () => {
        if (/^\s*(alter|create|drop|rename|truncate)\b/i.test(sqlToRun)) {
          void refreshObjects(activeConnectionId, true);
        }
      };
      const finalizeSpillRun = (spill: SpillRunResult) => {
        const first = ensureResultSet(0);
        const totalRows = Number(spill.totalRows);
        const historyResult = createQueryHistoryResultSnapshot(
          {
            columns: spill.columns,
            rows: first.rows,
            rowCount: spill.totalRows,
            elapsedMs: spill.elapsedMs,
            truncated: spill.truncated,
            message: spill.spilled
              ? "result retained on disk; history kept a preview"
              : undefined,
          },
          queryHistoryResultRows,
        );
        const source = new WindowedRows({
          total: totalRows,
          columnCount: spill.columns.length,
          pageSize: RESULT_WINDOW_PAGE_SIZE,
          maxResidentPages: RESULT_WINDOW_MAX_RESIDENT_PAGES,
        });
        source.ingest(0, first.rows);
        spillRef.current = { handle: spill.handle, source };
        clearPendingPages();
        setSpillInfo({ handle: spill.handle, total: totalRows });
        bumpGridWindowVersion();
        setResult({
          columns: spill.columns,
          rows: createWindowedRowsProxy(source) as QueryResult["rows"],
          rowCount: spill.totalRows,
          elapsedMs: spill.elapsedMs,
          truncated: spill.truncated,
          message: spill.spilled
            ? "result retained on disk; scrolling pages rows on demand"
            : spill.truncated
              ? "result capped at memory budget"
              : undefined,
        });
        appendOkHistory(
          totalRows,
          Number(spill.elapsedMs),
          spill.truncated,
          historyResult,
        );
        refreshMetadataForDdl();
        showActionNotice(
          "success",
          t("notice.query.finished"),
          t("notice.query.finishedDetail", {
            rows: toCount(totalRows),
            ms: toCount(spill.elapsedMs),
          }),
        );
      };
      if (resultOffloadEnabled) {
        const spill = await queryService.spill(
          {
            connectionId: activeConnectionId,
            sql: sqlToRun,
            memoryBudget: resultMemoryBudget,
            offloadEnabled: true,
            queryId,
            params,
          },
          (event) => {
            switch (event.type) {
              case "columns":
                ensureResultSet(event.resultSetIndex).columns = event.columns;
                sendQueryRun({ type: "COLUMNS" });
                publishStreamResultNow();
                break;
              case "rows": {
                const set = ensureResultSet(event.resultSetIndex);
                set.rows.push(...event.rows);
                set.rowCount = BigInt(set.rows.length);
                set.elapsedMs = BigInt(Math.round(performance.now() - started));
                scheduleStreamResultPublish();
                break;
              }
            }
          },
        );
        finalizeSpillRun(spill);
        sendQueryRun({
          type: "DONE",
          rowCount: Number(spill.totalRows),
          elapsedMs: Number(spill.elapsedMs),
        });
      } else {
        await queryService.stream(
          {
            connectionId: activeConnectionId,
            sql: sqlToRun,
            maxRows: 10_000,
            queryId,
            params,
          },
          (event) => {
            switch (event.type) {
              case "columns":
                ensureResultSet(event.resultSetIndex).columns = event.columns;
                sendQueryRun({ type: "COLUMNS" });
                publishStreamResultNow();
                break;
              case "rows":
                {
                  const set = ensureResultSet(event.resultSetIndex);
                  set.rows.push(...event.rows);
                  set.rowCount = BigInt(set.rows.length);
                  set.elapsedMs = BigInt(
                    Math.round(performance.now() - started),
                  );
                }
                scheduleStreamResultPublish();
                break;
              case "done":
                for (const summary of event.resultSets) {
                  const set = ensureResultSet(summary.resultSetIndex);
                  set.rowCount = BigInt(summary.rowCount);
                  set.elapsedMs = BigInt(summary.elapsedMs || event.elapsedMs);
                  set.truncated = summary.truncated;
                  set.message = summary.truncated
                    ? "result capped at 10000 rows"
                    : undefined;
                }
                publishStreamResultNow();
                {
                  const first = ensureResultSet(0);
                  const historyResult = createQueryHistoryResultSnapshot(
                    {
                      columns: first.columns,
                      rows: first.rows,
                      rowCount: BigInt(event.rowCount),
                      elapsedMs: BigInt(event.elapsedMs),
                      truncated: event.truncated,
                      message: first.message,
                      resultSets:
                        streamResultSets.length > 1
                          ? streamResultSets.map((set) => ({
                              statementIndex: set.statementIndex,
                              statement: set.statement,
                              columns: set.columns,
                              rows: set.rows,
                              rowCount: set.rowCount,
                              elapsedMs: set.elapsedMs,
                              truncated: set.truncated,
                              message: set.message,
                            }))
                          : undefined,
                    },
                    queryHistoryResultRows,
                  );
                  appendOkHistory(
                    event.rowCount,
                    event.elapsedMs,
                    event.truncated,
                    historyResult,
                  );
                }
                refreshMetadataForDdl();
                showActionNotice(
                  "success",
                  t("notice.query.finished"),
                  t("notice.query.finishedDetail", {
                    rows: toCount(event.rowCount),
                    ms: toCount(event.elapsedMs),
                  }),
                );
                sendQueryRun({
                  type: "DONE",
                  rowCount: Number(event.rowCount),
                  elapsedMs: Number(event.elapsedMs),
                });
                break;
              case "error":
                if (
                  cancelRequestedForRun() &&
                  isQueryCancelledMessage(event.message)
                ) {
                  showCancelledRun();
                  sendQueryRun({ type: "CANCEL" });
                  break;
                }
                sendQueryRun({ type: "ERROR", message: event.message });
                setQueryError(event.message);
                showActionNotice(
                  "error",
                  t("notice.query.failed"),
                  event.message,
                );
                appendErrorHistory(event.message);
                break;
            }
          },
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      if (cancelRequestedForRun() && isQueryCancelledMessage(message)) {
        showCancelledRun();
        sendQueryRun({ type: "CANCEL" });
      } else {
        sendQueryRun({ type: "ERROR", message });
        setQueryError(error);
        showActionNotice(
          "error",
          t("notice.query.failed"),
          message,
          isRetryableError(error)
            ? {
                action: {
                  label: t("common.retry"),
                  run: () => void executeQuery(sqlToRun, params, options),
                },
              }
            : undefined,
        );
        appendErrorHistory(message);
      }
    } finally {
      if (publishRaf !== null) {
        window.cancelAnimationFrame(publishRaf);
      }
      if (cancelRequestedQueryIdRef.current === queryId) {
        cancelRequestedQueryIdRef.current = null;
      }
      runningQueryIdRef.current = null;
    }
  }

  async function submitQueryParameters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending = pendingQueryParameters;
    if (!pending) {
      return;
    }
    const values = { ...parameterDraftValues };
    const params = buildParameterInputs(pending.promptSet, values);
    setQueryParameterMemory((current) => ({
      ...current,
      [pending.promptSet.signature]: values,
    }));
    setPendingQueryParameters(null);
    setParameterDraftValues({});
    await executeQuery(pending.sql, params);
  }

  async function cancelQuery() {
    const id = runningQueryIdRef.current;
    if (!id) {
      return;
    }
    if (cancelRequestedQueryIdRef.current === id) {
      showActionNotice("info", t("notice.query.cancelAlreadyRequested"));
      return;
    }
    try {
      cancelRequestedQueryIdRef.current = id;
      const cancelled = await queryService.cancel(id);
      if (cancelled) {
        showActionNotice("info", t("notice.query.cancelRequested"));
      } else {
        if (cancelRequestedQueryIdRef.current === id) {
          cancelRequestedQueryIdRef.current = null;
        }
        showActionNotice("info", t("notice.query.alreadyFinished"));
      }
    } catch (error) {
      if (cancelRequestedQueryIdRef.current === id) {
        cancelRequestedQueryIdRef.current = null;
      }
      showActionNotice(
        "error",
        t("notice.query.cancelFailed"),
        errorMessage(error),
      );
    }
  }

  async function explainSql(sqlToExplain: string, mode: QueryPlanMode) {
    if (!activeConnectionOpen) {
      const message = t("notice.query.notConnectedDetail", {
        id: activeConnectionId,
      });
      setPlanError(message);
      showActionNotice("error", t("notice.query.explainFailed"), message);
      openPlanPanel();
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setPlanError(runtimeError);
      showActionNotice("error", t("notice.query.explainFailed"), runtimeError);
      openPlanPanel();
      return;
    }
    if (!sqlToExplain) {
      setPlanError("query is empty");
      showActionNotice("info", t("notice.query.nothingToExplain"));
      openPlanPanel();
      return;
    }
    openPlanPanel();
    setPlanLoading(true);
    setPlanError(null);
    try {
      const plan = await queryService.explain(
        activeConnectionId,
        sqlToExplain,
        mode,
      );
      setPlanAnalysis(plan);
      showActionNotice(
        "success",
        mode === "analyze"
          ? t("notice.query.analyzeComplete")
          : t("notice.query.planReady"),
        t("notice.query.planSummary", {
          nodes: plan.nodes.length,
          findings: plan.findings.length,
        }),
      );
    } catch (error) {
      const message = errorMessage(error);
      setPlanError(message);
      showActionNotice("error", t("notice.query.explainFailed"), message);
    } finally {
      setPlanLoading(false);
    }
  }

  return {
    running,
    pendingQueryParameters,
    parameterDraftValues,
    setParameterDraftValues,
    setPendingQueryParameters,
    runEditorSql,
    runSqlWithParameterPrompt,
    openQueryParameterPrompt,
    executeQuery,
    submitQueryParameters,
    cancelQuery,
    explainSql,
  };
}
