import writeXlsxFile from "write-excel-file/browser";
import type { ResultLike } from "./result-export";

type XlsxCell = {
  value: string | number | boolean;
  type: typeof String | typeof Number | typeof Boolean;
  fontWeight?: "bold";
};

// An empty cell is represented by `null` (not a cell object with a null value).
function xlsxCell(value: unknown): XlsxCell | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value, type: Number };
  }
  if (typeof value === "boolean") {
    return { value, type: Boolean };
  }
  if (typeof value === "bigint") {
    return { value: value.toString(), type: String };
  }
  if (typeof value === "object") {
    return { value: JSON.stringify(value), type: String };
  }
  return { value: String(value), type: String };
}

/**
 * Build a real (OOXML) `.xlsx` workbook from a result set. Returns a Blob so the
 * caller can save it like any other export. Header row is bold; number/boolean
 * cells keep their type and everything else is stringified.
 */
export async function buildXlsxBlob(
  result: ResultLike,
  sheetName = "Result",
): Promise<Blob> {
  const header: XlsxCell[] = result.columns.map((column) => ({
    value: column,
    type: String,
    fontWeight: "bold",
  }));
  const rows: (XlsxCell | null)[][] = result.rows.map((row) =>
    result.columns.map((_column, index) => xlsxCell(row[index])),
  );
  const data = [header, ...rows];
  const sheet = sheetName.slice(0, 31) || "Result";
  return writeXlsxFile(data, { sheet }) as unknown as Promise<Blob>;
}
