import { useMemo } from "react";
import { Maximize2, Search, X } from "lucide-react";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
import {
  queryHistoryDisplayLimit,
  type QueryHistoryItem,
  useQueryHistoryStore,
} from "./query-history-store";
import {
  compactSql,
  filterQueryHistory,
  formatHistoryOutcome,
  formatHistoryTime,
  toCount,
  type QueryHistoryConnection,
} from "./query-history-utils";

type QueryHistorySidebarProps = {
  activeConnectionId: string;
  connectionById: ReadonlyMap<string, QueryHistoryConnection>;
  onLoad: (item: QueryHistoryItem) => void;
  onClose?: () => void;
};

export function QueryHistorySidebar({
  activeConnectionId,
  connectionById,
  onLoad,
  onClose,
}: QueryHistorySidebarProps) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const items = useQueryHistoryStore((state) => state.items);
  const search = useQueryHistoryStore((state) => state.search);
  const setSearch = useQueryHistoryStore((state) => state.setSearch);
  const openDialog = useQueryHistoryStore((state) => state.openDialog);
  const activeHistoryCount = useMemo(
    () =>
      items.filter((item) => item.connectionId === activeConnectionId).length,
    [activeConnectionId, items],
  );
  const scopedHistory = useMemo(
    () =>
      filterQueryHistory({
        items,
        activeConnectionId,
        connectionById,
        search,
        limit: queryHistoryDisplayLimit,
      }),
    [activeConnectionId, connectionById, items, search],
  );
  const hasSearch = search.trim().length > 0;

  return (
    <section>
      <div className="section-heading">
        <span>{t("history.titleShort")}</span>
        <div className="section-heading-actions">
          <small>{toCount(activeHistoryCount)}</small>
          <button
            type="button"
            aria-label={t("history.open")}
            title={t("history.open")}
            onClick={() => openDialog(scopedHistory[0]?.id)}
          >
            <Maximize2 size={12} />
          </button>
          {onClose ? (
            <button
              type="button"
              aria-label={t("history.close")}
              title={t("history.close")}
              onClick={onClose}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>
      <label className="history-search">
        <Search size={13} />
        <input
          value={search}
          placeholder={t("history.search")}
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
      <div className="history-list">
        {scopedHistory.length > 0 ? (
          scopedHistory.map((item) => (
            <button
              className={`history-item ${item.status}`}
              key={item.id}
              type="button"
              title={
                item.status === "error" && item.error ? item.error : item.sql
              }
              onClick={() => onLoad(item)}
            >
              <strong>{compactSql(item.sql)}</strong>
              <small>
                <span>{formatHistoryTime(item.ranAt, locale)}</span>
                <span>{formatHistoryOutcome(item)}</span>
              </small>
            </button>
          ))
        ) : (
          <div className="empty-browser">
            {hasSearch ? t("history.noMatches") : t("history.noHistory")}
          </div>
        )}
      </div>
    </section>
  );
}
