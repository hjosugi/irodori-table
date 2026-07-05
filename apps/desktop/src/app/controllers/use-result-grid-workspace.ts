import { useEffect, useRef, useState, type RefObject } from "react";
import type { ShowActionNotice } from "@/app/ActionToast";
import {
  GRID_COLUMN_WIDTH,
  GRID_GUTTER_WIDTH,
  GRID_ROW_HEIGHT,
  scaledUiPixels,
} from "@/app/app-workbench-utils";
import { useResultGridFiltering } from "@/app/hooks/useResultGridFiltering";
import { useResultGridScroll } from "@/app/hooks/useResultGridScroll";
import { useResultGridSelection } from "@/app/hooks/useResultGridSelection";
import type { ResultGridController } from "@/app/controllers/workbench-controllers";
import { useResultExport } from "@/app/controllers/use-result-export";
import { useResultGridEditing } from "@/app/controllers/use-result-grid-editing";
import { useResultGridModel } from "@/app/controllers/use-result-grid-model";
import {
  usePendingResultChangesGuard,
  useResultGridSpillPaging,
} from "@/app/controllers/use-result-grid-runtime";
import type { ConfirmOptions } from "@/components/ConfirmDialog";
import type { SqlEditorHandle } from "@/features/query-editor";
import {
  WindowedRows,
  formatResultSelectionStatus,
  toCount,
  useResultGridStore,
  useResultsStore,
  type ResultExportFormat,
} from "@/features/results";
import type { Translator } from "@/i18n";
import type {
  DatabaseMetadata,
  DbEngine,
  DbObjectMetadata,
  QueryResult,
} from "@/generated/irodori-api";

