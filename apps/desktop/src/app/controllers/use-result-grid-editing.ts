import type {
  ClipboardEvent as ReactClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ActionNotice } from "@/app/ActionToast";
import type { ConfirmOptions } from "@/components/ConfirmDialog";
import {
  buildResultGridViewModel,
  buildSelectedRowChangeSql,
  deriveResultEditTarget,
  formatResultGridCell as formatCell,
  formatResultGridTsv,
  formatResultGridTsvRow,
  resultGridRowKey,
  toCount,
  type ResultEditTarget,
  type ResultGridEditDraft,
  type ResultGridDraftCell as GridCellDraft,
  type ResultGridRowLike,
  type ResultGridRowOrigin,
} from "@/features/results";
import { writeTextToClipboard } from "@/features/erd";
import { queryService } from "@/features/workbench";
import { errorMessage } from "@/core";
import type { Translator } from "@/i18n";
import type {
  CellValue,
  DatabaseMetadata,
  DbEngine,
  QueryResult,
  QueryResultSet,
  RowDelete,
  RowInsert,
  RowUpdate,
  TableEdits,
} from "@/generated/irodori-api";
import type {
  EditingCell,
  ResultCellRange,
  SelectedCell,
  WindowedRows,
} from "@/features/results";
import type { SqlEditorHandle } from "@/features/query-editor";
import {
  GRID_COPY_ROW_LIMIT,
  isEditableTarget,
  parseClipboardTable,
} from "../app-workbench-utils";

// Mirrors the result-grid-store setter contract: accept either the next value or
// an updater that derives it from the current value.
type ValueUpdater<T> = T | ((current: T) => T);

type ResultGridViewModel = ReturnType<typeof buildResultGridViewModel>;
type ResultGridDisplayRow = NonNullable<
  ReturnType<ResultGridViewModel["rowAt"]>
>;

export type ResultGridEditingDeps = {
  // Result + grid view state.
  result: QueryResult | null;
  activeResult: QueryResultSet | null;
  resultColumns: readonly string[];
  resultGridView: ResultGridViewModel;
  totalRows: number;
  showingStructure: boolean;
  selectedRowValues: readonly unknown[] | null;
  // Connection / engine context.
  activeConnectionId: string;
  activeConnectionReadOnly: boolean;
  activeEngine: DbEngine;
  lastRunSql: string;
  metadataByConnection: Record<string, DatabaseMetadata>;
  // Result-grid store edit state.
  editMode: boolean;
  editUndoDepth: number;
  cellEdits: Map<string, GridCellDraft>;
  newRows: GridCellDraft[][];
  deletedRows: Set<number>;
  editingCell: EditingCell;
  selectedCell: SelectedCell;
  // Result-grid store setters / mutators.
  setActiveResultIndex: (value: ValueUpdater<number>) => void;
  setEditMode: (value: ValueUpdater<boolean>) => void;
  setEditingCell: (value: ValueUpdater<EditingCell>) => void;
  setSelectedRowKey: (value: ValueUpdater<string | null>) => void;
  setSelectedRange: (value: ValueUpdater<ResultCellRange>) => void;
  setCommitting: (value: ValueUpdater<boolean>) => void;
  setCommitError: (value: ValueUpdater<string | null>) => void;
  setSpillInfo: (
    value: ValueUpdater<{ handle: string; total: number } | null>,
  ) => void;
  setGridWindowVersion: (value: ValueUpdater<number>) => void;
  updateEditDraft: (
    updater: (draft: ResultGridEditDraft) => ResultGridEditDraft,
  ) => void;
  undoEdit: () => boolean;
  resetGridStoreEdits: () => void;
  resetGridStoreView: () => void;
  clearPendingPages: () => void;
  // Component-level state setters.
  setQueryError: (value: string | null) => void;
  // Refs + collaborating hook outputs / component methods.
  spillRef: { current: { handle: string; source: WindowedRows } | null };
  resetGridScrollPosition: (clearSelection?: boolean) => void;
  selectGridCell: (rowKey: string, col: number, extendRange?: boolean) => void;
  moveSelectedCell: (
    rowDelta: number,
    colDelta: number,
    extendRange?: boolean,
  ) => void;
  selectedDisplayRow: () => ResultGridDisplayRow | null;
  selectedRowForCopy: () => ResultGridRowLike | null;
  selectedGridCopyText: () => string | null;
  copyCellsForRow: (row: ResultGridRowLike) => string[];
  activeEditorApi: () => SqlEditorHandle | null | undefined;
  runQuery: () => Promise<void>;
  showActionNotice: (
    kind: ActionNotice["kind"],
    title: string,
    detail?: string,
  ) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  t: Translator["t"];
};

