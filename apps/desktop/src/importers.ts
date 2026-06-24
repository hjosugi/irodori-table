export type ImportTextFormat = "csv" | "tsv" | "json" | "jsonl";
export type ImportFileKind = ImportTextFormat | "sql" | "excel";

export type ParsedImport = {
  columns: string[];
  rows: unknown[][];
  totalRows: number;
  truncated: boolean;
};

export function detectImportFileKind(fileName: string): ImportFileKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    return "csv";
  }
  if (lower.endsWith(".tsv") || lower.endsWith(".tab")) {
    return "tsv";
  }
  if (lower.endsWith(".json")) {
    return "json";
  }
  if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) {
    return "jsonl";
  }
  if (lower.endsWith(".sql")) {
    return "sql";
  }
  if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) {
    return "excel";
  }
  return null;
}

export function inferImportTableName(fileName: string) {
  const base = fileName
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "");
  return sanitizeSqlName(base || "imported_rows");
}

export function parseImportText(
  text: string,
  format: ImportTextFormat,
  maxRows = 10000,
): ParsedImport {
  switch (format) {
    case "csv":
      return parseDelimitedImport(text, ",", maxRows);
    case "tsv":
      return parseDelimitedImport(text, "\t", maxRows);
    case "json":
      return parseJsonImport(text, maxRows);
    case "jsonl":
      return parseJsonLinesImport(text, maxRows);
  }
}

export function generateImportSql(
  tableName: string,
  columns: string[],
  rows: unknown[][],
  includeCreate = true,
) {
  const table = quoteIdentifier(sanitizeSqlName(tableName || "imported_rows"));
  const cleanedColumns = normalizeColumns(columns);
  const quotedColumns = cleanedColumns.map(quoteIdentifier);
  const statements: string[] = [];
  if (includeCreate) {
    const types = cleanedColumns.map((_, index) =>
      inferSqlType(rows.map((row) => row[index])),
    );
    statements.push(
      `CREATE TABLE IF NOT EXISTS ${table} (\n${cleanedColumns
        .map((column, index) => `  ${quoteIdentifier(column)} ${types[index]}`)
        .join(",\n")}\n);`,
    );
  }
  if (rows.length > 0) {
    const values = rows
      .map(
        (row) =>
          `  (${cleanedColumns
            .map((_, index) => sqlLiteral(row[index] ?? null))
            .join(", ")})`,
      )
      .join(",\n");
    statements.push(
      `INSERT INTO ${table} (${quotedColumns.join(", ")}) VALUES\n${values};`,
    );
  }
  return `${statements.join("\n\n")}\n`;
}

export function sanitizeSqlName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safe = cleaned || "imported_rows";
  return /^[A-Za-z_]/.test(safe) ? safe : `_${safe}`;
}

function parseDelimitedImport(
  text: string,
  delimiter: string,
  maxRows: number,
): ParsedImport {
  const table = parseDelimitedRows(text, delimiter);
  if (table.length === 0) {
    return { columns: [], rows: [], totalRows: 0, truncated: false };
  }
  const columns = table[0].map((column, index) => column || `column_${index + 1}`);
  const allRows = table.slice(1).filter((row) => row.some((cell) => cell !== ""));
  const rows = allRows.slice(0, maxRows);
  return {
    columns,
    rows,
    totalRows: allRows.length,
    truncated: allRows.length > rows.length,
  };
}

function parseDelimitedRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 2;
      } else if (char === '"') {
        inQuotes = false;
        index += 1;
      } else {
        cell += char;
        index += 1;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      index += 1;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
      index += 1;
    } else if (char === "\n" || char === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += char === "\r" && text[index + 1] === "\n" ? 2 : 1;
    } else {
      cell += char;
      index += 1;
    }
  }
  if (cell.length > 0 || row.length > 0 || text.endsWith(delimiter)) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseJsonImport(text: string, maxRows: number): ParsedImport {
  const value = JSON.parse(text) as unknown;
  return rowsFromJsonValues(extractJsonRows(value), maxRows);
}

function parseJsonLinesImport(text: string, maxRows: number): ParsedImport {
  const values = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as unknown);
  return rowsFromJsonValues(values, maxRows);
}

function extractJsonRows(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value)) {
    if (Array.isArray(value.rows)) {
      return value.rows;
    }
    if (Array.isArray(value.data)) {
      return value.data;
    }
  }
  return [value];
}

function rowsFromJsonValues(values: unknown[], maxRows: number): ParsedImport {
  const columns = columnsFromJsonValues(values);
  const allRows = values.map((value) => valueToRow(value, columns));
  const rows = allRows.slice(0, maxRows);
  return {
    columns,
    rows,
    totalRows: allRows.length,
    truncated: allRows.length > rows.length,
  };
}

function columnsFromJsonValues(values: unknown[]) {
  const columns: string[] = [];
  let maxArrayLength = 0;
  values.forEach((value) => {
    if (isRecord(value)) {
      Object.keys(value).forEach((key) => {
        if (!columns.includes(key)) {
          columns.push(key);
        }
      });
    } else if (Array.isArray(value)) {
      maxArrayLength = Math.max(maxArrayLength, value.length);
    }
  });
  if (columns.length > 0) {
    return columns;
  }
  if (maxArrayLength > 0) {
    return Array.from({ length: maxArrayLength }, (_, index) => `column_${index + 1}`);
  }
  return ["value"];
}

function valueToRow(value: unknown, columns: string[]) {
  if (isRecord(value)) {
    return columns.map((column) => value[column] ?? null);
  }
  if (Array.isArray(value)) {
    return columns.map((_, index) => value[index] ?? null);
  }
  return [value];
}

function normalizeColumns(columns: string[]) {
  const seen = new Map<string, number>();
  return columns.map((column, index) => {
    const base = sanitizeSqlName(String(column || `column_${index + 1}`));
    const count = seen.get(base.toLowerCase()) ?? 0;
    seen.set(base.toLowerCase(), count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function inferSqlType(values: unknown[]) {
  const present = values.filter((value) => value !== null && value !== undefined && value !== "");
  if (present.length === 0) {
    return "TEXT";
  }
  if (present.every(isBooleanLike)) {
    return "BOOLEAN";
  }
  if (present.every(isIntegerLike)) {
    return "INTEGER";
  }
  if (present.every(isNumberLike)) {
    return "REAL";
  }
  return "TEXT";
}

function isBooleanLike(value: unknown) {
  if (typeof value === "boolean") {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  return /^(true|false)$/i.test(value.trim());
}

function isIntegerLike(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value);
  }
  if (typeof value === "bigint") {
    return true;
  }
  return typeof value === "string" && /^-?\d+$/.test(value.trim());
}

function isNumberLike(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "bigint") {
    return true;
  }
  return (
    typeof value === "string" &&
    /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
  );
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined || value === "") {
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

function jsonSafeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafeValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, jsonSafeValue(nested)]),
    );
  }
  return value;
}

function quoteIdentifier(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
