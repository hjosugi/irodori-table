// Interactive schema-diagram model.
//
// Unlike the read-only ERD (which is derived from live database metadata), a
// `DiagramDocument` is an editable design surface: tables carry canvas
// positions, columns/keys are edited directly, and relationships are stored by
// table id so on-canvas links stay stable while tables are renamed or moved.
//
// The document converts to a `TableSpecDocument` so the existing forward
// engineer (`buildCreateDatabaseSql`) produces the runnable CREATE script — the
// designer never re-implements DDL generation.

import type { DatabaseMetadata } from "@/generated/irodori-api";
import {
  buildCreateDatabaseSql,
  buildTableSpecDocument,
  tableSpecFormat,
  type TableSpecBuildOptions,
  type TableSpecDocument,
  type TableSpecTable,
} from "@/features/schema-designer";

export const schemaDiagramFormat = "irodori.schema-diagram.v1";

export type DiagramColumn = {
  id: string;
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
};

export type DiagramForeignKey = {
  id: string;
  columns: string[];
  referencesTableId: string;
  referencesColumns: string[];
};

export type DiagramTable = {
  id: string;
  schema: string;
  name: string;
  x: number;
  y: number;
  columns: DiagramColumn[];
  foreignKeys: DiagramForeignKey[];
};

export type DiagramDocument = {
  format: typeof schemaDiagramFormat;
  tables: DiagramTable[];
};

export const DIAGRAM_TABLE_WIDTH = 248;
const TABLE_HEADER_HEIGHT = 34;
const TABLE_ROW_HEIGHT = 26;
const TABLE_FOOTER_HEIGHT = 14;
const CANVAS_PADDING = 80;
const GRID_GAP_X = 84;
const GRID_ROW_HEIGHT = 232;
const GRID_ORIGIN = 40;

/** Height of a rendered table card, used for layout and edge routing. */
export function diagramTableHeight(table: DiagramTable): number {
  const rows = Math.max(1, table.columns.length);
  return TABLE_HEADER_HEIGHT + rows * TABLE_ROW_HEIGHT + TABLE_FOOTER_HEIGHT;
}

/** Bounding size of the whole canvas with padding around the tables. */
export function diagramCanvasSize(document: DiagramDocument): {
  width: number;
  height: number;
} {
  let width = 800;
  let height = 560;
  for (const table of document.tables) {
    width = Math.max(width, table.x + DIAGRAM_TABLE_WIDTH + CANVAS_PADDING);
    height = Math.max(
      height,
      table.y + diagramTableHeight(table) + CANVAS_PADDING,
    );
  }
  return { width, height };
}

export function tableNodeId(schema: string, name: string): string {
  return `t:${schema}.${name}`;
}

function columnNodeId(schema: string, table: string, column: string): string {
  return `c:${schema}.${table}.${column}`;
}

function gridPosition(index: number, total: number): { x: number; y: number } {
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, total))));
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: GRID_ORIGIN + column * (DIAGRAM_TABLE_WIDTH + GRID_GAP_X),
    y: GRID_ORIGIN + row * GRID_ROW_HEIGHT,
  };
}

/** A fresh, single-table diagram to start designing from scratch. */
export function blankDiagramDocument(): DiagramDocument {
  return {
    format: schemaDiagramFormat,
    tables: [
      {
        id: tableNodeId("", "new_table"),
        schema: "",
        name: "new_table",
        x: GRID_ORIGIN,
        y: GRID_ORIGIN,
        columns: [
          {
            id: columnNodeId("", "new_table", "id"),
            name: "id",
            dataType: "INTEGER",
            nullable: false,
            primaryKey: true,
            defaultValue: "",
          },
        ],
        foreignKeys: [],
      },
    ],
  };
}

/** Seed an editable diagram from live metadata, positioned on a grid. */
export function diagramFromMetadata(
  metadata: DatabaseMetadata,
  options: TableSpecBuildOptions = {},
): DiagramDocument {
  const spec = buildTableSpecDocument(metadata, options);
  const flat = spec.schemas.flatMap((schema) =>
    schema.tables.map((table) => ({ schema: schema.name, table })),
  );
  return {
    format: schemaDiagramFormat,
    tables: flat.map((entry, index) =>
      diagramTableFromSpec(
        entry.schema,
        entry.table,
        gridPosition(index, flat.length),
      ),
    ),
  };
}

function diagramTableFromSpec(
  schema: string,
  table: TableSpecTable,
  position: { x: number; y: number },
): DiagramTable {
  const id = tableNodeId(schema, table.name);
  const primaryKey = new Set(table.primaryKey);
  return {
    id,
    schema,
    name: table.name,
    x: position.x,
    y: position.y,
    columns: table.columns.map((column) => ({
      id: columnNodeId(schema, table.name, column.name),
      name: column.name,
      dataType: column.dataType,
      nullable: column.nullable,
      primaryKey: primaryKey.has(column.name),
      defaultValue: column.defaultValue ?? "",
    })),
    foreignKeys: table.foreignKeys.map((foreignKey, index) => ({
      id: `${id}:fk:${index}`,
      columns: foreignKey.columns,
      referencesTableId: tableNodeId(
        foreignKey.referencesSchema ?? schema,
        foreignKey.referencesTable,
      ),
      referencesColumns: foreignKey.referencesColumns,
    })),
  };
}

