export { ResultBody } from "./components/ResultBody";
export { ResultsPane } from "./components/ResultsPane";
export {
  normalizeResultCellRange,
  readResultCellRangeRows,
  resultCellInRange,
  summarizeResultCellRange,
  type ResultSelectionSummary,
} from "./result-selection";
export { useResultGridStore } from "./store/result-grid-store";
export type { ResultGridEditDraft } from "./store/result-grid-store";
export { useResultsStore } from "./store/results-store";
export type {
  EditingCell,
  ResultCellCoordinate,
  ResultCellRange,
  ResultCellRangeBounds,
  ResultMode,
  SelectedCell,
} from "./types";
