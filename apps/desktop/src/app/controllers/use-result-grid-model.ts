import { type CSSProperties, useMemo } from "react";
import {
  buildChartResultModel,
  buildGraphResultModel,
  buildResultGridViewModel,
  calculateResultGridVirtualColumnWindow,
  calculateResultGridVirtualRowWindow,
  findTableMetadata,
  parseSourceTable,
  toCount,
  type ResultGridDraftCell as GridCellDraft,
  type ResultGridRowLike,
} from "@/features/results";
import type {
  DatabaseMetadata,
  DbEngine,
  DbObjectMetadata,
  QueryResult,
  QueryResultSet,
} from "@/generated/irodori-api";
import type {
  ResultFilterJoin,
  ResultFilterRule,
  ResultSortRule,
} from "@/features/results/result-grid";
import type { ResultMode } from "@/features/results/types";
import {
  EMPTY_CELL_EDITS,
  EMPTY_DELETED_ROWS,
  EMPTY_FILTER_RULES,
  EMPTY_NEW_ROWS,
  EMPTY_SORT_RULES,
  GRID_COLUMN_OVERSCAN,
  GRID_OVERSCAN,
  GRID_WINDOWED_CELL_THRESHOLD,
  GRID_WINDOWED_ROW_THRESHOLD,
} from "../app-workbench-utils";

export type ResultGridModelDeps = {
  result: QueryResult | null;
  activeResultIndex: number;
  resultMode: ResultMode;
  tableViewObject: DbObjectMetadata | null;
  query: string;
  editorEngine: DbEngine;
  activeMetadata: DatabaseMetadata | undefined;
  biOpen: boolean;
  spillInfo: { handle: string; total: number } | null;
  gridWindowVersion: number;
  editMode: boolean;
  cellEdits: Map<string, GridCellDraft>;
  newRows: GridCellDraft[][];
  deletedRows: Set<number>;
  filterRules: ResultFilterRule[];
  quickFilter: string;
  filterJoin: ResultFilterJoin;
  sortRules: ResultSortRule[];
  selectedRowKey: string | null;
  gridGutterWidth: number;
  gridGutterColumnWidth: number;
  gridColumnWidth: number;
  gridScrollLeft: number;
  gridViewportWidth: number;
  gridScrollTop: number;
  gridViewportHeight: number;
  gridRowHeight: number;
};