export function useResultGridEditing(deps: ResultGridEditingDeps) {
  const {
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
  } = deps;

  function selectResultSet(index: number) {
    setActiveResultIndex(index);
    resetEdits();
    resetGridView();
    resetGridScrollPosition(true);
  }

  // Drop every staged edit (called on a new run and after a successful commit).
  function resetEdits() {
    resetGridStoreEdits();
  }

  function resetGridView() {
    resetGridStoreView();
  }

  // EXEC-010: drop the active disk-offloaded result and ask the backend to remove
  // its temp file. Safe to call when nothing is spilled.
  function releaseActiveSpill() {
    const previous = spillRef.current;
    spillRef.current = null;
    clearPendingPages();
    if (previous) {
      void queryService.releaseResult(previous.handle).catch(() => {});
    }
    setSpillInfo(null);
    setGridWindowVersion(0);
  }

  function beginCellEdit(key: string, col: number, seed?: string) {
    if (!editMode) {
      return;
    }
    selectGridCell(key, col);
    setEditingCell(seed === undefined ? { key, col } : { key, col, seed });
  }

  function applyCellValueToDraft(
    draft: ResultGridEditDraft,
    origin: ResultGridRowOrigin,
    col: number,
    value: GridCellDraft,
  ): ResultGridEditDraft {
    if (col < 0 || col >= resultColumns.length) {
      return draft;
    }
    if (origin.kind === "orig") {
      const cellEdits = new Map(draft.cellEdits);
      const key = `o${origin.index}:${col}`;
      const originalRaw = activeResult?.rows[origin.index]?.[col] ?? null;
      const unchanged =
        value === null
          ? originalRaw === null
          : value === formatCell(originalRaw);
      if (unchanged) {
        cellEdits.delete(key);
      } else {
        cellEdits.set(key, value);
      }
      return { ...draft, cellEdits };
    }

    if (!draft.newRows[origin.index]) {
      return draft;
    }
    const newRows = draft.newRows.map((row, index) => {
      if (index !== origin.index) {
        return row;
      }
      const next = [...row];
      next[col] = value;
      return next;
    });
    return { ...draft, newRows };
  }

  // Stage a single cell's new value against its origin (an original row keeps the
  // edit in `cellEdits`; a staged new row mutates `newRows`).
  function setCellValue(
    origin: ResultGridRowOrigin,
    col: number,
    value: GridCellDraft,
  ) {
    updateEditDraft((draft) =>
      applyCellValueToDraft(draft, origin, col, value),
    );
  }

  function addNewRow() {
    if (!canEditActiveResult()) {
      setCommitError(
        "result editing needs a single table query with a visible key",
      );
      return;
    }
    updateEditDraft((draft) => ({
      ...draft,
      newRows: [...draft.newRows, resultColumns.map(() => "")],
    }));
    setEditMode(true);
  }

  function enableEditMode() {
    if (activeConnectionReadOnly) {
      const message = t("notice.grid.readOnlyEditsDetail");
      setCommitError(message);
      showActionNotice("error", t("notice.grid.editBlocked"), message);
      return;
    }
    setCommitError(null);
    setEditMode(true);
  }

  function discardEdits() {
    resetEdits();
    setEditMode(false);
  }

  // Stage a row delete (original rows) or drop a staged new row.
  function deleteRow(origin: ResultGridRowOrigin) {
    const rowKey = resultGridRowKey(origin);
    updateEditDraft((draft) => {
      if (origin.kind === "orig") {
        const deletedRows = new Set(draft.deletedRows).add(origin.index);
        const cellEdits = new Map(draft.cellEdits);
        for (const key of [...cellEdits.keys()]) {
          if (key.startsWith(`o${origin.index}:`)) {
            cellEdits.delete(key);
          }
        }
        return { ...draft, cellEdits, deletedRows };
      }
      return {
        ...draft,
        newRows: draft.newRows.filter((_, index) => index !== origin.index),
      };
    });
    setEditingCell(null);
    setSelectedRowKey((current) => (current === rowKey ? null : current));
    setSelectedRange(null);
  }

  // Paste a TSV/CSV block starting at `origin`/`startCol`, spilling across columns
  // and into staged new rows as needed.
  function pasteTableAt(
    origin: ResultGridRowOrigin,
    startCol: number,
    text: string,
  ) {
    const block = parseClipboardTable(text);
    if (block.length === 0) {
      return;
    }
    const startPos = resultGridView.displayIndexForKey(
      resultGridRowKey(origin),
    );
    if (startPos < 0) {
      return;
    }
    updateEditDraft((draft) => {
      let nextDraft = draft;
      block.forEach((cells, rowOffset) => {
        const target = resultGridView.rowAt(startPos + rowOffset)?.origin;
        if (target) {
          cells.forEach((value, colOffset) => {
            nextDraft = applyCellValueToDraft(
              nextDraft,
              target,
              startCol + colOffset,
              value,
            );
          });
          return;
        }
        const newRow = resultColumns.map((_, col) => {
          const colOffset = col - startCol;
          return colOffset >= 0 && colOffset < cells.length
            ? cells[colOffset]
            : "";
        });
        nextDraft = {
          ...nextDraft,
          newRows: [...nextDraft.newRows, newRow],
        };
      });
      return nextDraft;
    });
    setEditMode(true);
  }

  function undoLastEdit() {
    if (!editMode || editUndoDepth === 0 || showingStructure) {
      return;
    }
    if (undoEdit()) {
      setEditMode(true);
      showActionNotice(
        "info",
        t("notice.grid.editUndone"),
        t("notice.grid.editUndoneDetail"),
      );
    }
  }

  async function copyGridText(text: string | null) {
    if (text === null) {
      showActionNotice("info", t("notice.grid.nothingToCopy"));
      return;
    }
    try {
      await writeTextToClipboard(text);
      showActionNotice(
        "success",
        t("notice.grid.copied"),
        t("notice.grid.copiedDetail"),
      );
    } catch (error) {
      const message = errorMessage(error);
      setQueryError(message);
      showActionNotice("error", t("notice.workbench.copyFailed"), message);
    }
  }

  async function copySelectedGridCellOrRow() {
    if (editingCell) {
      return;
    }
    await copyGridText(selectedGridCopyText());
  }

  async function copySelectedGridRow() {
    if (editingCell) {
      return;
    }
    const row = selectedRowForCopy();
    await copyGridText(
      row ? formatResultGridTsvRow(copyCellsForRow(row)) : null,
    );
  }

  async function copyVisibleResult() {
    if (!activeResult || editingCell || resultColumns.length === 0) {
      return;
    }
    if (totalRows > GRID_COPY_ROW_LIMIT) {
      setQueryError(
        `Copy is capped at ${toCount(GRID_COPY_ROW_LIMIT)} displayed rows; use Export for larger results.`,
      );
      return;
    }
    await copyGridText(
      formatResultGridTsv(
        resultColumns,
        resultGridView.rowsInRange(0, totalRows),
      ),
    );
  }

  function onGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ||
      editingCell
    ) {
      return;
    }
    const row = selectedDisplayRow() ?? resultGridView.rowAt(0);
    const col = selectedCell?.col ?? 0;
    if (!row || resultColumns.length === 0) {
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelectedCell(-1, 0, event.shiftKey);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelectedCell(1, 0, event.shiftKey);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelectedCell(0, -1, event.shiftKey);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelectedCell(0, 1, event.shiftKey);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveSelectedCell(0, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      if (editMode) {
        event.preventDefault();
        beginCellEdit(row.key, col);
      }
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && editMode) {
      event.preventDefault();
      setCellValue(row.origin, col, event.ctrlKey || event.metaKey ? null : "");
      return;
    }
    if (
      editMode &&
      event.key.length === 1 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      beginCellEdit(row.key, col, event.key);
    }
  }

  function onGridPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    if (!editMode) {
      return;
    }
    const row = selectedDisplayRow();
    if (!row || !selectedCell) {
      return;
    }
    event.preventDefault();
    pasteTableAt(
      row.origin,
      selectedCell.col,
      event.clipboardData.getData("text"),
    );
  }

  function onGridCopy(event: ReactClipboardEvent<HTMLDivElement>) {
    if (editingCell || isEditableTarget(event.target)) {
      return;
    }
    const text = selectedGridCopyText();
    if (text === null) {
      return;
    }
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  }

  function inferEditTarget(): ResultEditTarget | null {
    return deriveResultEditTarget({
      sql: lastRunSql,
      metadata: metadataByConnection[activeConnectionId],
      resultColumns,
    });
  }

  function canEditActiveResult(): boolean {
    return !activeConnectionReadOnly && Boolean(result && inferEditTarget());
  }

  function generateSelectedRowChangeSql() {
    if (activeConnectionReadOnly) {
      const message = t("notice.grid.readOnlyEditsDetail");
      setCommitError(message);
      showActionNotice("error", t("notice.grid.rowSqlBlocked"), message);
      return;
    }
    const target = inferEditTarget();
    if (!target) {
      const message = t("notice.grid.rowSqlUnavailableDetail");
      setCommitError(message);
      showActionNotice("error", t("notice.grid.rowSqlUnavailable"), message);
      return;
    }
    if (!selectedRowValues) {
      showActionNotice("info", t("notice.grid.selectRowFirst"));
      return;
    }
    const sql = buildSelectedRowChangeSql({
      engine: activeEngine,
      target,
      columns: resultColumns,
      row: selectedRowValues,
    });
    activeEditorApi()?.insertText(`\n${sql}\n`);
    activeEditorApi()?.focus();
    showActionNotice(
      "success",
      t("notice.grid.rowSqlGenerated"),
      t("notice.grid.rowSqlGeneratedDetail"),
    );
  }

  function originalCell(rowIndex: number, column: string): CellValue {
    const col = resultColumns.indexOf(column);
    return { column, value: activeResult?.rows[rowIndex]?.[col] ?? null };
  }

  async function commitEdits() {
    if (activeConnectionReadOnly) {
      const message = t("notice.grid.readOnlyEditsDetail");
      setCommitError(message);
      showActionNotice("error", t("notice.grid.commitFailed"), message);
      return;
    }
    const target = inferEditTarget();
    if (!target) {
      const message = t("notice.grid.commitNoTargetDetail");
      setCommitError(message);
      showActionNotice("error", t("notice.grid.commitFailed"), message);
      return;
    }
    const updates: RowUpdate[] = [];
    const editedByRow = new Map<number, number[]>();
    for (const key of cellEdits.keys()) {
      const [rowPart, colPart] = key.split(":");
      const rowIndex = Number(rowPart.slice(1));
      const list = editedByRow.get(rowIndex) ?? [];
      list.push(Number(colPart));
      editedByRow.set(rowIndex, list);
    }
    for (const [rowIndex, cols] of editedByRow) {
      updates.push({
        keys: target.keyColumns.map((column) => originalCell(rowIndex, column)),
        set: cols.map((col) => ({
          column: resultColumns[col],
          value:
            cellEdits.get(`o${rowIndex}:${col}`) === undefined
              ? null
              : cellEdits.get(`o${rowIndex}:${col}`)!,
        })),
      });
    }
    const inserts: RowInsert[] = newRows
      .filter((row) => row.some((cell) => cell !== ""))
      .map((row) => ({
        values: resultColumns
          .map((column, col) => ({ column, value: row[col] }))
          .filter((cell) => cell.value !== ""),
      }));
    const deletes: RowDelete[] = [...deletedRows].map((rowIndex) => ({
      keys: target.keyColumns.map((column) => originalCell(rowIndex, column)),
    }));
    const edits: TableEdits = {
      schema: target.schema,
      table: target.table,
      updates,
      inserts,
      deletes,
    };

    // Deletes are irreversible once applied, so they get a final gate even
    // though the staged diff is visible in the grid.
    if (deletes.length > 0) {
      const confirmed = await confirm({
        title: `Delete ${toCount(deletes.length)} row${
          deletes.length === 1 ? "" : "s"
        } from ${target.table}?`,
        message: "Deletes are applied to the database and can't be undone.",
        confirmLabel: "Commit",
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
    }

    setCommitting(true);
    setCommitError(null);
    try {
      await queryService.applyEdits(activeConnectionId, edits);
      resetEdits();
      setEditMode(false);
      // Re-run the last query so the grid shows the committed state.
      await runQuery();
      showActionNotice(
        "success",
        t("notice.grid.editsCommitted"),
        t("notice.grid.editsCommittedDetail", {
          updates: toCount(updates.length),
          inserts: toCount(inserts.length),
          deletes: toCount(deletes.length),
        }),
      );
    } catch (error) {
      const message = errorMessage(error);
      setCommitError(message);
      showActionNotice("error", t("notice.grid.commitFailed"), message);
    } finally {
      setCommitting(false);
    }
  }

  return {
    selectResultSet,
    resetEdits,
    resetGridView,
    releaseActiveSpill,
    beginCellEdit,
    applyCellValueToDraft,
    setCellValue,
    addNewRow,
    enableEditMode,
    discardEdits,
    deleteRow,
    pasteTableAt,
    undoLastEdit,
    copyGridText,
    copySelectedGridCellOrRow,
    copySelectedGridRow,
    copyVisibleResult,
    onGridKeyDown,
    onGridPaste,
    onGridCopy,
    inferEditTarget,
    canEditActiveResult,
    generateSelectedRowChangeSql,
    originalCell,
    commitEdits,
  };
}
