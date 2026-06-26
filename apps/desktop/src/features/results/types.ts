export type ResultMode = "data" | "structure" | "chart" | "graph" | "webgl";

export type EditingCell = {
  key: string;
  col: number;
  seed?: string;
} | null;

export type SelectedCell = {
  key: string;
  col: number;
} | null;

export type ResultCellCoordinate = {
  key: string;
  col: number;
};

export type ResultCellRange = {
  anchor: ResultCellCoordinate;
  focus: ResultCellCoordinate;
} | null;

export type ResultCellRangeBounds = {
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
  rowCount: number;
  columnCount: number;
  cellCount: number;
} | null;
