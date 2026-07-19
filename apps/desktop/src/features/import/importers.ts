export type ImportTextFormat = "csv" | "tsv" | "json" | "jsonl";
export type ImportFileKind = ImportTextFormat | "sql" | "excel";

export type ParsedImport = {
  columns: string[];
  rows: unknown[][];
  totalRows: number;
  truncated: boolean;
};

const importFileKindByExtension = [
  { kind: "csv", extensions: [".csv"] },
  { kind: "tsv", extensions: [".tsv", ".tab"] },
  { kind: "json", extensions: [".json"] },
  { kind: "jsonl", extensions: [".jsonl", ".ndjson"] },
  { kind: "sql", extensions: [".sql"] },
  { kind: "excel", extensions: [".xls", ".xlsx"] },
] as const satisfies ReadonlyArray<{
  kind: ImportFileKind;
  extensions: readonly string[];
}>;

export function detectImportFileKind(fileName: string): ImportFileKind | null {
  const lower = fileName.toLowerCase();
  return (
    importFileKindByExtension.find(({ extensions }) =>
      extensions.some((extension) => lower.endsWith(extension)),
    )?.kind ?? null
  );
}

export function inferImportTableName(fileName: string): string {
  const base = fileName
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "");
  return sanitizeSqlName(base || "imported_rows");
}

export function parseImportText(
  text: string,
  format: ImportTextFormat | "ndjson" | string,
  maxRows = 10000,
): ParsedImport {
  const normalizedFormat = normalizeImportTextFormat(format);
  if (!normalizedFormat) {
    throw new Error(unsupportedImportFormatMessage(format));
  }
  return importTextParsers[normalizedFormat](text, maxRows);
}

type ImportTextParser = (text: string, maxRows: number) => ParsedImport;

const importTextParsers: Record<ImportTextFormat, ImportTextParser> = {
  csv: (text, maxRows) => parseDelimitedImport(text, ",", maxRows),
  tsv: (text, maxRows) => parseDelimitedImport(text, "\t", maxRows),
  json: parseJsonImport,
  jsonl: parseJsonLinesImport,
};

const supportedImportTextFormats = new Set<string>([
  "csv",
  "tsv",
  "json",
  "jsonl",
]);

export function unsupportedImportFormatMessage(format: string): string {
  const normalized = normalizeFormatName(format);
  const supported = "CSV, TSV, JSON, JSONL/NDJSON";
  switch (normalized) {
    case "sql":
      return "SQL files are loaded into the editor and are not parsed as table data.";
    case "excel":
    case "xls":
    case "xlsx":
      return `Native XLSX/XLS import is not supported. Import ${supported}, or load a SQL file instead.`;
    default:
      return `Unsupported import format "${format}". Supported text import formats: ${supported}.`;
  }
}

export function generateImportSql(
  tableName: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  includeCreate = true,
): string {
  const table = quoteIdentifier(sanitizeSqlName(tableName || "imported_rows"));
  const cleanedColumns = normalizeColumns(columns);
  const statements = [
    includeCreate
      ? createImportTableStatement(table, cleanedColumns, rows)
      : null,
    rows.length > 0
      ? insertImportRowsStatement(table, cleanedColumns, rows)
      : null,
  ].filter(isPresent);
  return `${statements.join("\n\n")}\n`;
}

export function sanitizeSqlName(name: string): string {
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
    return emptyParsedImport();
  }
  const dataRows = table.slice(1).filter(hasDelimitedContent);
  const columnCount = maxDelimitedColumnCount([table[0], ...dataRows]);
  return parsedImport(
    delimitedColumns(padDelimitedRow(table[0], columnCount)),
    dataRows.map((row) => padDelimitedRow(row, columnCount)),
    maxRows,
  );
}

function parseDelimitedRows(text: string, delimiter: string): string[][] {
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
  return rowsFromJsonValues(extractJsonRows(parseJsonValue(text)), maxRows);
}

function parseJsonLinesImport(text: string, maxRows: number): ParsedImport {
  return rowsFromJsonValues(jsonLines(text).map(parseJsonValue), maxRows);
}

function extractJsonRows(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return [value];
  }
  return firstJsonArrayProperty(value, ["rows", "data"]) ?? [value];
}

function rowsFromJsonValues(
  values: readonly unknown[],
  maxRows: number,
): ParsedImport {
  const columns = columnsFromJsonValues(values);
  return parsedImport(
    columns,
    values.map((value) => valueToRow(value, columns)),
    maxRows,
  );
}

function columnsFromJsonValues(values: readonly unknown[]): string[] {
  const recordColumns = unique(values.flatMap(recordKeys));
  if (recordColumns.length > 0) {
    return recordColumns;
  }
  const maxArrayLength = maxJsonArrayLength(values);
  if (maxArrayLength > 0) {
    return Array.from(
      { length: maxArrayLength },
      (_, index) => `column_${index + 1}`,
    );
  }
  return ["value"];
}

