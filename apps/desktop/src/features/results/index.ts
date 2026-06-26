export { ResultBody } from "./components/ResultBody";
export { ResultsPane } from "./components/ResultsPane";
export {
  formatResultSelectionStatus,
  historySnapshotToQueryResult,
  toCount,
} from "./result-format";
export {
  normalizeResultCellRange,
  readResultCellRangeRows,
  resultCellInRange,
  summarizeResultCellRange,
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
