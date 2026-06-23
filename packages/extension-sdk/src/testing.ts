import type {
  FakeDatabaseFixture,
  ResultGridCell,
  ResultGridColumn,
  ResultGridRow,
  ResultGridSnapshot,
} from "./generated/irodori-extension-api";

export function createFakeDatabase(fixture: FakeDatabaseFixture): FakeDatabaseFixture {
  return fixture;
}

export function createResultGridSnapshot(
  columns: readonly ResultGridColumn[],
  rows: readonly Record<string, unknown>[],
): ResultGridSnapshot {
  return {
    columns: [...columns],
    rows: rows.map((row, rowIndex): ResultGridRow => ({
      rowIndex,
      cells: Object.entries(row).map(
        ([column, value]): ResultGridCell => ({
          column,
          value,
        }),
      ),
    })),
    truncated: false,
  };
}

export function formatResultGridAsMarkdown(snapshot: ResultGridSnapshot): string {
  const columnNames = snapshot.columns.map((column) => column.name);
  const headers = columnNames.map(escapeMarkdownCell);
  const divider = headers.map(() => "---");
  const rows = snapshot.rows.map((row) =>
    columnNames.map((column) => escapeMarkdownCell(cellValue(row, column))),
  );

  return [headers, divider, ...rows]
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n");
}

function cellValue(row: ResultGridRow, column: string): string {
  const value = row.cells.find((cell) => cell.column === column)?.value;
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function escapeMarkdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}
