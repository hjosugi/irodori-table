import type { QueryHistoryItem } from "./query-history-store";

export type QueryHistoryConnection = {
  name: string;
  engine: string;
};

export function compactSql(sql: string, maxLength = 92) {
  const compact = sql.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
}

export function formatHistoryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatHistoryDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function toCount(value: bigint | number) {
  return Number(value).toLocaleString();
}

export function formatHistoryOutcome(item: QueryHistoryItem) {
  if (item.status === "error") {
    return item.error ? compactSql(item.error, 72) : "failed";
  }
  return `${toCount(item.rowCount)} rows${
    item.truncated ? " capped" : ""
  } · ${toCount(item.elapsedMs)} ms`;
}

export function historySearchText(
  item: QueryHistoryItem,
  connection?: QueryHistoryConnection,
) {
  const resultText = item.result
    ? [
        item.result.columns.join(" "),
        ...item.result.rows.slice(0, 8).map((row) => row.map(String).join(" ")),
      ].join("\n")
    : "";
  return [
    item.sql,
    item.error ?? "",
    resultText,
    item.status,
    item.engine,
    item.connectionName,
    connection?.engine ?? "",
    connection?.name ?? "",
  ]
    .join("\n")
    .toLowerCase();
}

type FilterHistoryOptions = {
  items: QueryHistoryItem[];
  activeConnectionId: string;
  connectionById: ReadonlyMap<string, QueryHistoryConnection>;
  search: string;
  scope?: "active" | "all";
  limit?: number;
};

export function filterQueryHistory({
  items,
  activeConnectionId,
  connectionById,
  search,
  scope = "active",
  limit,
}: FilterHistoryOptions) {
  const needle = search.trim().toLowerCase();
  const scopedItems =
    scope === "active"
      ? items.filter((item) => item.connectionId === activeConnectionId)
      : items;
  const filtered = needle
    ? scopedItems.filter((item) =>
        historySearchText(item, connectionById.get(item.connectionId)).includes(
          needle,
        ),
      )
    : scopedItems;
  return limit === undefined ? filtered : filtered.slice(0, limit);
}