export type ResultGridWorkspaceDeps = {
  uiZoom: number;
  query: string;
  editorEngine: DbEngine;
  activeEngine: DbEngine;
  activeMetadata: DatabaseMetadata | undefined;
  metadataByConnection: Record<string, DatabaseMetadata>;
  activeConnectionId: string;
  activeConnectionReadOnly: boolean;
  biOpen: boolean;
  activeEditorApi: () => SqlEditorHandle | null;
  // Selecting a grid row surfaces its detail in the right sidebar
  // (VS Code-style: the detail view follows the selection).
  onRowSelected?: () => void;
  // Supplied through a deferring closure: the editor-commands hook that owns
  // runQuery is created after this workspace because it needs activeResult.
  runQuery: () => Promise<void>;
  setQueryError: (value: unknown | null) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

// The whole result-grid surface behind one seam: result state, spill paging,
// scroll/filter/selection/model/editing/export wiring, and a builder for the
// ResultGridController consumed by ResultsPane.
export function useResultGridWorkspace({
  uiZoom,
  query,
  editorEngine,
  activeEngine,
  activeMetadata,
  metadataByConnection,
  activeConnectionId,
  activeConnectionReadOnly,
  biOpen,
  activeEditorApi,
  onRowSelected,
  runQuery,
  setQueryError,
  confirm,
  showActionNotice,
  t,
}: ResultGridWorkspaceDeps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  // EXEC-010: when a run spills past the in-memory budget, the grid pages rows from
  // disk through this handle instead of holding them all in JS. `spillInfo` drives
  // the windowed grid path; `spillRef` holds the live LRU page source; the version
  // counter forces the grid view model to recompute as pages arrive.
  const resultOffloadEnabled = useResultsStore(
    (state) => state.resultOffloadEnabled,
  );
  const setResultOffloadEnabled = useResultsStore(
    (state) => state.setResultOffloadEnabled,
  );
  const resultMemoryBudget = useResultsStore(
    (state) => state.resultMemoryBudget,
  );
  const setResultMemoryBudget = useResultsStore(
    (state) => state.setResultMemoryBudget,
  );
  const spillInfo = useResultGridStore((state) => state.spillInfo);
  const setSpillInfo = useResultGridStore((state) => state.setSpillInfo);
  const gridWindowVersion = useResultGridStore(
    (state) => state.gridWindowVersion,
  );
  const setGridWindowVersion = useResultGridStore(
    (state) => state.setGridWindowVersion,
  );
  const bumpGridWindowVersion = useResultGridStore(
    (state) => state.bumpGridWindowVersion,
  );
  const spillRef = useRef<{ handle: string; source: WindowedRows } | null>(
    null,
  );
  const beginPendingPage = useResultGridStore(
    (state) => state.beginPendingPage,
  );
  const endPendingPage = useResultGridStore((state) => state.endPendingPage);
  const clearPendingPages = useResultGridStore(
    (state) => state.clearPendingPages,
  );
  const activeResultIndex = useResultGridStore(
    (state) => state.activeResultIndex,
  );
  const setActiveResultIndex = useResultGridStore(
    (state) => state.setActiveResultIndex,
  );
  const resultMode = useResultGridStore((state) => state.resultMode);
  const setResultMode = useResultGridStore((state) => state.setResultMode);
  const tableViewObject = useResultGridStore((state) => state.tableViewObject);
  const setTableViewObject = useResultGridStore(
    (state) => state.setTableViewObject,
  );
  // SQL of the last run, used to infer the editable target table.
  const [lastRunSql, setLastRunSql] = useState<string>("");
  // Staged (non-immediate) result editing: changes accumulate until Commit.
  const editMode = useResultGridStore((state) => state.editMode);
  const setEditMode = useResultGridStore((state) => state.setEditMode);
  const cellEdits = useResultGridStore((state) => state.cellEdits);
  const newRows = useResultGridStore((state) => state.newRows);
  const deletedRows = useResultGridStore((state) => state.deletedRows);
  const editUndoDepth = useResultGridStore(
    (state) => state.editUndoStack.length,
  );
  const updateEditDraft = useResultGridStore((state) => state.updateEditDraft);
  const undoEdit = useResultGridStore((state) => state.undoEdit);
  const editingCell = useResultGridStore((state) => state.editingCell);
  const setEditingCell = useResultGridStore((state) => state.setEditingCell);
  const selectedCell = useResultGridStore((state) => state.selectedCell);
  const setSelectedCell = useResultGridStore((state) => state.setSelectedCell);
  const selectedRange = useResultGridStore((state) => state.selectedRange);
  const setSelectedRange = useResultGridStore(
    (state) => state.setSelectedRange,
  );
  const selectedRowKey = useResultGridStore((state) => state.selectedRowKey);
  const setSelectedRowKey = useResultGridStore(
    (state) => state.setSelectedRowKey,
  );
  const committing = useResultGridStore((state) => state.committing);
  const setCommitting = useResultGridStore((state) => state.setCommitting);
  const commitError = useResultGridStore((state) => state.commitError);
  const setCommitError = useResultGridStore((state) => state.setCommitError);
  const resetGridStoreEdits = useResultGridStore((state) => state.resetEdits);
  const resetGridStoreView = useResultGridStore((state) => state.resetGridView);
  const gridRowHeight = scaledUiPixels(GRID_ROW_HEIGHT, uiZoom);
  const gridColumnWidth = scaledUiPixels(GRID_COLUMN_WIDTH, uiZoom);
  const gridGutterColumnWidth = scaledUiPixels(GRID_GUTTER_WIDTH, uiZoom);
  const gridGutterWidth = editMode ? gridGutterColumnWidth : 0;
  const {
    gridScrollTop,
    gridScrollLeft,
    gridViewportHeight,
    gridViewportWidth,
    setGridScrollTop,
    setGridScrollLeft,
    onGridScroll,
    resetGridScrollPosition,
    scrollGridCellIntoView,
  } = useResultGridScroll({
    gridRef,
    result,
    gridRowHeight,
    gridGutterWidth,
    gridColumnWidth,
    setSelectedRowKey,
    setSelectedCell,
    setSelectedRange,
  });
  const {
    sortRules,
    filtersOpen,
    setFiltersOpen,
    quickFilter,
    filterJoin,
    setFilterJoin,
    filterRules,
    updateQuickFilter,
    clearQuickFilter,
    toggleSort,
    addFilterRule,
    updateFilterRule,
    removeFilterRule,
    clearResultFilters,
  } = useResultGridFiltering({ resetGridScrollPosition });
  const {
    activeFilters,
    activeResult,
    activeResultIndexView,
    chartAvailable,
    chartResultModel,
    copyCellsForRow,
    displayedResultSummary,
    effectiveResultMode,
    filteredOutCount,
    filtersActive,
    firstVisible,
    graphAvailable,
    graphResultModel,
    gridRowStyle,
    gridTotalWidth,
    lastVisible,
    leftColumnPad,
    pendingCount,
    resultColumns,
    resultGridView,
    resultSets,
    rightColumnPad,
    rowDetailTable,
    selectedRowValues,
    showingStructure,
    sortRuleByColumn,
    structureObject,
    totalRows,
    topPad,
    bottomPad,
    unfilteredRowCount,
    visibleColumnIndexes,
    visibleRows,
    visibleRowsRevision,
    webGlAvailable,
  } = useResultGridModel({
    result,
    activeResultIndex,
    resultMode,
    tableViewObject,
    query,
    editorEngine,
    activeMetadata,
    biOpen,
    spillInfo,
    gridWindowVersion,
    editMode,
    cellEdits,
    newRows,
    deletedRows,
    filterRules,
    quickFilter,
    filterJoin,
    sortRules,
    selectedRowKey,
    gridGutterWidth,
    gridGutterColumnWidth,
    gridColumnWidth,
    gridScrollLeft,
    gridViewportWidth,
    gridScrollTop,
    gridViewportHeight,
    gridRowHeight,
    t,
  });

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.scrollTop = 0;
      gridRef.current.scrollLeft = 0;
    }
    setGridScrollTop(0);
    setGridScrollLeft(0);
    setSelectedRowKey(null);
    setSelectedCell(null);
    setSelectedRange(null);
  }, [activeResultIndexView, result]);

  const {
    selectedRangeBounds,
    selectionSummary,
    selectGridCell,
    selectGridRow,
    moveSelectedCell,
    selectedDisplayRow,
    selectedRowForCopy,
    selectedGridCopyText,
  } = useResultGridSelection({
    resultGridView,
    resultColumns,
    gridRef,
    totalRows,
    selectedCell,
    selectedRange,
    selectedRowKey,
    setSelectedCell,
    setSelectedRange,
    setSelectedRowKey,
    scrollGridCellIntoView,
    copyCellsForRow,
  });
  const selectionStatus = selectionSummary
    ? formatResultSelectionStatus(selectionSummary)
    : null;
  const {
    selectResultSet,
    resetEdits,
    resetGridView,
    releaseActiveSpill,
    beginCellEdit,
    setCellValue,
    addNewRow,
    enableEditMode,
    discardEdits,
    deleteRow,
    pasteTableAt,
    undoLastEdit,
    copySelectedGridCellOrRow,
    copySelectedGridRow,
    copyVisibleResult,
    onGridKeyDown,
    onGridPaste,
    onGridCopy,
    inferEditTarget,
    canEditActiveResult,
    generateSelectedRowChangeSql,
    commitEdits,
  } = useResultGridEditing({
    result,
    activeResult,
    resultColumns,
    resultGridView,
    totalRows,
    showingStructure,
    selectedRowValues,
    activeConnectionId,
    activeConnectionReadOnly,
    activeEngine,
    lastRunSql,
    metadataByConnection,
    editMode,
    editUndoDepth,
    cellEdits,
    newRows,
    deletedRows,
    editingCell,
    selectedCell,
    setActiveResultIndex,
    setEditMode,
    setEditingCell,
    setSelectedRowKey,
    setSelectedRange,
    setCommitting,
    setCommitError,
    setSpillInfo,
    setGridWindowVersion,
    updateEditDraft,
    undoEdit,
    resetGridStoreEdits,
    resetGridStoreView,
    clearPendingPages,
    setQueryError,
    spillRef,
    resetGridScrollPosition,
    selectGridCell,
    moveSelectedCell,
    selectedDisplayRow,
    selectedRowForCopy,
    selectedGridCopyText,
    copyCellsForRow,
    activeEditorApi,
    runQuery,
    showActionNotice,
    confirm,
    t,
  });

  const { exportActiveResult, copyActiveResultSqlInserts, copyActiveResultAs } =
    useResultExport({
      activeResult,
      activeConnectionId,
      inferEditTarget,
      setExportMenuOpen,
      showActionNotice,
      t,
    });

  usePendingResultChangesGuard({
    pendingCount,
    resetEdits,
    showActionNotice,
    confirm,
    t,
  });

  // Discard clears every staged edit plus the undo stack, so gate it the same
  // way commit gates row deletes instead of firing on a single click.
  async function requestDiscardEdits() {
    if (pendingCount > 0) {
      const confirmed = await confirm({
        title: t("results.confirmDiscardEdits.title", {
          count: toCount(pendingCount),
        }),
        message: t("results.confirmDiscardEdits.message"),
        confirmLabel: t("results.confirmDiscardEdits.confirm"),
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
    }
    discardEdits();
  }
  useResultGridSpillPaging({
    spillInfo,
    spillRef,
    firstVisible,
    lastVisible,
    gridWindowVersion,
    beginPendingPage,
    endPendingPage,
    clearPendingPages,
    bumpGridWindowVersion,
  });

  function buildResultGridController(extra: {
    running: boolean;
    queryError: unknown | null;
    importFileRef: RefObject<HTMLInputElement | null>;
    shortcutTips: { label: string; shortcut: string | null }[];
    formatObjectName: (object: DbObjectMetadata) => string;
    onImportFile: (file: File) => void;
  }): ResultGridController {
    return {
      running: extra.running,
      readOnly: activeConnectionReadOnly,
      tableViewObject,
      resultMode: effectiveResultMode,
      chartModel: chartResultModel,
      graphModel: graphResultModel,
      chartAvailable,
      graphAvailable,
      webGlAvailable,
      resultSets,
      activeResult,
      hasResult: Boolean(activeResult),
      activeResultIndex: activeResultIndexView,
      queryError: extra.queryError,
      commitError,
      pendingCount,
      displayedResultSummary,
      resultColumns,
      exportMenuOpen,
      shortcutTips: extra.shortcutTips,
      showingStructure,
      structureObject,
      unfilteredRowCount,
      totalRows,
      gridRef,
      importFileRef: extra.importFileRef,
      formatObjectName: extra.formatObjectName,
      formatCount: toCount,
      onResultModeChange: setResultMode,
      onSelectResultSet: selectResultSet,
      onExportActiveResult: exportActiveResult,
      onToggleExportMenu: () => setExportMenuOpen((open) => !open),
      onCloseExportMenu: () => setExportMenuOpen(false),
      onCopyVisibleResult: () => void copyVisibleResult(),
      onCopyResultAs: (format: ResultExportFormat) =>
        void copyActiveResultAs(format),
      onImportFile: extra.onImportFile,
      filtering: {
        quickFilter,
        filtersOpen,
        filtersActive,
        activeFilters,
        filteredOutCount,
        filterJoin,
        filterRules,
        sortRuleByColumn,
        sortRules,
        onQuickFilterChange: updateQuickFilter,
        onClearQuickFilter: clearQuickFilter,
        onToggleFilters: () => setFiltersOpen((open) => !open),
        onSetFilterJoin: setFilterJoin,
        onAddFilterRule: addFilterRule,
        onUpdateFilterRule: updateFilterRule,
        onRemoveFilterRule: removeFilterRule,
        onClearResultFilters: clearResultFilters,
        onToggleSort: toggleSort,
        onCloseFilters: () => setFiltersOpen(false),
      },
      editing: {
        editMode,
        editUndoDepth,
        committing,
        cellEdits,
        editingCell,
        canEditActiveResult,
        onAddNewRow: addNewRow,
        onUndoEdit: undoLastEdit,
        onCommitEdits: () => void commitEdits(),
        onDiscardEdits: () => void requestDiscardEdits(),
        onGenerateRowChangeSql: generateSelectedRowChangeSql,
        onEnableEditMode: enableEditMode,
        onBeginCellEdit: beginCellEdit,
        onSetCellValue: setCellValue,
        onDeleteRow: deleteRow,
        onPasteTableAt: pasteTableAt,
        onEndCellEdit: () => setEditingCell(null),
      },
      selection: {
        selectedRowKey,
        selectedCell,
        selectedRangeBounds,
        selectedRowValues,
        onSelectGridRow: (rowKey, focusGrid) => {
          selectGridRow(rowKey, focusGrid);
          onRowSelected?.();
        },
        // Cell clicks select the row too, so they surface the detail as well
        // (parity with the old always-visible drawer).
        onSelectGridCell: (rowKey, col, extendRange) => {
          selectGridCell(rowKey, col, extendRange);
          onRowSelected?.();
        },
      },
      gridGeometry: {
        gridRowStyle,
        gridTotalWidth,
        gridRowHeight,
        gridColumnWidth,
        leftColumnPad,
        rightColumnPad,
        topPad,
        bottomPad,
        firstVisible,
        visibleColumnIndexes,
        visibleRows,
        visibleRowsRevision,
        onGridScroll,
        onGridKeyDown,
        onGridPaste,
        onGridCopy,
      },
    } satisfies ResultGridController;
  }

  return {
    result,
    setResult,
    setLastRunSql,
    resultOffloadEnabled,
    setResultOffloadEnabled,
    resultMemoryBudget,
    setResultMemoryBudget,
    // Row Detail renders in the right sidebar (not inside the results pane),
    // so its inputs are part of the workspace surface.
    resultColumns,
    selectedRowValues,
    rowDetailTable,
    clearRowSelection: () => {
      setSelectedRowKey(null);
      setSelectedCell(null);
      setSelectedRange(null);
    },
    gridRef,
    spillRef,
    setSpillInfo,
    clearPendingPages,
    bumpGridWindowVersion,
    setGridScrollTop,
    setGridScrollLeft,
    setSelectedRowKey,
    setSelectedCell,
    setSelectedRange,
    setResultMode,
    setTableViewObject,
    setActiveResultIndex,
    editMode,
    setEditMode,
    setCommitError,
    filtersOpen,
    setFiltersOpen,
    exportMenuOpen,
    setExportMenuOpen,
    activeResult,
    chartResultModel,
    chartAvailable,
    selectionStatus,
    resetEdits,
    resetGridView,
    releaseActiveSpill,
    addNewRow,
    undoLastEdit,
    commitEdits,
    canEditActiveResult,
    copySelectedGridCellOrRow,
    copySelectedGridRow,
    copyVisibleResult,
    exportActiveResult,
    copyActiveResultSqlInserts,
    copyActiveResultAs,
    buildResultGridController,
  };
}

export type ResultGridWorkspace = ReturnType<typeof useResultGridWorkspace>;
