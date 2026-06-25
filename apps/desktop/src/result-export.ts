export type ResultExportFormat =
  | "csv"
  | "tsv"
  | "json"
  | "jsonl"
  | "sql"
  | "excel"
  | "markdown";

export type ResultLike = {
  columns: string[];
  rows: unknown[][];
};

export type ResultExport = {
  content: string;
  mime: string;
  extension: string;
  bom: boolean;
};

export const resultExportFormats: Array<{
  id: ResultExportFormat;
  label: string;
  title: string;
}> = [
  { id: "csv", label: "CSV", title: "Comma-separated values" },
  { id: "tsv", label: "TSV", title: "Tab-separated values" },
  { id: "json", label: "JSON", title: "JSON array" },
  { id: "jsonl", label: "JSONL", title: "One JSON object per line" },
  { id: "sql", label: "SQL", title: "INSERT statements" },
  { id: "excel", label: "Excel", title: "Excel-compatible HTML workbook" },
  { id: "markdown", label: "Markdown", title: "Markdown table" },
];

type ResultSerializer = (result: ResultLike, tableName: string) => string;

const resultExportDefinitions: Record<
  ResultExportFormat,
  Omit<ResultExport, "content"> & { serialize: ResultSerializer }
> = {
  csv: {
    serialize: (result) => delimitedFromResult(result, ","),
    mime: "text/csv;charset=utf-8",
    extension: "csv",
    bom: true,
  },
  tsv: {
    serialize: (result) => delimitedFromResult(result, "\t"),
    mime: "text/tab-separated-values;charset=utf-8",
    extension: "tsv",
    bom: true,
  },
  json: {
    serialize: jsonFromResult,
    mime: "application/json;charset=utf-8",
    extension: "json",
    bom: false,
  },
  jsonl: {
    serialize: jsonLinesFromResult,
    mime: "application/x-ndjson;charset=utf-8",
    extension: "jsonl",
    bom: false,
  },
  sql: {
    serialize: sqlInsertsFromResult,
    mime: "application/sql;charset=utf-8",
    extension: "sql",
    bom: false,
  },
  excel: {
    serialize: excelWorkbookFromResult,
    mime: "application/vnd.ms-excel;charset=utf-8",
    extension: "xls",
    bom: true,
  },
  markdown: {
    serialize: markdownFromResult,
    mime: "text/markdown;charset=utf-8",
    extension: "md",
    bom: false,
  },
};

export function buildResultExport(
  result: ResultLike,
  format: ResultExportFormat,
  tableName = "query_result",
): ResultExport {
  const { serialize, ...definition } = resultExportDefinitions[format];
  return {
    ...definition,
    content: serialize(result, tableName),
  };
}

export function resultExportFileName(
  connectionId: string,
  format: ResultExportFormat,
  now = new Date(),
) {
  const extension = resultExportDefinitions[format].extension;
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `irodori-${connectionId}-${timestamp}.${extension}`;
}

function jsonFromResult(result: ResultLike) {
  return `${JSON.stringify(recordsFromResult(result), null, 2)}\n`;
}

function jsonLinesFromResult(result: ResultLike) {
  return `${recordsFromResult(result)
    .map((record) => JSON.stringify(record))
    .join("\n")}\n`;
}

function recordsFromResult(result: ResultLike) {
  return result.rows.map((row) => rowToRecord(result.columns, row));
}

function rowToRecord(columns: string[], row: unknown[]) {
  return Object.fromEntries(
    columns.map((column, index) => [column, jsonSafeValue(row[index] ?? null)]),
  );
}

function jsonSafeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafeValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, jsonSafeValue(nested)]),
    );
  }
  return value;
}

function cellText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "object") {
    return JSON.stringify(jsonSafeValue(value));
  }
  return String(value);
}

function delimitedCell(value: unknown, delimiter: string) {
  const text = cellText(value);
  if (text.includes(delimiter) || /["\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function delimitedFromResult(result: ResultLike, delimiter: string) {
  return [
    delimitedValues(result.columns, delimiter),
    ...result.rows.map((row) => delimitedValues(rowValues(result.columns, row), delimiter)),
  ].join("\r\n");
}

function delimitedValues(values: unknown[], delimiter: string) {
  return values.map((value) => delimitedCell(value, delimiter)).join(delimiter);
}

function quoteIdentifier(name: string) {
  const cleaned = name.trim() || "query_result";
  return `"${cleaned.replace(/"/g, '""')}"`;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  const text = typeof value === "object" ? JSON.stringify(jsonSafeValue(value)) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

function sqlInsertsFromResult(result: ResultLike, tableName: string) {
  const table = quoteIdentifier(tableName);
  const columns = result.columns.map(quoteIdentifier).join(", ");
  if (result.rows.length === 0) {
    return `-- No rows to export for ${table}.\n`;
  }
  return `${result.rows
    .map((row) => sqlInsertStatement(table, columns, rowValues(result.columns, row)))
    .join("\n")}\n`;
}

function sqlInsertStatement(table: string, columns: string, values: unknown[]) {
  return `INSERT INTO ${table} (${columns}) VALUES (${values.map(sqlLiteral).join(", ")});`;
}

function escapeMarkdownCell(value: unknown) {
  return cellText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function markdownFromResult(result: ResultLike) {
  const header = markdownRow(result.columns);
  const divider = markdownRow(result.columns.map(() => "---"));
  const rows = result.rows.map((row) => markdownRow(rowValues(result.columns, row)));
  return [header, divider, ...rows].join("\n") + "\n";
}

function markdownRow(values: unknown[]) {
  return `| ${values.map(escapeMarkdownCell).join(" | ")} |`;
}

function escapeHtml(value: unknown) {
  return cellText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function excelWorkbookFromResult(result: ResultLike) {
  const header = result.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const rows = result.rows.map((row) => htmlRow(rowValues(result.columns, row))).join("");
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"></head><body>',
    `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`,
    "</body></html>",
  ].join("");
}

function htmlRow(values: unknown[]) {
  return `<tr>${values.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`;
}

function rowValues(columns: string[], row: unknown[]) {
  return columns.map((_, index) => row[index]);
}
