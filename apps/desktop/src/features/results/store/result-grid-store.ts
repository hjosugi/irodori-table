import { create } from "zustand";
import type { DbObjectMetadata } from "@/generated/irodori-api";
import type {
  ResultFilterJoin,
  ResultFilterRule,
  ResultSortRule,
} from "@/result-grid";
import type { ResultGridDraftCell as GridCellDraft } from "@/result-view-model";
import type { EditingCell, ResultMode, SelectedCell } from "../types";

type ValueUpdater<T> = T | ((current: T) => T);

type SpillInfo = {
  handle: string;
  total: number;
};

type ResultGridState = {
  gridScrollTop: number;
  gridScrollLeft: number;
  gridViewportHeight: number;
  gridViewportWidth: number;
  spillInfo: SpillInfo | null;
  gridWindowVersion: number;
  activeResultIndex: number;
  resultMode: ResultMode;
  tableViewObject: DbObjectMetadata | null;
  editMode: boolean;
  cellEdits: Map<string, GridCellDraft>;
  newRows: GridCellDraft[][];
  deletedRows: Set<number>;
  editingCell: EditingCell;
  selectedCell: SelectedCell;
  sortRules: ResultSortRule[];
  filtersOpen: boolean;
  quickFilter: string;
  filterJoin: ResultFilterJoin;
  filterRules: ResultFilterRule[];
  selectedRowKey: string | null;
  committing: boolean;
  commitError: string | null;
  setGridScrollTop: (value: ValueUpdater<number>) => void;
  setGridScrollLeft: (value: ValueUpdater<number>) => void;
  setGridViewportHeight: (value: ValueUpdater<number>) => void;
  setGridViewportWidth: (value: ValueUpdater<number>) => void;
  setSpillInfo: (value: ValueUpdater<SpillInfo | null>) => void;
  setGridWindowVersion: (value: ValueUpdater<number>) => void;
  bumpGridWindowVersion: () => void;
  setActiveResultIndex: (value: ValueUpdater<number>) => void;
  setResultMode: (value: ValueUpdater<ResultMode>) => void;
  setTableViewObject: (value: ValueUpdater<DbObjectMetadata | null>) => void;
  setEditMode: (value: ValueUpdater<boolean>) => void;
  setCellEdits: (value: ValueUpdater<Map<string, GridCellDraft>>) => void;
  setNewRows: (value: ValueUpdater<GridCellDraft[][]>) => void;
  setDeletedRows: (value: ValueUpdater<Set<number>>) => void;
  setEditingCell: (value: ValueUpdater<EditingCell>) => void;
  setSelectedCell: (value: ValueUpdater<SelectedCell>) => void;
  setSortRules: (value: ValueUpdater<ResultSortRule[]>) => void;
  setFiltersOpen: (value: ValueUpdater<boolean>) => void;
  setQuickFilter: (value: ValueUpdater<string>) => void;
  setFilterJoin: (value: ValueUpdater<ResultFilterJoin>) => void;
  setFilterRules: (value: ValueUpdater<ResultFilterRule[]>) => void;
  setSelectedRowKey: (value: ValueUpdater<string | null>) => void;
  setCommitting: (value: ValueUpdater<boolean>) => void;
  setCommitError: (value: ValueUpdater<string | null>) => void;
  resetEdits: () => void;
  resetGridView: () => void;
  resetGridSelection: () => void;
  resetScrollPosition: () => void;
};

function resolveValue<T>(current: T, value: ValueUpdater<T>): T {
  return typeof value === "function"
    ? (value as (current: T) => T)(current)
    : value;
}

export const useResultGridStore = create<ResultGridState>((set) => ({
  gridScrollTop: 0,
  gridScrollLeft: 0,
  gridViewportHeight: 480,
  gridViewportWidth: 900,
  spillInfo: null,
  gridWindowVersion: 0,
  activeResultIndex: 0,
  resultMode: "data",
  tableViewObject: null,
  editMode: false,
  cellEdits: new Map(),
  newRows: [],
  deletedRows: new Set(),
  editingCell: null,
  selectedCell: null,
  sortRules: [],
  filtersOpen: false,
  quickFilter: "",
  filterJoin: "and",
  filterRules: [],
  selectedRowKey: null,
  committing: false,
  commitError: null,
  setGridScrollTop: (value) =>
    set((state) => ({ gridScrollTop: resolveValue(state.gridScrollTop, value) })),
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
  setCellEdits: (value) =>
    set((state) => ({ cellEdits: resolveValue(state.cellEdits, value) })),
  setNewRows: (value) =>
    set((state) => ({ newRows: resolveValue(state.newRows, value) })),
  setDeletedRows: (value) =>
    set((state) => ({
      deletedRows: resolveValue(state.deletedRows, value),
    })),
  setEditingCell: (value) =>
    set((state) => ({
      editingCell: resolveValue(state.editingCell, value),
    })),
  setSelectedCell: (value) =>
    set((state) => ({
      selectedCell: resolveValue(state.selectedCell, value),
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
  resetEdits: () =>
    set({
      cellEdits: new Map(),
      newRows: [],
      deletedRows: new Set(),
      editingCell: null,
      selectedCell: null,
      commitError: null,
    }),
  resetGridView: () =>
    set({
      sortRules: [],
      quickFilter: "",
      filterRules: [],
      filterJoin: "and",
      filtersOpen: false,
    }),
  resetGridSelection: () =>
    set({
      selectedRowKey: null,
      selectedCell: null,
    }),
  resetScrollPosition: () =>
    set({
      gridScrollTop: 0,
      gridScrollLeft: 0,
    }),
}));
