import type {
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  UIEvent,
} from "react";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Download,
  ListFilter,
  Search,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import type {
  DatabaseMetadata,
  DbEngine,
  DbObjectMetadata,
  QueryResultSet,
} from "@/generated/irodori-api";
import {
  buildResultExport,
  resultExportFormats,
  type ResultExportFormat,
} from "../result-export";
import {
  type ResultFilterJoin,
  type ResultFilterRule,
  type ResultSortRule,
} from "../result-grid";
import type {
  ResultGridDisplayRow,
  ResultGridDraftCell as GridCellDraft,
  ResultGridRowOrigin,
  ResultGridSortRuleView,
} from "../result-view-model";
import type { ChartResultModel } from "../chart-result";
import type { GraphResultModel } from "../graph-result";
import { ResultBody } from "./ResultBody";
import { ResultFilterPanel } from "./ResultFilterPanel";
import type { ShortcutTip } from "@/features/workbench/components/ShortcutTips";
import type {
  EditingCell,
  ResultCellRangeBounds,
  ResultMode,
  SelectedCell,
} from "../types";

export type ResultsPaneFiltering = {
  quickFilter: string;
  filtersOpen: boolean;
  filtersActive: boolean;
  activeFilters: readonly ResultFilterRule[];
  filteredOutCount: number;
  filterJoin: ResultFilterJoin;
  filterRules: readonly ResultFilterRule[];
  sortRuleByColumn: ReadonlyMap<number, ResultGridSortRuleView>;
  sortRules: readonly ResultSortRule[];
  onQuickFilterChange: (value: string) => void;
  onClearQuickFilter: () => void;
  onToggleFilters: () => void;
  onSetFilterJoin: (join: ResultFilterJoin) => void;
  onAddFilterRule: (columnIndex?: number | "any") => void;
  onUpdateFilterRule: (id: string, patch: Partial<ResultFilterRule>) => void;
  onRemoveFilterRule: (id: string) => void;
  onClearResultFilters: () => void;
  onToggleSort: (col: number, additive?: boolean) => void;
  onCloseFilters: () => void;
};

export type ResultsPaneEditing = {
  editMode: boolean;
  editUndoDepth: number;
  committing: boolean;
  cellEdits: ReadonlyMap<string, GridCellDraft>;
  editingCell: EditingCell;
  canEditActiveResult: () => boolean;
  onAddNewRow: () => void;
  onUndoEdit: () => void;
  onCommitEdits: () => void;
  onDiscardEdits: () => void;
  onGenerateRowChangeSql: () => void;
  onEnableEditMode: () => void;
  onBeginCellEdit: (key: string, col: number, seed?: string) => void;
  onSetCellValue: (
    origin: ResultGridRowOrigin,
    col: number,
    value: GridCellDraft,
  ) => void;
  onDeleteRow: (origin: ResultGridRowOrigin) => void;
  onPasteTableAt: (
    origin: ResultGridRowOrigin,
    startCol: number,
    text: string,
  ) => void;
  onEndCellEdit: () => void;
};

export type ResultsPaneSelection = {
  selectedRowKey: string | null;
  selectedCell: SelectedCell;
  selectedRangeBounds: ResultCellRangeBounds;
  selectedRowValues: unknown[] | null;
  rowDetailTable: DbObjectMetadata | null;
  onSelectGridRow: (rowKey: string, focusGrid?: boolean) => void;
  onSelectGridCell: (
    rowKey: string,
    col: number,
    extendRange?: boolean,
  ) => void;
  onCloseRowDetail: () => void;
};

export type ResultsPaneGridGeometry = {
  gridRowStyle: CSSProperties;
  gridTotalWidth: number;
  gridRowHeight: number;
  gridColumnWidth: number;
  leftColumnPad: number;
  rightColumnPad: number;
  topPad: number;
  bottomPad: number;
  firstVisible: number;
  visibleColumnIndexes: number[];
  visibleRows: readonly ResultGridDisplayRow[];
  visibleRowsRevision: number;
  onGridScroll: (event: UIEvent<HTMLDivElement>) => void;
  onGridKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onGridPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onGridCopy: (event: ReactClipboardEvent<HTMLDivElement>) => void;
};