/** Convert to the shared table-spec model so the forward engineer can run. */
export function diagramToTableSpec(
  document: DiagramDocument,
): TableSpecDocument {
  const tablesById = new Map(document.tables.map((table) => [table.id, table]));
  const schemas = new Map<string, TableSpecTable[]>();

  for (const table of document.tables) {
    const list = schemas.get(table.schema) ?? [];
    list.push({
      name: table.name,
      columns: table.columns
        .filter((column) => column.name.trim() !== "")
        .map((column) => ({
          name: column.name,
          dataType: column.dataType,
          nullable: column.nullable,
          defaultValue: column.defaultValue.trim() || undefined,
        })),
      primaryKey: table.columns
        .filter((column) => column.primaryKey && column.name.trim() !== "")
        .map((column) => column.name),
      indexes: [],
      foreignKeys: table.foreignKeys.flatMap((foreignKey) =>
        foreignKeyToSpec(foreignKey, tablesById),
      ),
    });
    schemas.set(table.schema, list);
  }

  return {
    format: tableSpecFormat,
    exportedAt: new Date(0).toISOString(),
    schemas: [...schemas.entries()].map(([name, tables]) => ({ name, tables })),
  };
}

function foreignKeyToSpec(
  foreignKey: DiagramForeignKey,
  tablesById: Map<string, DiagramTable>,
) {
  const target = tablesById.get(foreignKey.referencesTableId);
  const columns = foreignKey.columns.filter(Boolean);
  const referencesColumns = foreignKey.referencesColumns.filter(Boolean);
  if (!target || columns.length === 0 || referencesColumns.length === 0) {
    return [];
  }
  return [
    {
      columns,
      referencesSchema: target.schema || undefined,
      referencesTable: target.name,
      referencesColumns,
    },
  ];
}

/** Forward-engineer a runnable CREATE script from the current diagram. */
export function diagramToCreateSql(document: DiagramDocument): string {
  return buildCreateDatabaseSql(diagramToTableSpec(document));
}

export function serializeDiagramDocument(document: DiagramDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseDiagramDocument(text: string): DiagramDocument {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || parsed.format !== schemaDiagramFormat) {
    throw new Error(
      `Unsupported schema diagram format. Expected ${schemaDiagramFormat}.`,
    );
  }
  if (!Array.isArray(parsed.tables)) {
    throw new Error("Schema diagram is missing tables.");
  }
  return {
    format: schemaDiagramFormat,
    tables: parsed.tables.map(parseDiagramTable),
  };
}

function parseDiagramTable(value: unknown): DiagramTable {
  if (!isRecord(value)) {
    throw new Error("Invalid table entry in schema diagram.");
  }
  const schema = stringValue(value.schema);
  const name = stringValue(value.name) || "table";
  const id = stringValue(value.id) || tableNodeId(schema, name);
  return {
    id,
    schema,
    name,
    x: finiteNumber(value.x, GRID_ORIGIN),
    y: finiteNumber(value.y, GRID_ORIGIN),
    columns: Array.isArray(value.columns)
      ? value.columns.map((column, index) =>
          parseDiagramColumn(column, `${id}:col:${index}`),
        )
      : [],
    foreignKeys: Array.isArray(value.foreignKeys)
      ? value.foreignKeys.map((foreignKey, index) =>
          parseDiagramForeignKey(foreignKey, `${id}:fk:${index}`),
        )
      : [],
  };
}

function parseDiagramColumn(value: unknown, fallbackId: string): DiagramColumn {
  if (!isRecord(value)) {
    throw new Error("Invalid column entry in schema diagram.");
  }
  return {
    id: stringValue(value.id) || fallbackId,
    name: stringValue(value.name),
    dataType: stringValue(value.dataType) || "TEXT",
    nullable: value.nullable !== false,
    primaryKey: value.primaryKey === true,
    defaultValue: stringValue(value.defaultValue),
  };
}

function parseDiagramForeignKey(
  value: unknown,
  fallbackId: string,
): DiagramForeignKey {
  if (!isRecord(value)) {
    throw new Error("Invalid relationship entry in schema diagram.");
  }
  return {
    id: stringValue(value.id) || fallbackId,
    columns: stringArray(value.columns),
    referencesTableId: stringValue(value.referencesTableId),
    referencesColumns: stringArray(value.referencesColumns),
  };
}

/**
 * Map a pointer event to canvas coordinates. `origin` is the on-screen
 * top-left of the (already scrolled and scaled) canvas layer — i.e. its
 * `getBoundingClientRect()` — so scroll position is accounted for implicitly.
 */
export function canvasPointFromPointer(
  clientX: number,
  clientY: number,
  origin: { left: number; top: number },
  zoom: number,
): { x: number; y: number } {
  const scale = zoom > 0 ? zoom : 1;
  return {
    x: (clientX - origin.left) / scale,
    y: (clientY - origin.top) / scale,
  };
}

/** Keep a table position on the canvas and snapped to whole pixels. */
export function clampTablePosition(
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
