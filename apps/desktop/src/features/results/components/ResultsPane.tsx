import type {
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  UIEvent,
} from "react";
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
import type {
  EditingCell,
  ResultCellRangeBounds,
  ResultMode,
  SelectedCell,
} from "../types";

type ResultsPaneProps = {
  running: boolean;
  tableViewObject: DbObjectMetadata | null;
  resultMode: ResultMode;
  chartModel: ChartResultModel | null;
  graphModel: GraphResultModel | null;
  chartAvailable: boolean;
  graphAvailable: boolean;
  webGlAvailable: boolean;
  resultSets: QueryResultSet[];
  activeResult: QueryResultSet | null;
  activeResultIndex: number;
  queryError: string | null;
  commitError: string | null;
  pendingCount: number;
  displayedResultSummary: string;
  quickFilter: string;
  filtersOpen: boolean;
  filtersActive: boolean;
  activeFilters: readonly ResultFilterRule[];
  filteredOutCount: number;
  filterJoin: ResultFilterJoin;
  filterRules: readonly ResultFilterRule[];
  resultColumns: string[];
  exportMenuOpen: boolean;
  editMode: boolean;
  editUndoDepth: number;
  committing: boolean;
  showingStructure: boolean;
  structureObject: DbObjectMetadata | null;
  editorEngine: DbEngine;
  unfilteredRowCount: number;
  totalRows: number;
  gridRef: RefObject<HTMLDivElement | null>;
  importFileRef: RefObject<HTMLInputElement | null>;
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
  sortRuleByColumn: ReadonlyMap<number, ResultGridSortRuleView>;
  sortRules: readonly ResultSortRule[];
  selectedRowKey: string | null;
  selectedCell: SelectedCell;
  selectedRangeBounds: ResultCellRangeBounds;
  editingCell: EditingCell;
  cellEdits: ReadonlyMap<string, GridCellDraft>;
  selectedRowValues: unknown[] | null;
  rowDetailTable: DbObjectMetadata | null;
  activeMetadata: DatabaseMetadata | undefined;
  activeConnectionId: string;
  formatObjectName: (object: DbObjectMetadata) => string;
  formatCount: (value: bigint | number) => string;
  canEditActiveResult: () => boolean;
  onResultModeChange: (mode: ResultMode) => void;
  onSelectResultSet: (index: number) => void;
  onQuickFilterChange: (value: string) => void;
  onClearQuickFilter: () => void;
  onToggleFilters: () => void;
  onSetFilterJoin: (join: ResultFilterJoin) => void;
  onAddFilterRule: (columnIndex?: number | "any") => void;
  onUpdateFilterRule: (id: string, patch: Partial<ResultFilterRule>) => void;
  onRemoveFilterRule: (id: string) => void;
  onClearResultFilters: () => void;
  onExportActiveResult: (format: ResultExportFormat) => void;
  onToggleExportMenu: () => void;
  onCopyVisibleResult: () => void;
  onImportFile: (file: File) => void;
  onAddNewRow: () => void;
  onUndoEdit: () => void;
  onCommitEdits: () => void;
  onDiscardEdits: () => void;
  onEnableEditMode: () => void;
  onGridScroll: (event: UIEvent<HTMLDivElement>) => void;
  onGridKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onGridPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onGridCopy: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onToggleSort: (col: number, additive?: boolean) => void;
  onSelectGridRow: (rowKey: string, focusGrid?: boolean) => void;
  onSelectGridCell: (rowKey: string, col: number, extendRange?: boolean) => void;
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
  onCloseRowDetail: () => void;
};

export function ResultsPane({
  running,
  tableViewObject,
  resultMode,
  chartModel,
  graphModel,
  chartAvailable,
  graphAvailable,
  webGlAvailable,
  resultSets,
  activeResult,
  activeResultIndex,
  queryError,
  commitError,
  pendingCount,
  displayedResultSummary,
  quickFilter,
  filtersOpen,
  filtersActive,
  activeFilters,
  filteredOutCount,
  filterJoin,
  filterRules,
  resultColumns,
  exportMenuOpen,
  editMode,
  editUndoDepth,
  committing,
  showingStructure,
  structureObject,
  editorEngine,
  unfilteredRowCount,
  totalRows,
  gridRef,
  importFileRef,
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
  sortRuleByColumn,
  sortRules,
  selectedRowKey,
  selectedCell,
  selectedRangeBounds,
  editingCell,
  cellEdits,
  selectedRowValues,
  rowDetailTable,
  activeMetadata,
  activeConnectionId,
  formatObjectName,
  formatCount,
  canEditActiveResult,
  onResultModeChange,
  onSelectResultSet,
  onQuickFilterChange,
  onClearQuickFilter,
  onToggleFilters,
  onSetFilterJoin,
  onAddFilterRule,
  onUpdateFilterRule,
  onRemoveFilterRule,
  onClearResultFilters,
  onExportActiveResult,
  onToggleExportMenu,
  onCopyVisibleResult,
  onImportFile,
  onAddNewRow,
  onUndoEdit,
  onCommitEdits,
  onDiscardEdits,
  onEnableEditMode,
  onGridScroll,
  onGridKeyDown,
  onGridPaste,
  onGridCopy,
  onToggleSort,
  onSelectGridRow,
  onSelectGridCell,
  onBeginCellEdit,
  onSetCellValue,
  onDeleteRow,
  onPasteTableAt,
  onEndCellEdit,
  onCloseRowDetail,
}: ResultsPaneProps) {
  return (
    <section className={running ? "results-pane is-running" : "results-pane"}>
      <div className="results-header">
        <div className="results-title">
          {tableViewObject || chartAvailable || graphAvailable || webGlAvailable ? (
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
          <div className="action-split">
            <button
              className="text-button"
              type="button"
              disabled={!activeResult || showingStructure}
              onClick={() => onExportActiveResult("csv")}
            >
              <Download size={13} />
              <span>CSV</span>
            </button>
            <button
              className="mini-button"
              type="button"
              title="Export formats"
              aria-label="Export formats"
              disabled={!activeResult || showingStructure}
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
                    onClick={() => onExportActiveResult(format.id)}
                  >
                    <span>{format.label}</span>
                    <small>
                      .{buildResultExport({ columns: [], rows: [] }, format.id).extension}
                    </small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            className="text-button"
            type="button"
            disabled={!activeResult || showingStructure}
            onClick={onCopyVisibleResult}
          >
            <Copy size={13} />
            <span>Copy TSV</span>
          </button>
          <button
            className="text-button"
            type="button"
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
          {editMode ? (
            <>
              <button
                className="text-button"
                type="button"
                disabled={!canEditActiveResult() || showingStructure}
                title="Requires a single-table result with a visible primary or unique key"
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
                disabled={pendingCount === 0 || committing || showingStructure}
                onClick={onCommitEdits}
              >
                {committing
                  ? "Committing..."
                  : `Commit${pendingCount ? ` (${pendingCount})` : ""}`}
              </button>
              <button className="text-button" type="button" onClick={onDiscardEdits}>
                Discard
              </button>
            </>
          ) : (
            <button
              className="text-button"
              type="button"
              disabled={!canEditActiveResult() || showingStructure}
              title="Requires a single-table result with a visible primary or unique key"
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
      />
    </section>
  );
}