type ResultsPaneProps = {
  running: boolean;
  readOnly: boolean;
  tableViewObject: DbObjectMetadata | null;
  resultMode: ResultMode;
  chartModel: ChartResultModel | null;
  graphModel: GraphResultModel | null;
  chartAvailable: boolean;
  graphAvailable: boolean;
  webGlAvailable: boolean;
  resultSets: QueryResultSet[];
  activeResult: QueryResultSet | null;
  hasResult: boolean;
  activeResultIndex: number;
  queryError: string | null;
  commitError: string | null;
  pendingCount: number;
  displayedResultSummary: string;
  resultColumns: string[];
  exportMenuOpen: boolean;
  shortcutTips: readonly ShortcutTip[];
  showingStructure: boolean;
  structureObject: DbObjectMetadata | null;
  editorEngine: DbEngine;
  unfilteredRowCount: number;
  totalRows: number;
  gridRef: RefObject<HTMLDivElement | null>;
  importFileRef: RefObject<HTMLInputElement | null>;
  activeMetadata: DatabaseMetadata | undefined;
  activeConnectionId: string;
  formatObjectName: (object: DbObjectMetadata) => string;
  formatCount: (value: bigint | number) => string;
  onResultModeChange: (mode: ResultMode) => void;
  onSelectResultSet: (index: number) => void;
  onExportActiveResult: (format: ResultExportFormat) => void;
  onToggleExportMenu: () => void;
  onCloseExportMenu: () => void;
  onCopyVisibleResult: () => void;
  onCopyResultAs: (format: ResultExportFormat) => void;
  onImportFile: (file: File) => void;
  filtering: ResultsPaneFiltering;
  editing: ResultsPaneEditing;
  selection: ResultsPaneSelection;
  gridGeometry: ResultsPaneGridGeometry;
};

function usePersistedResultFormat(
  storageKey: string,
  fallback: ResultExportFormat,
): [ResultExportFormat, (next: ResultExportFormat) => void] {
  const [value, setValue] = useState<ResultExportFormat>(() => {
    if (typeof window === "undefined") {
      return fallback;
    }
    const stored = window.localStorage.getItem(storageKey);
    return stored && resultExportFormats.some((format) => format.id === stored)
      ? (stored as ResultExportFormat)
      : fallback;
  });
  const update = (next: ResultExportFormat) => {
    setValue(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, next);
    }
  };
  return [value, update];
}

