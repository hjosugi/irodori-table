import { useMemo } from "react";
import { AlertTriangle, Clock3, Play, Search, Trash2, X } from "lucide-react";
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

  if (!open) {
    return null;
  }

  function clearVisibleHistory() {
    if (historyDialogItems.length === 0) {
      return;
    }
    const count = historyDialogItems.length;
    const label = count === 1 ? "history entry" : "history entries";
    if (!window.confirm(`Delete ${toCount(count)} visible ${label}?`)) {
      return;
    }
    clearItems(historyDialogItems.map((item) => item.id));
  }

  return (
    <div
      className="palette-overlay history-overlay"
      onClick={closeDialog}
      role="presentation"
    >
      <div
        className="data-dialog history-dialog"
        role="dialog"
        aria-label="Query history"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <strong>Query History</strong>
          <span>
            {toCount(historyDialogItems.length)} visible of{" "}
            {toCount(items.length)} saved
          </span>
          <button className="text-button" type="button" onClick={closeDialog}>
            <X size={13} />
            Close
          </button>
        </div>
        <div className="history-toolbar">
          <label className="history-search">
            <Search size={13} />
            <input
              autoFocus
              value={search}
              placeholder="Search SQL, connection, engine, or error"
              aria-label="Search query history"
              onChange={(event) => setSearch(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  closeDialog();
                }
              }}
            />
            {hasSearch ? (
              <button
                type="button"
                aria-label="Clear history search"
                title="Clear history search"
                onClick={() => setSearch("")}
              >
                <X size={12} />
              </button>
            ) : null}
          </label>
          <div
            className="segmented-control history-scope"
            role="group"
            aria-label="History scope"
          >
            <button
              type="button"
              className={scope === "active" ? "active" : undefined}
              onClick={() => setScope("active")}
            >
              Active
            </button>
            <button
              type="button"
              className={scope === "all" ? "active" : undefined}
              onClick={() => setScope("all")}
            >
              All
            </button>
          </div>
          <button
            className="text-button danger"
            type="button"
            disabled={historyDialogItems.length === 0}
            onClick={clearVisibleHistory}
          >
            <Trash2 size={13} />
            Clear visible
          </button>
        </div>
        <div className="history-dialog-body">
          <div
            className="history-results"
            role="listbox"
            aria-label="Query history entries"
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
                {hasSearch ? "No matching history" : "No query history"}
              </div>
            )}
          </div>
          <section className="history-detail" aria-label="Selected query history">
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
                      {selectedHistoryItem.status === "ok" ? "Success" : "Failed"}
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
                      Load
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      disabled={!selectedHistoryItem.result}
                      title={
                        selectedHistoryItem.result
                          ? "Restore the saved result preview into the grid"
                          : "No result was retained for this history entry"
                      }
                      onClick={() => onRestoreResult(selectedHistoryItem)}
                    >
                      Restore result
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
                          ? "Load this SQL to switch connection before running"
                          : activeConnectionOpen
                            ? "Run this SQL again"
                            : "Connect before running"
                      }
                      onClick={() => onRun(selectedHistoryItem)}
                    >
                      <Play size={13} fill="currentColor" />
                      Run again
                    </button>
                    <button
                      className="text-button danger"
                      type="button"
                      onClick={() => deleteItem(selectedHistoryItem.id)}
                    >
                      <Trash2 size={13} />
                      Delete
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
                  <HistoryResultPreview item={selectedHistoryItem} />
                ) : selectedHistoryItem.status === "ok" ? (
                  <div className="history-result-empty">
                    No result rows retained for this entry.
                  </div>
                ) : null}
              </>
            ) : (
              <div className="history-empty-detail">
                <Clock3 size={18} />
                <span>Select a history entry</span>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function HistoryResultPreview({ item }: { item: QueryHistoryItem }) {
  const result = item.result;
  if (!result) {
    return null;
  }
  const displayRows = result.rows.slice(0, 8);
  return (
    <section className="history-result-preview" aria-label="Saved result preview">
      <div className="history-result-preview-header">
        <strong>Saved result</strong>
        <span>
          {toCount(result.retainedRows)} of {toCount(result.rowCount)} rows
          {result.retentionTruncated ? " retained" : ""}
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
          Showing first {toCount(displayRows.length)} retained rows.
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
