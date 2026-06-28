import { type RefObject, useMemo } from "react";
import {
  buildResultGridViewModel,
  formatResultGridTsvRow,
  normalizeResultCellRange,
  readResultCellRangeRows,
  summarizeResultCellRange,
  type ResultGridRowLike,
  type SelectedCell,
  type ResultCellRange,
} from "@/features/results";
import { clampNumber } from "../app-workbench-utils";

type ValueUpdater<T> = T | ((current: T) => T);

type ResultGridViewModel = ReturnType<typeof buildResultGridViewModel>;

type UseResultGridSelectionParams = {
  resultGridView: ResultGridViewModel;
  resultColumns: readonly unknown[];
  gridRef: RefObject<HTMLDivElement | null>;
  totalRows: number;
  selectedCell: SelectedCell;
  selectedRange: ResultCellRange;
  selectedRowKey: string | null;
  setSelectedCell: (value: ValueUpdater<SelectedCell>) => void;
  setSelectedRange: (value: ValueUpdater<ResultCellRange>) => void;
  setSelectedRowKey: (value: ValueUpdater<string | null>) => void;
  scrollGridCellIntoView: (rowIndex: number, col: number) => void;
  copyCellsForRow: (row: ResultGridRowLike) => string[];
};

/**
 * Owns the result grid's cell/row selection commands and the derived selection
 * range memos. The raw selection state lives in `useResultGridStore` and is
 * subscribed in `AppWorkbench` (the scroll hook and query-execution path need
 * the setters before this hook runs), so it is passed in here along with the
 * later-computed `resultGridView`, `totalRows`, and `scrollGridCellIntoView`.
 */
export function useResultGridSelection({
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
}: UseResultGridSelectionParams) {
  const selectedRangeBounds = useMemo(
    () => normalizeResultCellRange(resultGridView, selectedRange),
    [resultGridView, selectedRange],
  );
  const selectionSummary = useMemo(
    () => summarizeResultCellRange(resultGridView, selectedRangeBounds),
    [resultGridView, selectedRangeBounds],
  );

  function selectGridCell(rowKey: string, col: number, extendRange = false) {
    const nextCell = { key: rowKey, col };
    const anchor =
      selectedRange?.anchor ??
      selectedCell ??
      (selectedRowKey ? { key: selectedRowKey, col } : nextCell);
    setSelectedRowKey(rowKey);
    setSelectedCell(nextCell);
    setSelectedRange(
      extendRange &&
        (anchor.key !== nextCell.key || anchor.col !== nextCell.col)
        ? { anchor, focus: nextCell }
        : null,
    );
    gridRef.current?.focus({ preventScroll: true });
  }

  function selectGridRow(rowKey: string, focusGrid = false) {
    setSelectedRowKey(rowKey);
    setSelectedCell(null);
    setSelectedRange(null);
    if (focusGrid) {
      gridRef.current?.focus({ preventScroll: true });
    }
  }

  function moveSelectedCell(
    rowDelta: number,
    colDelta: number,
    extendRange = false,
  ) {
    if (totalRows === 0 || resultColumns.length === 0) {
      return;
    }
    const firstRow = resultGridView.rowAt(0);
    const currentKey = selectedCell?.key ?? selectedRowKey ?? firstRow?.key;
    const currentRowIndex = currentKey
      ? Math.max(0, resultGridView.displayIndexForKey(currentKey))
      : 0;
    const currentCol = selectedCell?.col ?? 0;
    const nextRowIndex = clampNumber(
      currentRowIndex + rowDelta,
      0,
      totalRows - 1,
    );
    const nextCol = clampNumber(
      currentCol + colDelta,
      0,
      Math.max(0, resultColumns.length - 1),
    );
    const nextRow = resultGridView.rowAt(nextRowIndex);
    if (!nextRow) {
      return;
    }
    const nextCell = { key: nextRow.key, col: nextCol };
    const anchor =
      selectedRange?.anchor ??
      selectedCell ??
      (currentKey ? { key: currentKey, col: currentCol } : nextCell);
    setSelectedRowKey(nextCell.key);
    setSelectedCell(nextCell);
    setSelectedRange(
      extendRange &&
        (anchor.key !== nextCell.key || anchor.col !== nextCell.col)
        ? { anchor, focus: nextCell }
        : null,
    );
    gridRef.current?.focus({ preventScroll: true });
    scrollGridCellIntoView(nextRowIndex, nextCol);
  }

  function selectedDisplayRow() {
    if (!selectedCell && !selectedRowKey) {
      return null;
    }
    const key = selectedCell?.key ?? selectedRowKey;
    if (!key) {
      return null;
    }
    const index = resultGridView.displayIndexForKey(key);
    return index >= 0 ? resultGridView.rowAt(index) : null;
  }

  function selectedRowForCopy() {
    const key = selectedRowKey ?? selectedCell?.key;
    if (!key) {
      return null;
    }
    const index = resultGridView.displayIndexForKey(key);
    return index >= 0 ? resultGridView.rowAt(index) : null;
  }

  function selectedGridCopyText(): string | null {
    if (selectedRangeBounds) {
      return readResultCellRangeRows(resultGridView, selectedRangeBounds)
        .map(formatResultGridTsvRow)
        .join("\n");
    }
    if (selectedCell) {
      const row = selectedDisplayRow();
      if (row) {
        return row.cells[selectedCell.col] ?? "";
      }
    }
    const row = selectedRowForCopy();
    return row ? formatResultGridTsvRow(copyCellsForRow(row)) : null;
  }

  return {
    selectedRangeBounds,
    selectionSummary,
    selectGridCell,
    selectGridRow,
    moveSelectedCell,
    selectedDisplayRow,
    selectedRowForCopy,
    selectedGridCopyText,
  };
}