export function useResultGridModel({
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
}: ResultGridModelDeps) {
  const resultSets = useMemo<QueryResultSet[]>(() => {
    if (!result) {
      return [];
    }
    if (result.resultSets && result.resultSets.length > 0) {
      return result.resultSets;
    }
    return [
      {
        statementIndex: 0,
        statement: "statement 1",
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        elapsedMs: result.elapsedMs,
        truncated: result.truncated,
        message: result.message,
      },
    ];
  }, [result]);
  const activeResultIndexView = useMemo(
    () => Math.min(activeResultIndex, Math.max(0, resultSets.length - 1)),
    [activeResultIndex, resultSets.length],
  );
  const activeResult = useMemo(
    () => resultSets[activeResultIndexView] ?? null,
    [activeResultIndexView, resultSets],
  );
  const resultColumns = useMemo(
    () => activeResult?.columns ?? [],
    [activeResult],
  );
  const graphResultModel = useMemo(() => {
    if (
      (editorEngine !== "neo4j" && editorEngine !== "memgraph") ||
      !activeResult ||
      spillInfo
    ) {
      return null;
    }
    const rows = activeResult.rows
      .slice(0, 500)
      .filter((row): row is unknown[] => Array.isArray(row));
    if (rows.length === 0) {
      return null;
    }
    const model = buildGraphResultModel(activeResult.columns, rows);
    return model.nodes.length > 0 || model.edges.length > 0 ? model : null;
  }, [activeResult, editorEngine, spillInfo]);
  const graphAvailable = Boolean(graphResultModel);
  const webGlAvailable = Boolean(activeResult && resultColumns.length > 0);
  const rowDetailTable = useMemo(
    () =>
      findTableMetadata(activeMetadata, parseSourceTable(query), resultColumns),
    [activeMetadata, query, resultColumns],
  );
  const selectedRowValues = useMemo(
    () =>
      activeResult && selectedRowKey && selectedRowKey.startsWith("o")
        ? (activeResult.rows[Number(selectedRowKey.slice(1))] ?? null)
        : null,
    [activeResult, selectedRowKey],
  );
  const gridTotalWidth = useMemo(
    () => Math.max(1, gridGutterWidth + resultColumns.length * gridColumnWidth),
    [gridColumnWidth, gridGutterWidth, resultColumns.length],
  );
  const columnWindow = useMemo(
    () =>
      calculateResultGridVirtualColumnWindow({
        columnCount: resultColumns.length,
        scrollLeft: Math.max(0, gridScrollLeft - gridGutterWidth),
        viewportWidth: Math.max(0, gridViewportWidth - gridGutterWidth),
        columnWidth: gridColumnWidth,
        overscan: GRID_COLUMN_OVERSCAN,
      }),
    [
      gridColumnWidth,
      gridGutterWidth,
      gridScrollLeft,
      gridViewportWidth,
      resultColumns.length,
    ],
  );
  const firstVisibleColumn = columnWindow.firstColumnIndex;
  const lastVisibleColumn = columnWindow.lastColumnIndex;
  const visibleColumnIndexes = useMemo(
    () =>
      Array.from(
        { length: Math.max(0, lastVisibleColumn - firstVisibleColumn) },
        (_, index) => firstVisibleColumn + index,
      ),
    [firstVisibleColumn, lastVisibleColumn],
  );
  const leftColumnPad = columnWindow.leftPadPx;
  const rightColumnPad = columnWindow.rightPadPx;
  const gridTemplateColumns = useMemo(
    () =>
      [
        editMode ? `${gridGutterColumnWidth}px` : null,
        leftColumnPad > 0 ? `${leftColumnPad}px` : null,
        ...visibleColumnIndexes.map(() => `${gridColumnWidth}px`),
        rightColumnPad > 0 ? `${rightColumnPad}px` : null,
      ]
        .filter(Boolean)
        .join(" "),
    [
      editMode,
      gridColumnWidth,
      gridGutterColumnWidth,
      leftColumnPad,
      rightColumnPad,
      visibleColumnIndexes,
    ],
  );
  const gridRowStyle = useMemo<CSSProperties>(
    () => ({
      gridTemplateColumns,
      minWidth: gridTotalWidth,
      width: gridTotalWidth,
    }),
    [gridTemplateColumns, gridTotalWidth],
  );
  const spilled = spillInfo !== null;
  const resultGridView = useMemo(
    () =>
      buildResultGridViewModel(
        {
          rows: activeResult?.rows ?? [],
          cellEdits: spilled ? EMPTY_CELL_EDITS : cellEdits,
          newRows: spilled ? EMPTY_NEW_ROWS : newRows,
          deletedRows: spilled ? EMPTY_DELETED_ROWS : deletedRows,
          filterRules: spilled ? EMPTY_FILTER_RULES : filterRules,
          quickFilter: spilled ? "" : quickFilter,
          filterJoin,
          sortRules: spilled ? EMPTY_SORT_RULES : sortRules,
        },
        {
          windowedRowThreshold: spilled ? 0 : GRID_WINDOWED_ROW_THRESHOLD,
          windowedCellThreshold: spilled ? 0 : GRID_WINDOWED_CELL_THRESHOLD,
        },
      ),
    [
      activeResult?.rows,
      cellEdits,
      newRows,
      deletedRows,
      filterRules,
      quickFilter,
      filterJoin,
      sortRules,
      spilled,
      gridWindowVersion,
    ],
  );
  const chartCandidateAvailable =
    Boolean(activeResult) && !spillInfo && resultColumns.length > 0;
  const chartResultModel = useMemo(() => {
    if (!chartCandidateAvailable || !activeResult || spillInfo) {
      return null;
    }
    if (resultGridView.windowed && resultMode !== "chart" && !biOpen) {
      return null;
    }
    const rows = resultGridView
      .rowsInRange(0, Math.min(resultGridView.totalRowCount, 5_000))
      .map((row) => row.cells);
    if (rows.length === 0) {
      return null;
    }
    const model = buildChartResultModel(resultColumns, rows);
    return model.defaultSelection ? model : null;
  }, [
    activeResult,
    biOpen,
    chartCandidateAvailable,
    resultColumns,
    resultGridView,
    resultMode,
    spillInfo,
  ]);
  const chartAvailable = resultGridView.windowed
    ? chartCandidateAvailable
    : Boolean(chartResultModel);
  const effectiveResultMode = useMemo(() => {
    if (resultMode === "chart" && (!chartResultModel || editMode)) {
      return "data";
    }
    if (resultMode === "graph" && !graphAvailable) {
      return "data";
    }
    if (resultMode === "webgl" && (!webGlAvailable || editMode)) {
      return "data";
    }
    return resultMode;
  }, [chartResultModel, editMode, graphAvailable, resultMode, webGlAvailable]);
  const totalRows = resultGridView.totalRowCount;
  const rowWindow = useMemo(
    () =>
      calculateResultGridVirtualRowWindow({
        rowCount: totalRows,
        scrollTop: gridScrollTop,
        viewportHeight: gridViewportHeight,
        rowHeight: gridRowHeight,
        overscan: GRID_OVERSCAN,
      }),
    [gridRowHeight, gridScrollTop, gridViewportHeight, totalRows],
  );
  const firstVisible = rowWindow.firstRowIndex;
  const lastVisible = rowWindow.lastRowIndex;
  // WindowedRows mutates in place as pages arrive. Re-read the small visible
  // range on each render so a gridWindowVersion update paints fetched pages.
  const visibleRows = resultGridView.rowsInRange(firstVisible, lastVisible);
  const visibleRowsRevision = visibleRows.reduce(
    (rowTotal, row) =>
      rowTotal +
      row.cells.reduce((cellTotal, cell) => cellTotal + cell.length, 0),
    gridWindowVersion,
  );
  const structureObject =
    effectiveResultMode === "structure" ? tableViewObject : null;
  const showingStructure = Boolean(structureObject);
  const resultSummary = activeResult
    ? `${toCount(activeResult.rowCount)} rows${activeResult.truncated ? " capped" : ""} in ${toCount(
        activeResult.elapsedMs,
      )} ms`
    : "no result";
  const displayedResultSummary =
    activeResult && resultGridView.filtersActive
      ? `${toCount(totalRows)} / ${toCount(resultGridView.unfilteredRowCount)} shown · ${resultSummary}`
      : resultSummary;

  function copyCellsForRow(row: ResultGridRowLike): string[] {
    return resultColumns.map((_, index) => row.cells[index] ?? "");
  }

  return {
    activeResult,
    activeResultIndexView,
    chartAvailable,
    chartResultModel,
    displayedResultSummary,
    effectiveResultMode,
    firstVisible,
    graphAvailable,
    graphResultModel,
    gridRowStyle,
    gridTotalWidth,
    lastVisible,
    leftColumnPad,
    rightColumnPad,
    rowDetailTable,
    selectedRowValues,
    showingStructure,
    structureObject,
    resultColumns,
    resultGridView,
    resultSets,
    totalRows,
    topPad: rowWindow.topPadPx,
    bottomPad: rowWindow.bottomPadPx,
    visibleColumnIndexes,
    visibleRows,
    visibleRowsRevision,
    webGlAvailable,
    copyCellsForRow,
    activeFilters: resultGridView.activeFilters,
    filteredOutCount: resultGridView.filteredOutCount,
    filtersActive: resultGridView.filtersActive,
    pendingCount: resultGridView.pendingCount,
    sortRuleByColumn: resultGridView.sortRuleByColumn,
    unfilteredRowCount: resultGridView.unfilteredRowCount,
  };
}
