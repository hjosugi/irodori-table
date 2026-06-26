import { create } from "zustand";

export const maxQueryHistoryItems = 200;
export const queryHistoryDisplayLimit = 25;
const queryHistoryStorageKey = "irodori.queryHistory.v1";

export type QueryHistoryStatus = "ok" | "error";
export type HistoryScope = "active" | "all";

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
  ranAt: string;
};

type QueryHistoryState = {
  items: QueryHistoryItem[];
  search: string;
  open: boolean;
  scope: HistoryScope;
  selectedId: string | null;
  append: (item: QueryHistoryItem) => void;
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

function loadQueryHistory(): QueryHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(queryHistoryStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .flatMap((item): QueryHistoryItem[] => {
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
          return [];
        }
        return [
          {
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
            ranAt: item.ranAt,
          },
        ];
      })
      .slice(0, maxQueryHistoryItems);
  } catch {
    return [];
  }
}

export const useQueryHistoryStore = create<QueryHistoryState>((set) => ({
  items: loadQueryHistory(),
  search: "",
  open: false,
  scope: "active",
  selectedId: null,
  append: (item) =>
    set((state) => ({
      items: [item, ...state.items].slice(0, maxQueryHistoryItems),
    })),
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
useQueryHistoryStore.subscribe((state) => {
  if (state.items === lastPersistedItems) {
    return;
  }
  lastPersistedItems = state.items;
  window.localStorage.setItem(queryHistoryStorageKey, JSON.stringify(state.items));
});
