import { create } from "zustand";
import { parseStoredNumber } from "@/core";

export const queryHistoryMaxItemsDefault = 200;
export const queryHistoryMaxItemsHardLimit = 500;
export const queryHistoryResultRowsDefault = 50;
export const queryHistoryResultRowsHardLimit = 500;
export const maxQueryHistoryItems = queryHistoryMaxItemsHardLimit;
export const queryHistoryDisplayLimit = 25;
const queryHistoryStorageKey = "irodori.queryHistory.v1";
const queryHistoryMaxItemsStorageKey = "irodori.queryHistory.maxItems.v1";
const queryHistoryResultRowsStorageKey = "irodori.queryHistory.resultRows.v1";

export type QueryHistoryStatus = "ok" | "error";
export type HistoryScope = "active" | "all";

export type QueryHistoryResultSetSnapshot = {
  statementIndex: number;
  statement: string;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  retainedRows: number;
  elapsedMs: number;
  truncated: boolean;
  retentionTruncated: boolean;
  message?: string;
};

export type QueryHistoryResultSnapshot = {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  retainedRows: number;
  elapsedMs: number;
  truncated: boolean;
  retentionTruncated: boolean;
  message?: string;
  resultSets?: QueryHistoryResultSetSnapshot[];
};

export type QueryHistoryItem = {
  id: string;
  connectionId: string;
  connectionName: string;
  engine: string;
  sql: string;
  status: QueryHistoryStatus;
  rowCount: number;
  elapsedMs: number;
  truncated: boolean;
  error?: string;
  result?: QueryHistoryResultSnapshot;
  ranAt: string;
};