function maxJsonArrayLength(values: readonly unknown[]): number {
  return values.reduce<number>(
    (maxLength, value) =>
      Array.isArray(value) ? Math.max(maxLength, value.length) : maxLength,
    0,
  );
}

function valueToRow(value: unknown, columns: readonly string[]): unknown[] {
  if (isRecord(value)) {
    return columns.map((column) => value[column] ?? null);
  }
  if (Array.isArray(value)) {
    return columns.map((_, index) => value[index] ?? null);
  }
  return [value];
}

function normalizeColumns(columns: readonly string[]): string[] {
  const counts = new Map<string, number>();
  return columns.map((column, index) => {
    const base = sanitizeSqlName(String(column || `column_${index + 1}`));
    return nextUniqueName(base, counts);
  });
}

function inferSqlType(values: readonly unknown[]): string {
  const present = values.filter(
    (value) => value !== null && value !== undefined && value !== "",
  );
  if (present.length === 0) {
    return "TEXT";
  }
  return (
    sqlTypeChecks.find(({ matches }) => present.every(matches))?.type ?? "TEXT"
  );
}

function createImportTableStatement(
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const types = columns.map((_, index) =>
    inferSqlType(rows.map((row) => row[index])),
  );
  const definitions = columns
    .map((column, index) => `  ${quoteIdentifier(column)} ${types[index]}`)
    .join(",\n");
  return `CREATE TABLE IF NOT EXISTS ${table} (\n${definitions}\n);`;
}

function insertImportRowsStatement(
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const quotedColumns = columns.map(quoteIdentifier).join(", ");
  const values = rows
    .map((row) => `  (${importRowSqlValues(columns, row)})`)
    .join(",\n");
  return `INSERT INTO ${table} (${quotedColumns}) VALUES\n${values};`;
}

function importRowSqlValues(
  columns: readonly string[],
  row: readonly unknown[],
): string {
  return columns.map((_, index) => sqlLiteral(row[index] ?? null)).join(", ");
}

function emptyParsedImport(): ParsedImport {
  return { columns: [], rows: [], totalRows: 0, truncated: false };
}

function parsedImport(
  columns: string[],
  allRows: unknown[][],
  maxRows: number,
): ParsedImport {
  const rows = allRows.slice(0, maxRows);
  return {
    columns,
    rows,
    totalRows: allRows.length,
    truncated: allRows.length > rows.length,
  };
}

function normalizeImportTextFormat(format: string): ImportTextFormat | null {
  const normalized = normalizeFormatName(format);
  if (normalized === "ndjson") {
    return "jsonl";
  }
  return supportedImportTextFormats.has(normalized)
    ? (normalized as ImportTextFormat)
    : null;
}

function normalizeFormatName(format: string): string {
  return format.trim().toLowerCase().replace(/^\./, "");
}

function maxDelimitedColumnCount(rows: readonly string[][]): number {
  return Math.max(...rows.map((row) => row.length));
}

function padDelimitedRow(
  row: readonly string[],
  columnCount: number,
): string[] {
  return Array.from({ length: columnCount }, (_, index) => row[index] ?? "");
}

function delimitedColumns(columns: string[]) {
  return columns.map((column, index) => column || `column_${index + 1}`);
}

function hasDelimitedContent(row: string[]) {
  return row.some((cell) => cell !== "");
}

function parseJsonValue(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function jsonLines(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");
}

function firstJsonArrayProperty(
  value: Record<string, unknown>,
  keys: readonly string[],
): unknown[] | null {
  return keys.map((key) => value[key]).find(Array.isArray) ?? null;
}

function recordKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function nextUniqueName(base: string, counts: Map<string, number>) {
  const key = base.toLowerCase();
  const count = counts.get(key) ?? 0;
  counts.set(key, count + 1);
  return count === 0 ? base : `${base}_${count + 1}`;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

const sqlTypeChecks = [
  { type: "BOOLEAN", matches: isBooleanLike },
  { type: "INTEGER", matches: isIntegerLike },
  { type: "REAL", matches: isNumberLike },
] as const;

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
  return (
    typeof value === "string" &&
    /^-?\d+$/.test(value.trim()) &&
    !isZeroPaddedNumeric(value.trim())
  );
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
    /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) &&
    !isZeroPaddedNumeric(value.trim())
  );
}

/**
 * `01234` is a code (zip, phone, account number), not a number. Typing its
 * column INTEGER/REAL would make the engine coerce the quoted literal and
 * destroy the leading zero, so zero-padded digit strings must stay TEXT.
 * A decimal point exempts the value: `0.5` and friends are ordinary numbers.
 */
function isZeroPaddedNumeric(text: string) {
  return /^-?0\d/.test(text) && !text.includes(".");
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
  const text =
    typeof value === "object"
      ? JSON.stringify(jsonSafeValue(value))
      : String(value);
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
      Object.entries(value).map(([key, nested]) => [
        key,
        jsonSafeValue(nested),
      ]),
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
