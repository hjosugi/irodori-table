export const resultExportFormatIds = [
  "csv",
  "tsv",
  "json",
  "jsonl",
  "sql",
  "xlsx",
  "excel",
  "markdown",
] as const;

export type ResultExportFormat = (typeof resultExportFormatIds)[number];
