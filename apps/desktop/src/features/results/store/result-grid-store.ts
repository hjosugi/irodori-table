import { create } from "zustand";
import type { DbObjectMetadata } from "@/generated/irodori-api";
import type {
  ResultFilterJoin,
  ResultFilterRule,
  ResultSortRule,
} from "../result-grid";
import type { ResultGridDraftCell as GridCellDraft } from "../result-view-model";
import type {
  EditingCell,
  ResultCellRange,
  ResultMode,
  SelectedCell,
} from "../types";

type ValueUpdater<T> = T | ((current: T) => T);

type SpillInfo = {
  handle: string;
  total: number;
};

export type ResultGridEditDraft = {
  cellEdits: Map<string, GridCellDraft>;
  newRows: GridCellDraft[][];
  deletedRows: Set<number>;
};

const maxEditUndoDepth = 10;

type ResultGridState = {
  gridScrollTop: number;
  gridScrollLeft: number;
  gridViewportHeight: number;
  gridViewportWidth: number;
  spillInfo: SpillInfo | null;
  gridWindowVersion: number;
  pendingPageRequests: Map<number, string>;
  activeResultIndex: number;
  resultMode: ResultMode;
  tableViewObject: DbObjectMetadata | null;
  editMode: boolean;
  cellEdits: Map<string, GridCellDraft>;
  newRows: GridCellDraft[][];
  deletedRows: Set<number>;
  editingCell: EditingCell;
  selectedCell: SelectedCell;
  selectedRange: ResultCellRange;
  sortRules: ResultSortRule[];
  filtersOpen: boolean;
  quickFilter: string;
  filterJoin: ResultFilterJoin;
  filterRules: ResultFilterRule[];
  selectedRowKey: string | null;
  committing: boolean;
  commitError: string | null;
  editUndoStack: ResultGridEditDraft[];
  setGridScrollTop: (value: ValueUpdater<number>) => void;
  setGridScrollLeft: (value: ValueUpdater<number>) => void;
  setGridViewportHeight: (value: ValueUpdater<number>) => void;
  setGridViewportWidth: (value: ValueUpdater<number>) => void;
  setSpillInfo: (value: ValueUpdater<SpillInfo | null>) => void;
  setGridWindowVersion: (value: ValueUpdater<number>) => void;
  bumpGridWindowVersion: () => void;
  beginPendingPage: (pageIndex: number, requestId: string) => boolean;
  endPendingPage: (pageIndex: number, requestId: string) => void;
  clearPendingPages: () => void;
  setActiveResultIndex: (value: ValueUpdater<number>) => void;
  setResultMode: (value: ValueUpdater<ResultMode>) => void;
  setTableViewObject: (value: ValueUpdater<DbObjectMetadata | null>) => void;
  setEditMode: (value: ValueUpdater<boolean>) => void;
  setEditingCell: (value: ValueUpdater<EditingCell>) => void;
  setSelectedCell: (value: ValueUpdater<SelectedCell>) => void;
  setSelectedRange: (value: ValueUpdater<ResultCellRange>) => void;
  setSortRules: (value: ValueUpdater<ResultSortRule[]>) => void;
  setFiltersOpen: (value: ValueUpdater<boolean>) => void;
  setQuickFilter: (value: ValueUpdater<string>) => void;
  setFilterJoin: (value: ValueUpdater<ResultFilterJoin>) => void;
  setFilterRules: (value: ValueUpdater<ResultFilterRule[]>) => void;
  setSelectedRowKey: (value: ValueUpdater<string | null>) => void;
  setCommitting: (value: ValueUpdater<boolean>) => void;
  setCommitError: (value: ValueUpdater<string | null>) => void;
  updateEditDraft: (
    updater: (draft: ResultGridEditDraft) => ResultGridEditDraft,
  ) => void;
  undoEdit: () => boolean;
  resetEdits: () => void;
  resetGridView: () => void;
};

function resolveValue<T>(current: T, value: ValueUpdater<T>): T {
  return typeof value === "function"
    ? (value as (current: T) => T)(current)
    : value;
}

function cloneEditDraft(draft: ResultGridEditDraft): ResultGridEditDraft {
  return {
    cellEdits: new Map(draft.cellEdits),
    newRows: draft.newRows.map((row) => [...row]),
    deletedRows: new Set(draft.deletedRows),
  };
}

function draftFromState(state: ResultGridEditDraft): ResultGridEditDraft {
  return cloneEditDraft(state);
}

function sameEditDraft(
  left: ResultGridEditDraft,
  right: ResultGridEditDraft,
): boolean {
  if (left.cellEdits.size !== right.cellEdits.size) {
    return false;
  }
  for (const [key, value] of left.cellEdits) {
    if (!right.cellEdits.has(key) || right.cellEdits.get(key) !== value) {
      return false;
    }
  }
  if (left.newRows.length !== right.newRows.length) {
    return false;
  }
  for (let rowIndex = 0; rowIndex < left.newRows.length; rowIndex += 1) {
    const leftRow = left.newRows[rowIndex];
    const rightRow = right.newRows[rowIndex];
    if (leftRow.length !== rightRow.length) {
      return false;
    }
    for (let col = 0; col < leftRow.length; col += 1) {
      if (leftRow[col] !== rightRow[col]) {
        return false;
      }
    }
  }
  if (left.deletedRows.size !== right.deletedRows.size) {
    return false;
  }
  for (const rowIndex of left.deletedRows) {
    if (!right.deletedRows.has(rowIndex)) {
      return false;
    }
  }
  return true;
}