type QueryHistoryState = {
  items: QueryHistoryItem[];
  maxItems: number;
  resultRowLimit: number;
  search: string;
  open: boolean;
  scope: HistoryScope;
  selectedId: string | null;
  append: (item: QueryHistoryItem) => void;
  setMaxItems: (value: number) => void;
  setResultRowLimit: (value: number) => void;
  setSearch: (search: string) => void;
  setScope: (scope: HistoryScope) => void;
  select: (id: string | null) => void;
  openDialog: (preferredId?: string | null) => void;
  closeDialog: () => void;
  deleteItem: (id: string) => void;
  clearItems: (ids: Iterable<string>) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : null;
  } catch {
    return null;
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampQueryHistoryMaxItems(value: number) {
  return clampNumber(value, 0, queryHistoryMaxItemsHardLimit);
}

export function clampQueryHistoryResultRows(value: number) {
  return clampNumber(value, 0, queryHistoryResultRowsHardLimit);
}

function numberValue(value: unknown) {
  if (typeof value === "bigint") {
    return Number(value);
  }
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, Math.round(next)) : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function rowArray(value: unknown): unknown[][] {
  return Array.isArray(value)
    ? value.filter((row): row is unknown[] => Array.isArray(row))
    : [];
}

// getItem returns null for an absent key, and Number(null) is 0, which is
// finite — so a bare Number() guard took the stored branch on a profile that
// had never written the key and produced 0 rather than the default. append()
// discards everything when maxItems is 0, so history silently recorded nothing
// until the user happened to change the setting. preferences-store.ts already
// guards nullish separately; match it.
function storedNumber(key: string) {
  return parseStoredNumber(storage()?.getItem(key));
}

function loadQueryHistoryMaxItems() {
  const stored = storedNumber(queryHistoryMaxItemsStorageKey);
  return stored === null
    ? queryHistoryMaxItemsDefault
    : clampQueryHistoryMaxItems(stored);
}

function loadQueryHistoryResultRows() {
  const stored = storedNumber(queryHistoryResultRowsStorageKey);
  return stored === null
    ? queryHistoryResultRowsDefault
    : clampQueryHistoryResultRows(stored);
}

type QueryResultSetLike = {
  statementIndex?: number | bigint;
  statement?: string;
  columns: string[];
  rows: unknown[][];
  rowCount: number | bigint;
  elapsedMs: number | bigint;
  truncated: boolean;
  message?: string;
};

type QueryResultLike = {
  columns: string[];
  rows: unknown[][];
  rowCount: number | bigint;
  elapsedMs: number | bigint;
  truncated: boolean;
  message?: string;
  resultSets?: QueryResultSetLike[];
};

export function createQueryHistoryResultSnapshot(
  result: QueryResultLike,
  rowLimit: number,
): QueryHistoryResultSnapshot | undefined {
  const limit = clampQueryHistoryResultRows(rowLimit);
  if (limit === 0 || result.columns.length === 0) {
    return undefined;
  }
  const rows = result.rows.slice(0, limit);
  const rowCount = numberValue(result.rowCount);
  const snapshot: QueryHistoryResultSnapshot = {
    columns: [...result.columns],
    rows,
    rowCount,
    retainedRows: rows.length,
    elapsedMs: numberValue(result.elapsedMs),
    truncated: result.truncated,
    retentionTruncated:
      rowCount > rows.length || result.rows.length > rows.length,
    message: result.message,
  };
  if (result.resultSets && result.resultSets.length > 1) {
    snapshot.resultSets = result.resultSets.map((set) =>
      createQueryHistoryResultSetSnapshot(set, limit),
    );
  }
  return snapshot;
}

function createQueryHistoryResultSetSnapshot(
  result: QueryResultSetLike,
  rowLimit: number,
): QueryHistoryResultSetSnapshot {
  const limit = clampQueryHistoryResultRows(rowLimit);
  const rows = result.rows.slice(0, limit);
  const rowCount = numberValue(result.rowCount);
  return {
    statementIndex: numberValue(result.statementIndex ?? 0),
    statement: result.statement ?? "",
    columns: [...result.columns],
    rows,
    rowCount,
    retainedRows: rows.length,
    elapsedMs: numberValue(result.elapsedMs),
    truncated: result.truncated,
    retentionTruncated:
      rowCount > rows.length || result.rows.length > rows.length,
    message: result.message,
  };
}

function sanitizeResultSnapshot(
  value: unknown,
  rowLimit: number,
): QueryHistoryResultSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const columns = stringArray(value.columns);
  const rows = rowArray(value.rows);
  if (columns.length === 0) {
    return undefined;
  }
  return createQueryHistoryResultSnapshot(
    {
      columns,
      rows,
      rowCount: value.rowCount as number | bigint,
      elapsedMs: value.elapsedMs as number | bigint,
      truncated: Boolean(value.truncated),
      message: typeof value.message === "string" ? value.message : undefined,
      resultSets: Array.isArray(value.resultSets)
        ? value.resultSets.flatMap((set): QueryResultSetLike[] => {
            if (!isRecord(set)) {
              return [];
            }
            const setColumns = stringArray(set.columns);
            if (setColumns.length === 0) {
              return [];
            }
            return [
              {
                statementIndex: set.statementIndex as number | bigint,
                statement:
                  typeof set.statement === "string" ? set.statement : "",
                columns: setColumns,
                rows: rowArray(set.rows),
                rowCount: set.rowCount as number | bigint,
                elapsedMs: set.elapsedMs as number | bigint,
                truncated: Boolean(set.truncated),
                message:
                  typeof set.message === "string" ? set.message : undefined,
              },
            ];
          })
        : undefined,
    },
    rowLimit,
  );
}

function sanitizeQueryHistoryItem(
  item: unknown,
  rowLimit: number,
): QueryHistoryItem | null {
  if (
    !isRecord(item) ||
    typeof item.id !== "string" ||
    typeof item.connectionId !== "string" ||
    typeof item.connectionName !== "string" ||
    typeof item.engine !== "string" ||
    typeof item.sql !== "string" ||
    typeof item.ranAt !== "string" ||
    (item.status !== "ok" && item.status !== "error")
  ) {
    return null;
  }
  return {
    id: item.id,
    connectionId: item.connectionId,
    connectionName: item.connectionName,
    engine: item.engine,
    sql: item.sql,
    status: item.status,
    rowCount: Number(item.rowCount) || 0,
    elapsedMs: Number(item.elapsedMs) || 0,
    truncated: Boolean(item.truncated),
    error: typeof item.error === "string" ? item.error : undefined,
    result: sanitizeResultSnapshot(item.result, rowLimit),
    ranAt: item.ranAt,
  };
}

