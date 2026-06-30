import { create } from "zustand";
import {
  blankDiagramDocument,
  clampTablePosition,
  DIAGRAM_TABLE_WIDTH,
  type DiagramColumn,
  type DiagramDocument,
  type DiagramForeignKey,
  type DiagramTable,
} from "./schema-diagram";

let idCounter = 0;

/** Process-unique id for runtime-created tables, columns, and relationships. */
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function mapTable(
  document: DiagramDocument,
  tableId: string,
  update: (table: DiagramTable) => DiagramTable,
): DiagramDocument {
  return {
    ...document,
    tables: document.tables.map((table) =>
      table.id === tableId ? update(table) : table,
    ),
  };
}

function blankColumn(): DiagramColumn {
  return {
    id: nextId("col"),
    name: "",
    dataType: "TEXT",
    nullable: true,
    primaryKey: false,
    defaultValue: "",
  };
}

function nextTablePosition(document: DiagramDocument): {
  x: number;
  y: number;
} {
  if (document.tables.length === 0) {
    return { x: 40, y: 40 };
  }
  const rightMost = document.tables.reduce(
    (max, table) => Math.max(max, table.x),
    0,
  );
  const topRow = document.tables.filter((table) => table.x === rightMost);
  const lowest = topRow.reduce((max, table) => Math.max(max, table.y), 0);
  return { x: rightMost + DIAGRAM_TABLE_WIDTH + 84, y: lowest };
}

type SchemaDiagramState = {
  open: boolean;
  document: DiagramDocument;
  selectedTableId: string | null;
  openBlank: () => void;
  openFromDocument: (document: DiagramDocument) => void;
  close: () => void;
  setDocument: (document: DiagramDocument) => void;
  selectTable: (tableId: string | null) => void;
  moveTable: (tableId: string, x: number, y: number) => void;
  addTable: () => void;
  removeTable: (tableId: string) => void;
  updateTable: (
    tableId: string,
    patch: Partial<Pick<DiagramTable, "name" | "schema">>,
  ) => void;
  addColumn: (tableId: string) => void;
  updateColumn: (
    tableId: string,
    columnId: string,
    patch: Partial<Omit<DiagramColumn, "id">>,
  ) => void;
  removeColumn: (tableId: string, columnId: string) => void;
  addForeignKey: (tableId: string) => void;
  updateForeignKey: (
    tableId: string,
    foreignKeyId: string,
    patch: Partial<Omit<DiagramForeignKey, "id">>,
  ) => void;
  removeForeignKey: (tableId: string, foreignKeyId: string) => void;
};

export const useSchemaDiagramStore = create<SchemaDiagramState>((set) => ({
  open: false,
  document: blankDiagramDocument(),
  selectedTableId: null,

  openBlank: () => {
    const document = blankDiagramDocument();
    set({
      open: true,
      document,
      selectedTableId: document.tables[0]?.id ?? null,
    });
  },

  openFromDocument: (document) =>
    set({
      open: true,
      document,
      selectedTableId: document.tables[0]?.id ?? null,
    }),

  close: () => set({ open: false }),

  setDocument: (document) =>
    set((state) => ({
      document,
      selectedTableId:
        document.tables.find((table) => table.id === state.selectedTableId)
          ?.id ??
        document.tables[0]?.id ??
        null,
    })),

  selectTable: (tableId) => set({ selectedTableId: tableId }),

  moveTable: (tableId, x, y) =>
    set((state) => ({
      document: mapTable(state.document, tableId, (table) => ({
        ...table,
        ...clampTablePosition(x, y),
      })),
    })),

  addTable: () =>
    set((state) => {
      const position = nextTablePosition(state.document);
      const id = nextId("table");
      const table: DiagramTable = {
        id,
        schema: state.document.tables[0]?.schema ?? "",
        name: "new_table",
        x: position.x,
        y: position.y,
        columns: [
          {
            id: nextId("col"),
            name: "id",
            dataType: "INTEGER",
            nullable: false,
            primaryKey: true,
            defaultValue: "",
          },
        ],
        foreignKeys: [],
      };
      return {
        document: {
          ...state.document,
          tables: [...state.document.tables, table],
        },
        selectedTableId: id,
      };
    }),

  removeTable: (tableId) =>
    set((state) => ({
      document: {
        ...state.document,
        tables: state.document.tables
          .filter((table) => table.id !== tableId)
          .map((table) => ({
            ...table,
            foreignKeys: table.foreignKeys.filter(
              (foreignKey) => foreignKey.referencesTableId !== tableId,
            ),
          })),
      },
      selectedTableId:
        state.selectedTableId === tableId ? null : state.selectedTableId,
    })),

  updateTable: (tableId, patch) =>
    set((state) => ({
      document: mapTable(state.document, tableId, (table) => ({
        ...table,
        ...patch,
      })),
    })),

  addColumn: (tableId) =>
    set((state) => ({
      document: mapTable(state.document, tableId, (table) => ({
        ...table,
        columns: [...table.columns, blankColumn()],
      })),
    })),

  updateColumn: (tableId, columnId, patch) =>
    set((state) => ({
      document: mapTable(state.document, tableId, (table) => ({
        ...table,
        columns: table.columns.map((column) =>
          column.id === columnId ? { ...column, ...patch } : column,
        ),
      })),
    })),

  removeColumn: (tableId, columnId) =>
    set((state) => ({
      document: mapTable(state.document, tableId, (table) => ({
        ...table,
        columns: table.columns.filter((column) => column.id !== columnId),
      })),
    })),

  addForeignKey: (tableId) =>
    set((state) => {
      const target = state.document.tables.find(
        (table) => table.id !== tableId,
      );
      return {
        document: mapTable(state.document, tableId, (table) => ({
          ...table,
          foreignKeys: [
            ...table.foreignKeys,
            {
              id: nextId("fk"),
              columns: [table.columns[0]?.name ?? ""],
              referencesTableId: target?.id ?? "",
              referencesColumns: [
                target?.columns.find((column) => column.primaryKey)?.name ??
                  target?.columns[0]?.name ??
                  "",
              ],
            },
          ],
        })),
      };
    }),

  updateForeignKey: (tableId, foreignKeyId, patch) =>
    set((state) => ({
      document: mapTable(state.document, tableId, (table) => ({
        ...table,
        foreignKeys: table.foreignKeys.map((foreignKey) =>
          foreignKey.id === foreignKeyId
            ? { ...foreignKey, ...patch }
            : foreignKey,
        ),
      })),
    })),

  removeForeignKey: (tableId, foreignKeyId) =>
    set((state) => ({
      document: mapTable(state.document, tableId, (table) => ({
        ...table,
        foreignKeys: table.foreignKeys.filter(
          (foreignKey) => foreignKey.id !== foreignKeyId,
        ),
      })),
    })),
}));
