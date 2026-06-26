export type ResultMode = "data" | "structure" | "graph";

export type EditingCell = {
  key: string;
  col: number;
  seed?: string;
} | null;

export type SelectedCell = {
  key: string;
  col: number;
} | null;