function sanitizeQueryHistoryItemForSettings(
  item: QueryHistoryItem,
  rowLimit: number,
): QueryHistoryItem {
  return {
    ...item,
    result: sanitizeResultSnapshot(item.result, rowLimit),
  };
}

function loadQueryHistory(
  maxItems: number,
  rowLimit: number,
): QueryHistoryItem[] {
  try {
    const raw = storage()?.getItem(queryHistoryStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .flatMap((item): QueryHistoryItem[] => {
        const sanitized = sanitizeQueryHistoryItem(item, rowLimit);
        return sanitized ? [sanitized] : [];
      })
      .slice(0, maxItems);
  } catch {
    return [];
  }
}

const initialMaxItems = loadQueryHistoryMaxItems();
const initialResultRowLimit = loadQueryHistoryResultRows();

export const useQueryHistoryStore = create<QueryHistoryState>((set) => ({
  items: loadQueryHistory(initialMaxItems, initialResultRowLimit),
  maxItems: initialMaxItems,
  resultRowLimit: initialResultRowLimit,
  search: "",
  open: false,
  scope: "active",
  selectedId: null,
  append: (item) =>
    set((state) => {
      if (state.maxItems === 0) {
        return { items: [], selectedId: null };
      }
      const nextItem = sanitizeQueryHistoryItemForSettings(
        item,
        state.resultRowLimit,
      );
      return {
        items: [nextItem, ...state.items].slice(0, state.maxItems),
      };
    }),
  setMaxItems: (value) =>
    set((state) => {
      const maxItems = clampQueryHistoryMaxItems(value);
      return {
        maxItems,
        items: state.items.slice(0, maxItems),
        selectedId:
          state.selectedId &&
          state.items
            .slice(0, maxItems)
            .some((item) => item.id === state.selectedId)
            ? state.selectedId
            : null,
      };
    }),
  setResultRowLimit: (value) =>
    set((state) => {
      const resultRowLimit = clampQueryHistoryResultRows(value);
      return {
        resultRowLimit,
        items: state.items.map((item) =>
          sanitizeQueryHistoryItemForSettings(item, resultRowLimit),
        ),
      };
    }),
  setSearch: (search) => set({ search }),
  setScope: (scope) => set({ scope }),
  select: (selectedId) => set({ selectedId }),
  openDialog: (preferredId) =>
    set((state) => ({
      open: true,
      selectedId: preferredId ?? state.selectedId ?? state.items[0]?.id ?? null,
    })),
  closeDialog: () => set({ open: false }),
  deleteItem: (id) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),
  clearItems: (ids) =>
    set((state) => {
      const deleteIds = new Set(ids);
      return {
        items: state.items.filter((item) => !deleteIds.has(item.id)),
        selectedId:
          state.selectedId && deleteIds.has(state.selectedId)
            ? null
            : state.selectedId,
      };
    }),
}));

let lastPersistedItems = useQueryHistoryStore.getState().items;
let lastPersistedMaxItems = useQueryHistoryStore.getState().maxItems;
let lastPersistedResultRowLimit =
  useQueryHistoryStore.getState().resultRowLimit;
useQueryHistoryStore.subscribe((state) => {
  const localStorage = storage();
  if (!localStorage) {
    return;
  }
  if (state.items !== lastPersistedItems) {
    lastPersistedItems = state.items;
    localStorage.setItem(queryHistoryStorageKey, JSON.stringify(state.items));
  }
  if (state.maxItems !== lastPersistedMaxItems) {
    lastPersistedMaxItems = state.maxItems;
    localStorage.setItem(
      queryHistoryMaxItemsStorageKey,
      String(state.maxItems),
    );
  }
  if (state.resultRowLimit !== lastPersistedResultRowLimit) {
    lastPersistedResultRowLimit = state.resultRowLimit;
    localStorage.setItem(
      queryHistoryResultRowsStorageKey,
      String(state.resultRowLimit),
    );
  }
});
