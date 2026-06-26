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
