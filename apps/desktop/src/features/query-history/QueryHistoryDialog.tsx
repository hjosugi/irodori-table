import { useMemo } from "react";
import { AlertTriangle, Clock3, Play, Search, Trash2, X } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { DialogShell } from "@/components/DialogShell";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator, type Translator } from "@/i18n";
import {
  type QueryHistoryItem,
  useQueryHistoryStore,
} from "./query-history-store";
import {
  compactSql,
  filterQueryHistory,
  formatHistoryDateTime,
  formatHistoryOutcome,
  toCount,
  type QueryHistoryConnection,
} from "./query-history-utils";

type QueryHistoryDialogProps = {
  activeConnectionId: string;
  activeConnectionOpen: boolean;
  running: boolean;
  connectionById: ReadonlyMap<string, QueryHistoryConnection>;
  onLoad: (item: QueryHistoryItem) => void;
  onRun: (item: QueryHistoryItem) => void;
  onRestoreResult: (item: QueryHistoryItem) => void;
};

export function QueryHistoryDialog({
  activeConnectionId,
  activeConnectionOpen,
  running,
  connectionById,
  onLoad,
  onRun,
  onRestoreResult,
}: QueryHistoryDialogProps) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const items = useQueryHistoryStore((state) => state.items);
  const search = useQueryHistoryStore((state) => state.search);
  const open = useQueryHistoryStore((state) => state.open);
  const scope = useQueryHistoryStore((state) => state.scope);
  const selectedId = useQueryHistoryStore((state) => state.selectedId);
  const setSearch = useQueryHistoryStore((state) => state.setSearch);
  const setScope = useQueryHistoryStore((state) => state.setScope);
  const select = useQueryHistoryStore((state) => state.select);
  const closeDialog = useQueryHistoryStore((state) => state.closeDialog);
  const deleteItem = useQueryHistoryStore((state) => state.deleteItem);
  const clearItems = useQueryHistoryStore((state) => state.clearItems);
  const historyDialogItems = useMemo(
    () =>
      filterQueryHistory({
        items,
        activeConnectionId,
        connectionById,
        search,
        scope,
      }),
    [activeConnectionId, connectionById, items, scope, search],
  );
  const selectedHistoryItem =
    historyDialogItems.find((item) => item.id === selectedId) ??
    historyDialogItems[0] ??
    null;
  const hasSearch = search.trim().length > 0;
  const { confirm, confirmElement } = useConfirm();

  if (!open) {
    return null;
  }

  async function clearVisibleHistory() {
    if (historyDialogItems.length === 0) {
      return;
    }
    const count = historyDialogItems.length;
    if (
      !(await confirm({
        title: t("history.confirmClear.title", { count: toCount(count) }),
        message: t("confirm.cannotUndo"),
        confirmLabel: t("common.delete"),
        tone: "danger",
      }))
    ) {
      return;
    }
    clearItems(historyDialogItems.map((item) => item.id));
  }

  return (
    <DialogShell
      className="data-dialog history-dialog"
      overlayClassName="palette-overlay history-overlay"
      label={t("history.title")}
      onClose={closeDialog}
    >
      <div className="dialog-header">
        <strong>{t("history.title")}</strong>
        <span>
          {t("history.visibleSaved", {
            saved: toCount(items.length),
            visible: toCount(historyDialogItems.length),
          })}
        </span>
        <button className="text-button" type="button" onClick={closeDialog}>
          <X size={13} />
          {t("common.close")}
        </button>
      </div>
      <div className="history-toolbar">
        <label className="history-search">
          <Search size={13} />
          <input
            autoFocus
            value={search}
            placeholder={t("history.searchDialog")}
            aria-label={t("history.searchQueryHistory")}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          {hasSearch ? (
            <button
              type="button"
              aria-label={t("history.clearSearch")}
              title={t("history.clearSearch")}
              onClick={() => setSearch("")}
            >
              <X size={12} />
            </button>
          ) : null}
        </label>
        <div
          className="segmented-control history-scope"
          role="group"
          aria-label={t("history.scope")}
        >
          <button
            type="button"
            className={scope === "active" ? "active" : undefined}
            onClick={() => setScope("active")}
          >
            {t("history.scopeActive")}
          </button>
          <button
            type="button"
            className={scope === "all" ? "active" : undefined}
            onClick={() => setScope("all")}
          >
            {t("history.scopeAll")}
          </button>
        </div>
        <button
          className="text-button danger"
          type="button"
          disabled={historyDialogItems.length === 0}
          onClick={() => void clearVisibleHistory()}
        >
          <Trash2 size={13} />
          {t("history.clearVisible")}
        </button>
      </div>
      <div className="history-dialog-body">
        <div
          className="history-results"
          role="listbox"
          aria-label={t("history.entries", {
            count: toCount(historyDialogItems.length),
          })}
        >
          {historyDialogItems.length > 0 ? (
            historyDialogItems.map((item) => {
              const selected = selectedHistoryItem?.id === item.id;
              return (
                <button
                  className={`history-row ${item.status}${
                    selected ? " active" : ""
                  }`}
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  title={item.sql}
                  onClick={() => select(item.id)}
                >
                  <span className="history-row-main">
                    <strong>{compactSql(item.sql, 128)}</strong>
                    <small>
                      {item.connectionName} · {item.engine}
                    </small>
                  </span>
                  <span className="history-row-meta">
                    <span>{formatHistoryDateTime(item.ranAt)}</span>
                    <span>{formatHistoryOutcome(item)}</span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="empty-browser">
              {hasSearch ? t("history.noMatches") : t("history.noHistory")}
            </div>
          )}
        </div>
        <section className="history-detail" aria-label={t("history.selected")}>
          {selectedHistoryItem ? (
            <>
              <div className="history-detail-header">
                <div className="history-detail-title">
                  <span>
                    <strong>{selectedHistoryItem.connectionName}</strong>
                    <small>{selectedHistoryItem.engine}</small>
                  </span>
                  <span
                    className={`history-status-badge ${selectedHistoryItem.status}`}
                  >
                    {selectedHistoryItem.status === "ok"
                      ? t("history.success")
                      : t("history.failed")}
                  </span>
                </div>
                <div className="history-meta">
                  <span className="history-chip">
                    {formatHistoryDateTime(selectedHistoryItem.ranAt)}
                  </span>
                  <span className="history-chip">
                    {formatHistoryOutcome(selectedHistoryItem)}
                  </span>
                </div>
                <div className="history-detail-actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => onLoad(selectedHistoryItem)}
                  >
                    {t("history.load")}
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    disabled={!selectedHistoryItem.result}
                    title={
                      selectedHistoryItem.result
                        ? t("history.restoreResultTitle")
                        : t("history.noResultRetainedTitle")
                    }
                    onClick={() => onRestoreResult(selectedHistoryItem)}
                  >
                    {t("history.restoreResult")}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      selectedHistoryItem.connectionId !== activeConnectionId ||
                      !activeConnectionOpen ||
                      running
                    }
                    title={
                      selectedHistoryItem.connectionId !== activeConnectionId
                        ? t("history.loadBeforeRunning")
                        : activeConnectionOpen
                          ? t("history.runAgainTitle")
                          : t("history.connectBeforeRunning")
                    }
                    onClick={() => onRun(selectedHistoryItem)}
                  >
                    <Play size={13} fill="currentColor" />
                    {t("history.runAgain")}
                  </button>
                  <button
                    className="text-button danger"
                    type="button"
                    onClick={() => deleteItem(selectedHistoryItem.id)}
                  >
                    <Trash2 size={13} />
                    {t("common.delete")}
                  </button>
                </div>
              </div>
              <pre className="history-sql">{selectedHistoryItem.sql}</pre>
              {selectedHistoryItem.error ? (
                <div className="inline-error history-error">
                  <AlertTriangle size={13} />
                  <span>{selectedHistoryItem.error}</span>
                </div>
              ) : null}
              {selectedHistoryItem.result ? (
                <HistoryResultPreview item={selectedHistoryItem} t={t} />
              ) : selectedHistoryItem.status === "ok" ? (
                <div className="history-result-empty">
                  {t("history.noResultRowsRetained")}
                </div>
              ) : null}
            </>
          ) : (
            <div className="history-empty-detail">
              <Clock3 size={18} />
              <span>{t("history.selectEntry")}</span>
            </div>
          )}
        </section>
      </div>
      {confirmElement}
    </DialogShell>
  );
}

function HistoryResultPreview({
  item,
  t,
}: {
  item: QueryHistoryItem;
  t: Translator["t"];
}) {
  const result = item.result;
  if (!result) {
    return null;
  }
  const displayRows = result.rows.slice(0, 8);
  return (
    <section
      className="history-result-preview"
      aria-label={t("history.savedResultPreview")}
    >
      <div className="history-result-preview-header">
        <strong>{t("history.savedResult")}</strong>
        <span>
          {t("history.retainedRows", {
            count: toCount(result.retainedRows),
          })}
          {result.retentionTruncated ? ` ${t("history.retained")}` : ""}
        </span>
      </div>
      <div className="history-result-table-wrap">
        <table className="history-result-table">
          <thead>
            <tr>
              {result.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {result.columns.map((column, columnIndex) => (
                  <td key={`${column}:${columnIndex}`}>
                    {formatHistoryCell(row[columnIndex])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.retainedRows > displayRows.length ? (
        <small>
          {t("history.showingRetainedRows", {
            count: toCount(displayRows.length),
          })}
        </small>
      ) : null}
    </section>
  );
}

function formatHistoryCell(value: unknown) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
