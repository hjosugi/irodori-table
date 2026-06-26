import { describe, expect, it } from "vitest";
import type { DatabaseMetadata, DbObjectMetadata } from "@/generated/irodori-api";
import { buildErdModel, layoutErdModel, toMermaidErd } from "@/erd";

function table(
  schema: string,
  name: string,
  columns: string[],
  foreignKeys: DbObjectMetadata["foreignKeys"] = [],
): DbObjectMetadata {
  return {
    schema,
    name,
    kind: "table",
    columns: columns.map((column, index) => ({
      name: column,
      dataType: index === 0 ? "integer" : "text",
      nullable: index !== 0,
      ordinal: index + 1,
    })),
    indexes: [],
    primaryKey: [columns[0]],
    foreignKeys,
  };
}

describe("ERD model", () => {
  it("disambiguates duplicate table names and resolves cross-schema edges", () => {
    const metadata: DatabaseMetadata = {
      schemas: [
        {
          name: "sales",
          objects: [
            table("sales", "users", ["id"]),
            table("sales", "orders", ["id", "user_id"], [
              {
                columns: ["user_id"],
                referencesSchema: "auth",
                referencesTable: "users",
                referencesColumns: ["id"],
              },
            ]),
          ],
        },
        {
          name: "auth",
          objects: [table("auth", "users", ["id"])],
        },
      ],
    };

    const model = buildErdModel(metadata);
    expect(model.tables.map((item) => item.label)).toContain("sales.users");
    expect(model.tables.map((item) => item.label)).toContain("auth.users");
    expect(model.edges).toEqual([
      expect.objectContaining({
        sourceId: "sales.orders",
        targetId: "auth.users",
        crossSchema: true,
      }),
    ]);
    expect(toMermaidErd(metadata)).toContain(
      'sales_orders }o--|| auth_users : "user_id"',
    );
  });

  it("prefers same-schema FK targets and skips ambiguous duplicate names", () => {
    const metadata: DatabaseMetadata = {
      schemas: [
        {
          name: "sales",
          objects: [
            table("sales", "customers", ["id"]),
            table("sales", "invoices", ["id", "customer_id"], [
              {
                columns: ["customer_id"],
                referencesTable: "customers",
                referencesColumns: ["id"],
              },
            ]),
          ],
        },
        {
          name: "crm",
          objects: [table("crm", "customers", ["id"])],
        },
        {
          name: "support",
          objects: [
            table("support", "tickets", ["id", "customer_id"], [
              {
                columns: ["customer_id"],
                referencesTable: "customers",
                referencesColumns: ["id"],
              },
            ]),
          ],
        },
      ],
    };

    const model = buildErdModel(metadata);

    expect(
      model.tables
        .filter((item) => item.name === "customers")
        .map((item) => item.label),
    ).toEqual(["sales.customers", "crm.customers"]);
    expect(model.edges).toEqual([
      expect.objectContaining({
        sourceId: "sales.invoices",
        targetId: "sales.customers",
        crossSchema: false,
      }),
    ]);
  });

  it("filters by schema and search text", () => {
    const metadata: DatabaseMetadata = {
      schemas: [
        { name: "public", objects: [table("public", "orders", ["id", "status"])] },
        { name: "audit", objects: [table("audit", "events", ["id", "payload"])] },
      ],
    };

    expect(buildErdModel(metadata, { schemaNames: ["audit"] }).tables).toHaveLength(1);
    const searched = buildErdModel(metadata, { search: "status" });
    expect(searched.tables.map((item) => item.id)).toEqual(["public.orders"]);
    expect(searched.filtered).toBe(true);
  });

  it("prunes relationships when schema or search filters hide an endpoint", () => {
    const metadata: DatabaseMetadata = {
      schemas: [
        {
          name: "public",
          objects: [
            table("public", "users", ["id", "email"]),
            table("public", "orders", ["id", "user_id", "status"], [
              {
                columns: ["user_id"],
                referencesTable: "users",
                referencesColumns: ["id"],
              },
            ]),
          ],
        },
        {
          name: "audit",
          objects: [
            table("audit", "events", ["id", "order_id", "payload"], [
              {
                columns: ["order_id"],
                referencesSchema: "public",
                referencesTable: "orders",
                referencesColumns: ["id"],
              },
            ]),
          ],
        },
      ],
    };

    const publicOnly = buildErdModel(metadata, { schemaNames: ["public"] });
    expect(publicOnly.tables.map((item) => item.id)).toEqual([
      "public.users",
      "public.orders",
    ]);
    expect(publicOnly.edges.map((edge) => edge.id)).toEqual([
      "public.orders->public.users:user_id",
    ]);

    const childOnlySearch = buildErdModel(metadata, { search: "status" });
    expect(childOnlySearch.tables.map((item) => item.id)).toEqual(["public.orders"]);
    expect(childOnlySearch.edges).toEqual([]);

    const hiddenTargetSchema = buildErdModel(metadata, { schemaNames: ["audit"] });
    expect(hiddenTargetSchema.tables.map((item) => item.id)).toEqual(["audit.events"]);
    expect(hiddenTargetSchema.edges).toEqual([]);
  });

  it("represents multi-schema groups with same-schema and cross-schema relationships", () => {
    const metadata: DatabaseMetadata = {
      schemas: [
        {
          name: "sales",
          objects: [
            table("sales", "customers", ["id", "email"]),
            table("sales", "orders", ["id", "customer_id", "owner_id"], [
              {
                columns: ["customer_id"],
                referencesTable: "customers",
                referencesColumns: ["id"],
              },
              {
                columns: ["owner_id"],
                referencesSchema: "auth",
                referencesTable: "users",
                referencesColumns: ["id"],
              },
            ]),
          ],
        },
        {
          name: "audit",
          objects: [
            table("audit", "order_events", ["id", "order_id"], [
              {
                columns: ["order_id"],
                referencesSchema: "sales",
                referencesTable: "orders",
                referencesColumns: ["id"],
              },
            ]),
          ],
        },
        {
          name: "auth",
          objects: [table("auth", "users", ["id", "name"])],
        },
      ],
    };

    const model = buildErdModel(metadata);
    expect(model.schemas.map((schema) => [schema.name, schema.tables.length])).toEqual([
      ["sales", 2],
      ["audit", 1],
      ["auth", 1],
    ]);
    expect(model.edges).toEqual([
      expect.objectContaining({
        sourceId: "sales.orders",
        targetId: "sales.customers",
        label: "customer_id",
        crossSchema: false,
      }),
      expect.objectContaining({
        sourceId: "sales.orders",
        targetId: "auth.users",
        label: "owner_id",
        crossSchema: true,
      }),
      expect.objectContaining({
        sourceId: "audit.order_events",
        targetId: "sales.orders",
        label: "order_id",
        crossSchema: true,
      }),
    ]);

    const layout = layoutErdModel(model);
    expect(layout.schemas.map((schema) => schema.name)).toEqual([
      "sales",
      "audit",
      "auth",
    ]);
    expect(layout.edges).toHaveLength(3);
    expect(layout.edges.filter((edge) => edge.crossSchema)).toHaveLength(2);
    for (const edge of layout.edges) {
      expectEdgePathToBeSane(edge, layout);
    }
  });

  it("lays out self and cross-schema edges with finite anchored paths", () => {
    const metadata: DatabaseMetadata = {
      schemas: [
        {
          name: "org",
          objects: [
            table("org", "employees", ["id", "manager_id", "account_id"], [
              {
                columns: ["manager_id"],
                referencesTable: "employees",
                referencesColumns: ["id"],
              },
              {
                columns: ["account_id"],
                referencesSchema: "auth",
                referencesTable: "accounts",
                referencesColumns: ["id"],
              },
            ]),
          ],
        },
        {
          name: "auth",
          objects: [table("auth", "accounts", ["id"])],
        },
      ],
    };

    const model = buildErdModel(metadata);
    expect(model.edges).toEqual([
      expect.objectContaining({
        sourceId: "org.employees",
        targetId: "org.employees",
        crossSchema: false,
      }),
      expect.objectContaining({
        sourceId: "org.employees",
        targetId: "auth.accounts",
        crossSchema: true,
      }),
    ]);
    expect(
      model.tables
        .find((item) => item.id === "org.employees")
        ?.columns.filter((column) => column.foreignKey)
        .map((column) => column.name),
    ).toEqual(["manager_id", "account_id"]);

    const layout = layoutErdModel(model);
    expect(layout.edges).toHaveLength(2);
    for (const edge of layout.edges) {
      expectEdgePathToBeSane(edge, layout);
    }
  });

  it("lays out a dense 100-table fixture with 250 finite anchored edges", () => {
    const objects = Array.from({ length: 100 }, (_, index) =>
      denseWarehouseTable(index),
    );
    const metadata: DatabaseMetadata = {
      schemas: [{ name: "warehouse", objects }],
    };
    const layout = layoutErdModel(buildErdModel(metadata));
    expect(layout.tables).toHaveLength(100);
    expect(layout.edges).toHaveLength(250);
    expect(layout.width).toBeGreaterThan(900);
    expect(layout.height).toBeGreaterThan(2000);
    expect(layout.edges.map((edge) => edge.path).join(" ")).not.toMatch(
      /\b(?:NaN|undefined)\b/,
    );

    for (let i = 0; i < layout.tables.length; i += 1) {
      for (let j = i + 1; j < layout.tables.length; j += 1) {
        expect(rectsOverlap(layout.tables[i], layout.tables[j])).toBe(false);
      }
    }

    for (const edge of layout.edges) {
      expectEdgePathToBeSane(edge, layout);
    }
  });

  it("keeps multi-schema groups separated and tables inside their group bounds", () => {
    const metadata: DatabaseMetadata = {
      schemas: [
        {
          name: "alpha",
          objects: Array.from({ length: 6 }, (_, index) =>
            table("alpha", `table_${index + 1}`, ["id", "name"]),
          ),
        },
        {
          name: "beta",
          objects: Array.from({ length: 5 }, (_, index) =>
            table("beta", `table_${index + 1}`, ["id", "description", "status"]),
          ),
        },
        {
          name: "gamma",
          objects: Array.from({ length: 7 }, (_, index) =>
            table("gamma", `table_${index + 1}`, ["id", "code", "value", "updated_at"]),
          ),
        },
      ],
    };

    const model = buildErdModel(metadata);
    expect(model.schemas.map((schema) => [schema.name, schema.tables.length])).toEqual([
      ["alpha", 6],
      ["beta", 5],
      ["gamma", 7],
    ]);

    const layout = layoutErdModel(model);
    expect(layout.schemas.map((schema) => [schema.name, schema.tableCount])).toEqual([
      ["alpha", 6],
      ["beta", 5],
      ["gamma", 7],
    ]);

    for (let i = 0; i < layout.schemas.length; i += 1) {
      for (let j = i + 1; j < layout.schemas.length; j += 1) {
        expect(rectsOverlap(layout.schemas[i], layout.schemas[j])).toBe(false);
      }
    }

    for (const tableLayout of layout.tables) {
      const schemaLayout = layout.schemas.find(
        (schema) => schema.name === tableLayout.table.schema,
      );
      expect(schemaLayout).toBeDefined();
      expect(tableLayout.x).toBeGreaterThanOrEqual(schemaLayout!.x);
      expect(tableLayout.y).toBeGreaterThanOrEqual(schemaLayout!.y);
      expect(tableLayout.x + tableLayout.width).toBeLessThanOrEqual(
        schemaLayout!.x + schemaLayout!.width,
      );
      expect(tableLayout.y + tableLayout.height).toBeLessThanOrEqual(
        schemaLayout!.y + schemaLayout!.height,
      );
    }
  });
});