export const useResultGridStore = create<ResultGridState>((set, get) => ({
  gridScrollTop: 0,
  gridScrollLeft: 0,
  gridViewportHeight: 480,
  gridViewportWidth: 900,
  spillInfo: null,
  gridWindowVersion: 0,
  pendingPageRequests: new Map(),
  activeResultIndex: 0,
  resultMode: "data",
  tableViewObject: null,
  editMode: false,
  cellEdits: new Map(),
  newRows: [],
  deletedRows: new Set(),
  editingCell: null,
  selectedCell: null,
  selectedRange: null,
  sortRules: [],
  filtersOpen: false,
  quickFilter: "",
  filterJoin: "and",
  filterRules: [],
  selectedRowKey: null,
  committing: false,
  commitError: null,
  editUndoStack: [],
  setGridScrollTop: (value) =>
    set((state) => ({
      gridScrollTop: resolveValue(state.gridScrollTop, value),
    })),
  setGridScrollLeft: (value) =>
    set((state) => ({
      gridScrollLeft: resolveValue(state.gridScrollLeft, value),
    })),
  setGridViewportHeight: (value) =>
    set((state) => ({
      gridViewportHeight: resolveValue(state.gridViewportHeight, value),
    })),
  setGridViewportWidth: (value) =>
    set((state) => ({
      gridViewportWidth: resolveValue(state.gridViewportWidth, value),
    })),
  setSpillInfo: (value) =>
    set((state) => ({ spillInfo: resolveValue(state.spillInfo, value) })),
  setGridWindowVersion: (value) =>
    set((state) => ({
      gridWindowVersion: resolveValue(state.gridWindowVersion, value),
    })),
  bumpGridWindowVersion: () =>
    set((state) => ({ gridWindowVersion: state.gridWindowVersion + 1 })),
  beginPendingPage: (pageIndex, requestId) => {
    const pending = get().pendingPageRequests;
    if (pending.has(pageIndex)) {
      return false;
    }
    set({ pendingPageRequests: new Map(pending).set(pageIndex, requestId) });
    return true;
  },
  endPendingPage: (pageIndex, requestId) =>
    set((state) => {
      if (state.pendingPageRequests.get(pageIndex) !== requestId) {
        return {};
      }
      const pendingPageRequests = new Map(state.pendingPageRequests);
      pendingPageRequests.delete(pageIndex);
      return { pendingPageRequests };
    }),
  clearPendingPages: () =>
    set((state) =>
      state.pendingPageRequests.size === 0
        ? {}
        : { pendingPageRequests: new Map() },
    ),
  setActiveResultIndex: (value) =>
    set((state) => ({
      activeResultIndex: resolveValue(state.activeResultIndex, value),
    })),
  setResultMode: (value) =>
    set((state) => ({ resultMode: resolveValue(state.resultMode, value) })),
  setTableViewObject: (value) =>
    set((state) => ({
      tableViewObject: resolveValue(state.tableViewObject, value),
    })),
  setEditMode: (value) =>
    set((state) => ({ editMode: resolveValue(state.editMode, value) })),
  setEditingCell: (value) =>
    set((state) => ({
      editingCell: resolveValue(state.editingCell, value),
    })),
  setSelectedCell: (value) =>
    set((state) => ({
      selectedCell: resolveValue(state.selectedCell, value),
    })),
  setSelectedRange: (value) =>
    set((state) => ({
      selectedRange: resolveValue(state.selectedRange, value),
    })),
  setSortRules: (value) =>
    set((state) => ({ sortRules: resolveValue(state.sortRules, value) })),
  setFiltersOpen: (value) =>
    set((state) => ({
      filtersOpen: resolveValue(state.filtersOpen, value),
    })),
  setQuickFilter: (value) =>
    set((state) => ({ quickFilter: resolveValue(state.quickFilter, value) })),
  setFilterJoin: (value) =>
    set((state) => ({ filterJoin: resolveValue(state.filterJoin, value) })),
  setFilterRules: (value) =>
    set((state) => ({
      filterRules: resolveValue(state.filterRules, value),
    })),
  setSelectedRowKey: (value) =>
    set((state) => ({
      selectedRowKey: resolveValue(state.selectedRowKey, value),
    })),
  setCommitting: (value) =>
    set((state) => ({
      committing: resolveValue(state.committing, value),
    })),
  setCommitError: (value) =>
    set((state) => ({
      commitError: resolveValue(state.commitError, value),
    })),
  updateEditDraft: (updater) =>
    set((state) => {
      const before = draftFromState(state);
      const after = cloneEditDraft(updater(cloneEditDraft(before)));
      if (sameEditDraft(before, after)) {
        return {};
      }
      return {
        ...after,
        editUndoStack: [...state.editUndoStack, before].slice(
          -maxEditUndoDepth,
        ),
        editingCell: null,
        commitError: null,
      };
    }),
  undoEdit: () => {
    const state = get();
    const previous = state.editUndoStack[state.editUndoStack.length - 1];
    if (!previous) {
      return false;
    }
    set({
      ...cloneEditDraft(previous),
      editUndoStack: state.editUndoStack.slice(0, -1),
      editingCell: null,
      commitError: null,
    });
    return true;
  },
  resetEdits: () =>
    set({
      cellEdits: new Map(),
      newRows: [],
      deletedRows: new Set(),
      editingCell: null,
      selectedCell: null,
      selectedRange: null,
      commitError: null,
      editUndoStack: [],
    }),
  resetGridView: () =>
    set({
      sortRules: [],
      quickFilter: "",
      filterRules: [],
      filterJoin: "and",
      filtersOpen: false,
      selectedRange: null,
    }),
}));
