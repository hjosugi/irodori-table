import type {
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
  UIEvent,
} from "react";
import type {
  DatabaseMetadata,
  DbEngine,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import type { ResultSortRule } from "@/features/results/result-grid";
import {
  type ResultGridDisplayRow,
  type ResultGridDraftCell as GridCellDraft,
  type ResultGridRowOrigin,
  type ResultGridSortRuleView,
} from "@/features/results/result-view-model";
import { RowDetailSidebar } from "@/features/results/components/RowDetailSidebar";
import type { ChartResultModel } from "../chart-result";
import type { GraphResultModel } from "../graph-result";
import { resultCellInRange } from "../result-selection";
import type {
  EditingCell,
  ResultCellRangeBounds,
  ResultMode,
  SelectedCell,
} from "../types";
import { ChartResultView } from "./ChartResultView";
import { GraphResultView } from "./GraphResultView";
import { WebGlResultGrid } from "./WebGlResultGrid";

function isGridCellTarget(event: ReactFocusEvent | ReactMouseEvent) {
  return (
    event.target instanceof Element && event.target.closest("[role='cell']")
  );
}

export function ResultBody({
  structureObject,
  resultMode,
  chartModel,
  graphModel,
  editorEngine,
  formatObjectName,
  formatCount,
  editMode,
  running,
  filtersActive,
  unfilteredRowCount,
  totalRows,
  resultColumns,
  gridRef,
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
}: {
  structureObject: DbObjectMetadata | null;
  resultMode: ResultMode;
  chartModel: ChartResultModel | null;
  graphModel: GraphResultModel | null;
  editorEngine: DbEngine;
  formatObjectName: (object: DbObjectMetadata) => string;
  formatCount: (value: bigint | number) => string;
  editMode: boolean;
  running: boolean;
  filtersActive: boolean;
  unfilteredRowCount: number;
  totalRows: number;
  resultColumns: string[];
  gridRef: RefObject<HTMLDivElement | null>;
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
}) {
  if (structureObject) {
    return (
      <StructureView
        object={structureObject}
        formatObjectName={formatObjectName}
        formatCount={formatCount}
      />
    );
  }

  if (resultMode === "graph" && graphModel) {
    return <GraphResultView model={graphModel} />;
  }

  if (resultMode === "chart" && chartModel) {
    return <ChartResultView model={chartModel} />;
  }

  if (resultMode === "webgl") {
    return (
      <div className="result-body">
        <WebGlResultGrid
          columns={resultColumns}
          totalRows={totalRows}
          visibleRows={visibleRows}
          visibleColumnIndexes={visibleColumnIndexes}
          firstVisible={firstVisible}
          rowHeight={gridRowHeight}
          columnWidth={gridColumnWidth}
          gridRef={gridRef}
          selectedRowKey={selectedRowKey}
          selectedCell={selectedCell}
          selectedRangeBounds={selectedRangeBounds}
          sortRuleByColumn={sortRuleByColumn}
          sortRules={sortRules}
          running={running}
          filtersActive={filtersActive}
          unfilteredRowCount={unfilteredRowCount}
          onGridScroll={onGridScroll}
          onGridKeyDown={onGridKeyDown}
          onGridPaste={onGridPaste}
          onGridCopy={onGridCopy}
          onToggleSort={onToggleSort}
          onSelectGridRow={onSelectGridRow}
          onSelectGridCell={onSelectGridCell}
        />
        {selectedRowValues ? (
          <RowDetailSidebar
            columns={resultColumns}
            values={selectedRowValues}
            table={rowDetailTable}
            metadata={activeMetadata}
            engine={editorEngine}
            connectionId={activeConnectionId}
            onClose={onCloseRowDetail}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="result-body">
      <div
        className="result-grid"
        role="table"
        aria-label="Query result"
        aria-rowcount={totalRows + 1}
        aria-colcount={resultColumns.length + (editMode ? 1 : 0)}
        ref={gridRef}
        tabIndex={0}
        onScroll={onGridScroll}
        onKeyDown={onGridKeyDown}
        onPaste={onGridPaste}
        onCopy={onGridCopy}
      >
        <div className="grid-row header" role="row" style={gridRowStyle}>
          {editMode ? <span className="grid-gutter" aria-hidden="true" /> : null}
          {leftColumnPad > 0 ? (
            <span className="grid-col-pad" aria-hidden="true" />
          ) : null}
          {visibleColumnIndexes.map((colIndex) => {
            const column = resultColumns[colIndex];
            const sortRule = sortRuleByColumn.get(colIndex);
            return (
              <span
                role="columnheader"
                aria-colindex={editMode ? colIndex + 2 : colIndex + 1}
                key={`${column}-${colIndex}`}
                className={`sortable${sortRule ? " sorted" : ""}`}
                title="Click to sort. Shift-click to add a sort key."
                onClick={(event) => onToggleSort(colIndex, event.shiftKey)}
              >
                <b className="column-label">{column}</b>
                {sortRule ? (
                  <em className="sort-indicator">
                    {sortRule.direction === "asc" ? <>&#9650;</> : <>&#9660;</>}
                    {sortRules.length > 1 ? (
                      <small>{sortRule.priority}</small>
                    ) : null}
                  </em>
                ) : null}
              </span>
            );
          })}
          {rightColumnPad > 0 ? (
            <span className="grid-col-pad" aria-hidden="true" />
          ) : null}
        </div>
        {topPad > 0 ? (
          <div
            className="grid-pad"
            style={{
              height: topPad,
              minWidth: gridTotalWidth,
              width: gridTotalWidth,
            }}
            aria-hidden="true"
          />
        ) : null}
        {running && totalRows === 0 ? (
          <div
            className="grid-state loading"
            role="status"
            style={{ minWidth: gridTotalWidth, width: gridTotalWidth }}
          >
            Running query...
          </div>
        ) : null}
        {!running && totalRows === 0 ? (
          <div
            className="grid-state"
            role="row"
            style={{ minWidth: gridTotalWidth, width: gridTotalWidth }}
          >
            {filtersActive && unfilteredRowCount > 0
              ? "No rows match filters"
              : "No rows returned"}
          </div>
        ) : null}
        {visibleRows.map((row, visibleRowIndex) => (
          <div
            className={`grid-row${row.state === "new" ? " row-new" : row.state === "edited" ? " row-edited" : ""}${selectedRowKey === row.key ? " row-selected" : ""}`}
            role="row"
            aria-selected={selectedRowKey === row.key}
            aria-rowindex={firstVisible + visibleRowIndex + 2}
            key={row.key}
            tabIndex={0}
            style={gridRowStyle}
            onClick={(event) => {
              if (!isGridCellTarget(event)) {
                onSelectGridRow(row.key, true);
              }
            }}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible")) {
                onSelectGridRow(row.key);
              }
            }}
          >
            {editMode ? (
              <button
                className="grid-gutter delete-row"
                type="button"
                title="Delete row"
                aria-label="Delete row"
                onClick={() => onDeleteRow(row.origin)}
              >
                &times;
              </button>
            ) : null}
            {leftColumnPad > 0 ? (
              <span className="grid-col-pad" aria-hidden="true" />
            ) : null}
            {visibleColumnIndexes.map((cellIndex) => {
              const cell = row.cells[cellIndex] ?? "";
              const isEditing =
                editingCell?.key === row.key && editingCell.col === cellIndex;
              const isEdited =
                row.origin.kind === "orig" &&
                cellEdits.has(`o${row.origin.index}:${cellIndex}`);
              const isSelected =
                selectedCell?.key === row.key && selectedCell.col === cellIndex;
              const isRangeSelected = resultCellInRange(
                firstVisible + visibleRowIndex,
                cellIndex,
                selectedRangeBounds,
              );
              const isNullCell = cell === "NULL";
              const isEmptyCell = cell === "";
              const cellClass = [
                isEdited ? "cell-edited" : "",
                isRangeSelected ? "cell-range-selected" : "",
                isSelected ? "cell-selected" : "",
                isNullCell ? "cell-null" : "",
                isEmptyCell ? "cell-empty" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <span
                  role="cell"
                  key={cellIndex}
                  aria-colindex={editMode ? cellIndex + 2 : cellIndex + 1}
                  aria-selected={isSelected || isRangeSelected}
                  className={cellClass || undefined}
                  title={isEmptyCell ? "EMPTY string" : cell}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectGridCell(row.key, cellIndex, event.shiftKey);
                  }}
                  onDoubleClick={() => {
                    onBeginCellEdit(row.key, cellIndex);
                  }}
                  onPaste={(event) => {
                    if (!editMode) {
                      return;
                    }
                    event.preventDefault();
                    onPasteTableAt(
                      row.origin,
                      cellIndex,
                      event.clipboardData.getData("text"),
                    );
                  }}
                >
                  {isEditing ? (
                    <div className="cell-editor">
                      <input
                        className="cell-input"
                        autoFocus
                        defaultValue={editingCell?.seed ?? cell}
                        onBlur={(event) => {
                          onSetCellValue(
                            row.origin,
                            cellIndex,
                            event.target.value,
                          );
                          onEndCellEdit();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            onSetCellValue(
                              row.origin,
                              cellIndex,
                              event.currentTarget.value,
                            );
                            onEndCellEdit();
                          } else if (event.key === "Escape") {
                            onEndCellEdit();
                          } else if (
                            event.key === "Backspace" &&
                            (event.ctrlKey || event.metaKey)
                          ) {
                            event.preventDefault();
                            onSetCellValue(row.origin, cellIndex, null);
                            onEndCellEdit();
                          }
                        }}
                      />
                      <button
                        type="button"
                        title="Set NULL"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          onSetCellValue(row.origin, cellIndex, null);
                          onEndCellEdit();
                        }}
                      >
                        NULL
                      </button>
                    </div>
                  ) : isEmptyCell ? (
                    <em className="cell-token">EMPTY</em>
                  ) : isNullCell ? (
                    <em className="cell-token">NULL</em>
                  ) : (
                    cell
                  )}
                </span>
              );
            })}
            {rightColumnPad > 0 ? (
              <span className="grid-col-pad" aria-hidden="true" />
            ) : null}
          </div>
        ))}
        {bottomPad > 0 ? (
          <div
            className="grid-pad"
            style={{
              height: bottomPad,
              minWidth: gridTotalWidth,
              width: gridTotalWidth,
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      {selectedRowValues ? (
        <RowDetailSidebar
          columns={resultColumns}
          values={selectedRowValues}
          table={rowDetailTable}
          metadata={activeMetadata}
          engine={editorEngine}
          connectionId={activeConnectionId}
          onClose={onCloseRowDetail}
        />
      ) : null}
    </div>
  );
}

function StructureView({
  object,
  formatObjectName,
  formatCount,
}: {
  object: DbObjectMetadata;
  formatObjectName: (object: DbObjectMetadata) => string;
  formatCount: (value: bigint | number) => string;
}) {
  return (
    <div className="structure-view">
      <section className="structure-section">
        <header>
          <strong>{formatObjectName(object)}</strong>
          <span>
            {object.columns.length} columns
            {object.rowEstimate ? ` \u00b7 ~${formatCount(object.rowEstimate)} rows` : ""}
          </span>
        </header>
        <div className="structure-table-wrap">
          <table className="structure-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Null</th>
                <th>Key</th>
                <th>Default</th>
                <th>Comment</th>
              </tr>
            </thead>
            <tbody>
              {object.columns.map((column) => (
                <tr key={`${column.ordinal}:${column.name}`}>
                  <td>{column.name}</td>
                  <td>{column.dataType}</td>
                  <td>{column.nullable ? "YES" : "NO"}</td>
                  <td>{object.primaryKey.includes(column.name) ? "PK" : ""}</td>
                  <td>{column.defaultValue || ""}</td>
                  <td>{column.comment || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="structure-side">
        <div className="structure-card">
          <strong>Primary Key</strong>
          <span>
            {object.primaryKey.length > 0
              ? object.primaryKey.join(", ")
              : "No primary key"}
          </span>
        </div>
        <div className="structure-card">
          <strong>Indexes</strong>
          {object.indexes.length > 0 ? (
            object.indexes.map((index) => (
              <span key={index.name}>
                {index.name || "(unnamed)"} \u00b7{" "}
                {index.unique ? "unique" : "index"} \u00b7{" "}
                {index.columns.join(", ")}
              </span>
            ))
          ) : (
            <span>No indexes loaded</span>
          )}
        </div>
        <div className="structure-card">
          <strong>Foreign Keys</strong>
          {object.foreignKeys.length > 0 ? (
            object.foreignKeys.map((fk, index) => (
              <span key={`${fk.referencesTable}:${index}`}>
                {fk.columns.join(", ")} -&gt;{" "}
                {[fk.referencesSchema, fk.referencesTable]
                  .filter(Boolean)
                  .join(".")}
                ({fk.referencesColumns.join(", ")})
              </span>
            ))
          ) : (
            <span>No outgoing foreign keys</span>
          )}
        </div>
        {object.ddl ? (
          <pre className="sql-preview structure-ddl">{object.ddl}</pre>
        ) : null}
      </section>
    </div>
  );
}
