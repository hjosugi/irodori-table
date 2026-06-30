import { beforeEach, describe, expect, it } from "vitest";
import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import {
  blankDiagramDocument,
  canvasPointFromPointer,
  clampTablePosition,
  diagramFromMetadata,
  diagramToCreateSql,
  diagramToTableSpec,
  parseDiagramDocument,
  schemaDiagramFormat,
  serializeDiagramDocument,
  tableNodeId,
  useSchemaDiagramStore,
  type DiagramDocument,
} from "@/features/schema-diagram";

function table(
  schema: string,
  name: string,
  columns: Array<[string, string, boolean?]>,
  foreignKeys: DbObjectMetadata["foreignKeys"] = [],
): DbObjectMetadata {
  return {
    schema,
    name,
    kind: "table",
    columns: columns.map(([column, dataType, nullable], index) => ({
      name: column,
      dataType,
      nullable: nullable ?? column !== "id",
      ordinal: index + 1,
    })),
    indexes: [],
    primaryKey: ["id"],
    foreignKeys,
  };
}

const metadata: DatabaseMetadata = {
  schemas: [
    {
      name: "sales",
      objects: [
        // orders declared before its dependency to exercise FK ordering.
        table(
          "sales",
          "orders",
          [
            ["id", "INTEGER", false],
            ["customer_id", "INTEGER", false],
          ],
          [
            {
              columns: ["customer_id"],
              referencesSchema: "sales",
              referencesTable: "customers",
              referencesColumns: ["id"],
            },
          ],
        ),
        table("sales", "customers", [
          ["id", "INTEGER", false],
          ["name", "TEXT", false],
        ]),
      ],
    },
  ],
};

describe("schema diagram model", () => {
  it("seeds an editable diagram from metadata with positions and keys", () => {
    const document = diagramFromMetadata(metadata);

    expect(document.format).toBe(schemaDiagramFormat);
    expect(document.tables).toHaveLength(2);

    const orders = document.tables.find((item) => item.name === "orders");
    expect(orders).toBeDefined();
    expect(typeof orders?.x).toBe("number");
    expect(typeof orders?.y).toBe("number");
    expect(
      orders?.columns.find((column) => column.name === "id")?.primaryKey,
    ).toBe(true);
    expect(orders?.foreignKeys[0]).toMatchObject({
      columns: ["customer_id"],
      referencesTableId: tableNodeId("sales", "customers"),
      referencesColumns: ["id"],
    });
  });

  it("forward-engineers FK-ordered DDL from the diagram", () => {
    const sql = diagramToCreateSql(diagramFromMetadata(metadata));

    expect(sql.indexOf('CREATE TABLE "sales"."customers"')).toBeLessThan(
      sql.indexOf('CREATE TABLE "sales"."orders"'),
    );
    expect(sql).toContain(
      'FOREIGN KEY ("customer_id") REFERENCES "sales"."customers" ("id")',
    );
  });

  it("drops incomplete columns and unresolved relationships when converting", () => {
    const document: DiagramDocument = {
      format: schemaDiagramFormat,
      tables: [
        {
          id: "t:.events",
          schema: "",
          name: "events",
          x: 0,
          y: 0,
          columns: [
            {
              id: "c1",
              name: "id",
              dataType: "INTEGER",
              nullable: false,
              primaryKey: true,
              defaultValue: "",
            },
            {
              id: "c2",
              name: "",
              dataType: "TEXT",
              nullable: true,
              primaryKey: false,
              defaultValue: "",
            },
          ],
          foreignKeys: [
            {
              id: "fk1",
              columns: ["id"],
              referencesTableId: "t:.missing",
              referencesColumns: ["id"],
            },
          ],
        },
      ],
    };

    const spec = diagramToTableSpec(document);
    expect(spec.schemas[0].tables[0].columns).toHaveLength(1);
    expect(spec.schemas[0].tables[0].foreignKeys).toHaveLength(0);
  });

  it("round-trips through JSON", () => {
    const document = diagramFromMetadata(metadata);
    expect(parseDiagramDocument(serializeDiagramDocument(document))).toEqual(
      document,
    );
  });

  it("rejects an unknown diagram format", () => {
    expect(() => parseDiagramDocument('{"format":"nope","tables":[]}')).toThrow(
      /Unsupported schema diagram format/,
    );
  });

  it("maps pointer coordinates through zoom and clamps positions", () => {
    expect(canvasPointFromPointer(300, 150, { left: 100, top: 50 }, 2)).toEqual(
      { x: 100, y: 50 },
    );
    expect(clampTablePosition(-5, 12.4)).toEqual({ x: 0, y: 12 });
  });
});

describe("schema diagram store", () => {
  beforeEach(() => {
    useSchemaDiagramStore.setState({
      open: false,
      document: blankDiagramDocument(),
      selectedTableId: null,
    });
  });

  it("opens a blank document and adds tables", () => {
    const store = useSchemaDiagramStore.getState();
    store.openBlank();
    expect(useSchemaDiagramStore.getState().document.tables).toHaveLength(1);

    useSchemaDiagramStore.getState().addTable();
    const state = useSchemaDiagramStore.getState();
    expect(state.document.tables).toHaveLength(2);
    expect(state.selectedTableId).toBe(state.document.tables[1].id);
  });

  it("edits columns and clamps moves", () => {
    useSchemaDiagramStore.getState().openBlank();
    const tableId = useSchemaDiagramStore.getState().document.tables[0].id;

    useSchemaDiagramStore.getState().addColumn(tableId);
    const columns = useSchemaDiagramStore.getState().document.tables[0].columns;
    const newColumn = columns[columns.length - 1];
    useSchemaDiagramStore
      .getState()
      .updateColumn(tableId, newColumn.id, { name: "email", dataType: "TEXT" });
    const updated = useSchemaDiagramStore.getState().document.tables[0].columns;
    expect(updated[updated.length - 1]).toMatchObject({
      name: "email",
      dataType: "TEXT",
    });

    useSchemaDiagramStore.getState().moveTable(tableId, -40, 30);
    expect(useSchemaDiagramStore.getState().document.tables[0]).toMatchObject({
      x: 0,
      y: 30,
    });

    useSchemaDiagramStore.getState().removeColumn(tableId, newColumn.id);
    expect(
      useSchemaDiagramStore.getState().document.tables[0].columns,
    ).toHaveLength(1);
  });

  it("creates relationships and cleans them up when a table is removed", () => {
    useSchemaDiagramStore.getState().openBlank();
    useSchemaDiagramStore.getState().addTable();
    const [first, second] = useSchemaDiagramStore.getState().document.tables;

    useSchemaDiagramStore.getState().addForeignKey(second.id);
    const fk =
      useSchemaDiagramStore.getState().document.tables[1].foreignKeys[0];
    expect(fk.referencesTableId).toBe(first.id);

    useSchemaDiagramStore.getState().removeTable(first.id);
    const state = useSchemaDiagramStore.getState();
    expect(state.document.tables).toHaveLength(1);
    expect(state.document.tables[0].foreignKeys).toHaveLength(0);
  });
});