export function ResultsPane({
  running,
  readOnly,
  tableViewObject,
  resultMode,
  chartModel,
  graphModel,
  chartAvailable,
  graphAvailable,
  webGlAvailable,
  resultSets,
  activeResult,
  hasResult,
  activeResultIndex,
  queryError,
  commitError,
  pendingCount,
  displayedResultSummary,
  resultColumns,
  exportMenuOpen,
  shortcutTips,
  showingStructure,
  structureObject,
  editorEngine,
  unfilteredRowCount,
  totalRows,
  gridRef,
  importFileRef,
  activeMetadata,
  activeConnectionId,
  formatObjectName,
  formatCount,
  onResultModeChange,
  onSelectResultSet,
  onExportActiveResult,
  onToggleExportMenu,
  onCloseExportMenu,
  onCopyVisibleResult,
  onCopyResultAs,
  onImportFile,
  filtering,
  editing,
  selection,
  gridGeometry,
}: ResultsPaneProps) {
  const {
    quickFilter,
    filtersOpen,
    filtersActive,
    activeFilters,
    filteredOutCount,
    filterJoin,
    filterRules,
    sortRuleByColumn,
    sortRules,
    onQuickFilterChange,
    onClearQuickFilter,
    onToggleFilters,
    onSetFilterJoin,
    onAddFilterRule,
    onUpdateFilterRule,
    onRemoveFilterRule,
    onClearResultFilters,
    onToggleSort,
    onCloseFilters,
  } = filtering;
  const {
    editMode,
    editUndoDepth,
    committing,
    cellEdits,
    editingCell,
    canEditActiveResult,
    onAddNewRow,
    onUndoEdit,
    onCommitEdits,
    onDiscardEdits,
    onGenerateRowChangeSql,
    onEnableEditMode,
    onBeginCellEdit,
    onSetCellValue,
    onDeleteRow,
    onPasteTableAt,
    onEndCellEdit,
  } = editing;
  const {
    selectedRowKey,
    selectedCell,
    selectedRangeBounds,
    selectedRowValues,
    rowDetailTable,
    onSelectGridRow,
    onSelectGridCell,
    onCloseRowDetail,
  } = selection;
  const {
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
  } = gridGeometry;
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const copyMenuRef = useRef<HTMLDivElement | null>(null);
  const filterToggleRef = useRef<HTMLButtonElement | null>(null);
  const filterPanelRef = useRef<HTMLDivElement | null>(null);
  const copyExportAvailable = !showingStructure && Boolean(activeResult);
  // Remember the last-picked export/copy format so the primary buttons aren't
  // hard-wired to CSV/TSV. Copy targets text formats only (no binary workbook).
  const [exportFormat, setExportFormat] = usePersistedResultFormat(
    "irodori.result.exportFormat.v1",
    "csv",
  );
  const [copyFormat, setCopyFormat] = usePersistedResultFormat(
    "irodori.result.copyFormat.v1",
    "tsv",
  );
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const copyFormats = resultExportFormats.filter(
    (format) => format.id !== "excel",
  );
  const exportFormatLabel =
    resultExportFormats.find((format) => format.id === exportFormat)?.label ??
    exportFormat.toUpperCase();
  const copyFormatLabel = copyFormat.toUpperCase();

  useEffect(() => {
    if (!copyMenuOpen) {
      return;
    }
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && copyMenuRef.current?.contains(target)) {
        return;
      }
      setCopyMenuOpen(false);
    };
    const closeOnBlur = () => setCopyMenuOpen(false);
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [copyMenuOpen]);

  // TSV keeps copying the on-screen (filtered) rows; other formats copy the
  // full result set through the shared exporter.
  const copyInFormat = (format: ResultExportFormat) => {
    if (format === "tsv") {
      onCopyVisibleResult();
    } else {
      onCopyResultAs(format);
    }
  };

  useEffect(() => {
    if (!exportMenuOpen) {
      return;
    }
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && exportMenuRef.current?.contains(target)) {
        return;
      }
      onCloseExportMenu();
    };
    const closeOnBlur = () => onCloseExportMenu();
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [exportMenuOpen, onCloseExportMenu]);

  useEffect(() => {
    if (!filtersOpen) {
      return;
    }
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (filterToggleRef.current?.contains(target) ||
          filterPanelRef.current?.contains(target))
      ) {
        return;
      }
      onCloseFilters();
    };
    const closeOnBlur = () => onCloseFilters();
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [filtersOpen, onCloseFilters]);

  return (
    <section className={running ? "results-pane is-running" : "results-pane"}>
      <div className="results-header">
        <div className="results-title">
          {tableViewObject ||
          chartAvailable ||
          graphAvailable ||
          webGlAvailable ? (
            <div className="segmented-control result-mode-toggle">
              <button
                type="button"
                className={resultMode === "data" ? "active" : undefined}
                onClick={() => onResultModeChange("data")}
              >
                Data
              </button>
              {chartAvailable ? (
                <button
                  type="button"
                  className={resultMode === "chart" ? "active" : undefined}
                  disabled={editMode}
                  onClick={() => onResultModeChange("chart")}
                >
                  Chart
                </button>
              ) : null}
              {webGlAvailable ? (
                <button
                  type="button"
                  className={resultMode === "webgl" ? "active" : undefined}
                  disabled={editMode}
                  onClick={() => onResultModeChange("webgl")}
                >
                  WebGL
                </button>
              ) : null}
              {graphAvailable ? (
                <button
                  type="button"
                  className={resultMode === "graph" ? "active" : undefined}
                  onClick={() => onResultModeChange("graph")}
                >
                  Graph
                </button>
              ) : null}
              {tableViewObject ? (
                <button
                  type="button"
                  className={resultMode === "structure" ? "active" : undefined}
                  onClick={() => onResultModeChange("structure")}
                >
                  Structure
                </button>
              ) : null}
            </div>
          ) : null}
          {resultSets.length > 1 ? (
            <div
              className="result-tabs"
              role="tablist"
              aria-label="Result sets"
            >
              {resultSets.map((set, index) => (
                <button
                  key={set.statementIndex}
                  type="button"
                  role="tab"
                  aria-selected={index === activeResultIndex}
                  className={index === activeResultIndex ? "active" : undefined}
                  title={set.statement}
                  onClick={() => onSelectResultSet(index)}
                >
                  Result {index + 1}
                </button>
              ))}
            </div>
          ) : (
            <strong>Result 1</strong>
          )}
          <span>
            {queryError
              ? "failed"
              : pendingCount > 0
                ? `${displayedResultSummary} · ${pendingCount} pending`
                : displayedResultSummary}
          </span>
        </div>
        <div className="results-actions">
          <label className="result-quick-filter">
            <Search size={13} />
            <input
              aria-label="Quick result filter"
              value={quickFilter}
              disabled={!activeResult || showingStructure}
              placeholder="Filter rows"
              onChange={(event) =>
                onQuickFilterChange(event.currentTarget.value)
              }
            />
            {quickFilter ? (
              <button
                type="button"
                aria-label="Clear quick filter"
                title="Clear quick filter"
                onClick={onClearQuickFilter}
              >
                <X size={12} />
              </button>
            ) : null}
          </label>
          <button
            ref={filterToggleRef}
            className={`text-button${filtersOpen || filtersActive ? " active" : ""}`}
            type="button"
            disabled={!activeResult || showingStructure}
            onClick={onToggleFilters}
          >
            <ListFilter size={13} />
            <span>
              {activeFilters.length > 0
                ? `Filter ${activeFilters.length}`
                : "Filter"}
            </span>
          </button>
          <div className="action-split" ref={exportMenuRef}>
            <button
              className="text-button"
              type="button"
              title={`Export as ${exportFormatLabel}`}
              disabled={!copyExportAvailable}
              onClick={() => onExportActiveResult(exportFormat)}
            >
              <Download size={13} />
              <span>{exportFormatLabel}</span>
            </button>
            <button
              className="mini-button"
              type="button"
              title="Export formats"
              aria-label="Export formats"
              disabled={!copyExportAvailable}
              onClick={onToggleExportMenu}
            >
              <ChevronDown size={13} />
            </button>
            {exportMenuOpen ? (
              <div className="action-menu" role="menu">
                {resultExportFormats.map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    role="menuitem"
                    title={format.title}
                    aria-checked={format.id === exportFormat}
                    onClick={() => {
                      setExportFormat(format.id);
                      onExportActiveResult(format.id);
                    }}
                  >
                    <span>{format.label}</span>
                    <small>
                      .
                      {
                        buildResultExport({ columns: [], rows: [] }, format.id)
                          .extension
                      }
                    </small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="action-split" ref={copyMenuRef}>
            <button
              className="text-button"
              type="button"
              title={`Copy as ${copyFormatLabel}`}
              disabled={!copyExportAvailable}
              onClick={() => copyInFormat(copyFormat)}
            >
              <Copy size={13} />
              <span>Copy {copyFormatLabel}</span>
            </button>
            <button
              className="mini-button"
              type="button"
              title="Copy formats"
              aria-label="Copy formats"
              disabled={!copyExportAvailable}
              onClick={() => setCopyMenuOpen((open) => !open)}
            >
              <ChevronDown size={13} />
            </button>
            {copyMenuOpen ? (
              <div className="action-menu" role="menu">
                {copyFormats.map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    role="menuitem"
                    title={format.title}
                    aria-checked={format.id === copyFormat}
                    onClick={() => {
                      setCopyFormat(format.id);
                      copyInFormat(format.id);
                      setCopyMenuOpen(false);
                    }}
                  >
                    <span>Copy {format.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            className="text-button"
            type="button"
            disabled={readOnly}
            title={readOnly ? "Read-only connection" : undefined}
            onClick={() => importFileRef.current?.click()}
          >
            <Upload size={13} />
            <span>Import</span>
          </button>
          <input
            ref={importFileRef}
            className="hidden-file-input"
            type="file"
            accept=".csv,.tsv,.tab,.json,.jsonl,.ndjson,.sql,.xls,.xlsx"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                onImportFile(file);
              }
            }}
          />
          <button
            className="text-button"
            type="button"
            disabled={
              readOnly ||
              !selectedRowValues ||
              !canEditActiveResult() ||
              showingStructure
            }
            title={
              readOnly
                ? "Read-only connection"
                : selectedRowValues
                  ? "Generate a BEGIN/COMMIT wrapped UPDATE for the selected row"
                  : "Select a result row first"
            }
            onClick={onGenerateRowChangeSql}
          >
            Row SQL
          </button>
          {editMode ? (
            <>
              <button
                className="text-button"
                type="button"
                disabled={
                  readOnly || !canEditActiveResult() || showingStructure
                }
                title={
                  readOnly
                    ? "Read-only connection"
                    : "Requires a single-table result with a visible primary or unique key"
                }
                onClick={onAddNewRow}
              >
                + Row
              </button>
              <button
                className="text-button"
                type="button"
                disabled={editUndoDepth === 0 || committing || showingStructure}
                title={
                  editUndoDepth > 0
                    ? `Undo last staged edit (${editUndoDepth} available)`
                    : "No staged edits to undo"
                }
                onClick={onUndoEdit}
              >
                <Undo2 size={13} />
                <span>Undo</span>
              </button>
              <button
                className="text-button"
                type="button"
                disabled={
                  readOnly ||
                  pendingCount === 0 ||
                  committing ||
                  showingStructure
                }
                onClick={onCommitEdits}
              >
                {committing
                  ? "Saving..."
                  : `Save Changes${pendingCount ? ` (${pendingCount})` : ""}`}
              </button>
              <button
                className="text-button"
                type="button"
                onClick={onDiscardEdits}
              >
                Discard
              </button>
            </>
          ) : (
            <button
              className="text-button"
              type="button"
              disabled={readOnly || !canEditActiveResult() || showingStructure}
              title={
                readOnly
                  ? "Read-only connection"
                  : "Requires a single-table result with a visible primary or unique key"
              }
              onClick={onEnableEditMode}
            >
              Edit Data
            </button>
          )}
        </div>
      </div>
      {commitError ? (
        <div className="result-error" role="alert">
          <AlertTriangle size={16} />
          <span>{commitError}</span>
        </div>
      ) : null}
      {queryError ? (
        <div className="result-error" role="alert">
          <AlertTriangle size={16} />
          <span>{queryError}</span>
        </div>
      ) : null}
      {filtersOpen || filterRules.length > 0 ? (
        <div ref={filterPanelRef}>
          <ResultFilterPanel
            filtersActive={filtersActive}
            filteredOutCount={filteredOutCount}
            filterJoin={filterJoin}
            filterRules={filterRules}
            resultColumns={resultColumns}
            formatCount={formatCount}
            onSetFilterJoin={onSetFilterJoin}
            onAddFilterRule={onAddFilterRule}
            onUpdateFilterRule={onUpdateFilterRule}
            onRemoveFilterRule={onRemoveFilterRule}
            onClearResultFilters={onClearResultFilters}
          />
        </div>
      ) : null}
      <ResultBody
        structureObject={structureObject}
        resultMode={resultMode}
        chartModel={chartModel}
        graphModel={graphModel}
        editorEngine={editorEngine}
        formatObjectName={formatObjectName}
        formatCount={formatCount}
        editMode={editMode}
        running={running}
        hasResult={hasResult}
        filtersActive={filtersActive}
        unfilteredRowCount={unfilteredRowCount}
        totalRows={totalRows}
        resultColumns={resultColumns}
        gridRef={gridRef}
        gridRowStyle={gridRowStyle}
        gridTotalWidth={gridTotalWidth}
        gridRowHeight={gridRowHeight}
        gridColumnWidth={gridColumnWidth}
        leftColumnPad={leftColumnPad}
        rightColumnPad={rightColumnPad}
        topPad={topPad}
        bottomPad={bottomPad}
        firstVisible={firstVisible}
        visibleColumnIndexes={visibleColumnIndexes}
        visibleRows={visibleRows}
        visibleRowsRevision={visibleRowsRevision}
        sortRuleByColumn={sortRuleByColumn}
        sortRules={sortRules}
        selectedRowKey={selectedRowKey}
        selectedCell={selectedCell}
        selectedRangeBounds={selectedRangeBounds}
        editingCell={editingCell}
        cellEdits={cellEdits}
        selectedRowValues={selectedRowValues}
        rowDetailTable={rowDetailTable}
        activeMetadata={activeMetadata}
        activeConnectionId={activeConnectionId}
        onGridScroll={onGridScroll}
        onGridKeyDown={onGridKeyDown}
        onGridPaste={onGridPaste}
        onGridCopy={onGridCopy}
        onToggleSort={onToggleSort}
        onSelectGridRow={onSelectGridRow}
        onSelectGridCell={onSelectGridCell}
        onBeginCellEdit={onBeginCellEdit}
        onSetCellValue={onSetCellValue}
        onDeleteRow={onDeleteRow}
        onPasteTableAt={onPasteTableAt}
        onEndCellEdit={onEndCellEdit}
        onCloseRowDetail={onCloseRowDetail}
        shortcutTips={shortcutTips}
      />
    </section>
  );
}