function denseWarehouseTable(index: number) {
  const tableNumber = index + 1;
  const foreignKeys: DbObjectMetadata["foreignKeys"] = [];
  if (tableNumber > 1) {
    foreignKeys.push({
      columns: ["parent_id"],
      referencesTable: `table_${tableNumber - 1}`,
      referencesColumns: ["id"],
    });
  }
  if (tableNumber > 2) {
    foreignKeys.push({
      columns: ["prior_id"],
      referencesTable: `table_${tableNumber - 2}`,
      referencesColumns: ["id"],
    });
  }
  if (tableNumber >= 11 && tableNumber <= 63) {
    foreignKeys.push({
      columns: ["anchor_id"],
      referencesTable: `table_${tableNumber - 10}`,
      referencesColumns: ["id"],
    });
  }
  return table(
    "warehouse",
    `table_${tableNumber}`,
    ["id", "parent_id", "prior_id", "anchor_id", "name"],
    foreignKeys,
  );
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function expectEdgePathToBeSane(
  edge: {
    sourceId: string;
    targetId: string;
    path: string;
    labelX: number;
    labelY: number;
  },
  layout: ReturnType<typeof layoutErdModel>,
) {
  const numbers = edge.path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  expect(numbers).toHaveLength(8);
  for (const value of numbers) {
    expect(Number.isFinite(value)).toBe(true);
  }
  expect(edge.path).toMatch(/^M -?\d+(?:\.\d+)? -?\d+(?:\.\d+)? C /);
  expect(Number.isFinite(edge.labelX)).toBe(true);
  expect(Number.isFinite(edge.labelY)).toBe(true);
  expect(edge.labelX).toBeGreaterThanOrEqual(0);
  expect(edge.labelX).toBeLessThanOrEqual(layout.width);
  expect(edge.labelY).toBeGreaterThanOrEqual(0);
  expect(edge.labelY).toBeLessThanOrEqual(layout.height);

  const source = layout.tables.find(
    (tableLayout) => tableLayout.table.id === edge.sourceId,
  );
  const target = layout.tables.find(
    (tableLayout) => tableLayout.table.id === edge.targetId,
  );
  expect(source).toBeDefined();
  expect(target).toBeDefined();

  const [sx, sy, , , , , tx, ty] = numbers;
  expect(pointTouchesVerticalEdge(source!, sx, sy)).toBe(true);
  expect(pointTouchesVerticalEdge(target!, tx, ty)).toBe(true);
}

function pointTouchesVerticalEdge(
  rect: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
) {
  const onLeftOrRight = x === rect.x || x === rect.x + rect.width;
  return onLeftOrRight && y >= rect.y && y <= rect.y + rect.height;
}
