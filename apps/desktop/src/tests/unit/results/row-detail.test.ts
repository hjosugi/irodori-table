import { describe, expect, it } from "vitest";

import type {
  DatabaseMetadata,
  DbObjectMetadata,
  ForeignKey,
} from "@/generated/irodori-api";
import {
  buildJsonTree,
  buildForeignKeyLookup,
  findTableByName,
  findTableMetadata,
  formatRowAsJson,
  foreignKeyColumns,
  formatDetailValue,
  parseSourceTable,
  quoteIdent,
  rowToJsonObject,
} from "@/features/results/row-detail";

function column(name: string, dataType = "text") {
  return { name, dataType, nullable: true, ordinal: 0 };
}

function table(
  name: string,
  columns: string[],
  foreignKeys: ForeignKey[] = [],
  schema = "public",
): DbObjectMetadata {
  return {
    schema,
    name,
    kind: "table",
    columns: columns.map((c) => column(c)),
    indexes: [],
    primaryKey: [],
    foreignKeys,
  };
}

function metadata(...tables: DbObjectMetadata[]): DatabaseMetadata {
  const bySchema = new Map<string, DbObjectMetadata[]>();
  for (const t of tables) {
    bySchema.set(t.schema, [...(bySchema.get(t.schema) ?? []), t]);
  }
  return {
    schemas: [...bySchema].map(([name, objects]) => ({ name, objects })),
  };
}

describe("formatDetailValue", () => {
  it("renders NULL for null/undefined", () => {
    expect(formatDetailValue(null)).toEqual({ text: "NULL", json: false });
    expect(formatDetailValue(undefined)).toEqual({ text: "NULL", json: false });
  });

  it("pretty-prints objects and arrays as JSON", () => {
    const detail = formatDetailValue({ a: 1, b: [2, 3] });
    expect(detail.json).toBe(true);
    expect(detail.text).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  it("stringifies scalars without the JSON flag", () => {
    expect(formatDetailValue(42)).toEqual({ text: "42", json: false });
    expect(formatDetailValue("hi")).toEqual({ text: "hi", json: false });
    expect(formatDetailValue(false)).toEqual({ text: "false", json: false });
  });

  it("renders bigint values without throwing", () => {
    expect(formatDetailValue(42n)).toEqual({ text: "42", json: false });
    expect(formatDetailValue({ id: 42n }).text).toBe('{\n  "id": "42"\n}');
  });
});

describe("row JSON helpers", () => {
  it("formats a complete row as JSON", () => {
    expect(
      formatRowAsJson(["id", "name", "meta"], [1, "Kawase", { tier: "gold" }]),
    ).toBe(
      '{\n  "id": 1,\n  "name": "Kawase",\n  "meta": {\n    "tier": "gold"\n  }\n}',
    );
  });

  it("keeps duplicate result-column names by suffixing keys", () => {
    expect(rowToJsonObject(["id", "id", "id_2", ""], [1, 2, 3, 4])).toEqual({
      id: 1,
      id_2: 2,
      id_2_2: 3,
      column_4: 4,
    });
  });

  it("normalizes values that JSON.stringify cannot handle directly", () => {
    const circular: Record<string, unknown> = { id: 1 };
    circular.self = circular;
    expect(
      rowToJsonObject(
        ["big", "missing", "circular"],
        [9n, undefined, circular],
      ),
    ).toEqual({
      big: "9",
      missing: null,
      circular: { id: 1, self: "[Circular]" },
    });
  });

  it("builds a browsable JSON tree", () => {
    const tree = buildJsonTree(
      rowToJsonObject(["id", "payload"], [1, { tags: ["a", "b"] }]),
    );
    expect(tree.type).toBe("object");
    expect(tree.children.map((node) => node.key)).toEqual(["id", "payload"]);
    const payload = tree.children[1];
    expect(payload.path).toBe("$.payload");
    expect(payload.children[0].path).toBe("$.payload.tags");
    expect(payload.children[0].children[1].preview).toBe('"b"');
  });
});

describe("parseSourceTable", () => {
  it("parses a bare table", () => {
    expect(parseSourceTable("select * from customers")).toEqual({
      table: "customers",
    });
  });

  it("parses a schema-qualified table and ignores the alias", () => {
    expect(
      parseSourceTable("SELECT o.id FROM public.orders o WHERE o.id = 1"),
    ).toEqual({
      schema: "public",
      table: "orders",
    });
  });

  it("strips identifier quoting", () => {
    expect(parseSourceTable('select * from "Sales"."Orders"')).toEqual({
      schema: "Sales",
      table: "Orders",
    });
    expect(parseSourceTable("select * from `orders`")).toEqual({
      table: "orders",
    });
    expect(parseSourceTable("select * from [Sales].[Orders]")).toEqual({
      schema: "Sales",
      table: "Orders",
    });
  });

  it("returns null when there is no FROM", () => {
    expect(parseSourceTable("select 1 + 1")).toBeNull();
  });
});

describe("findTableMetadata", () => {
  const meta = metadata(
    table("orders", ["id", "customer_id", "total"]),
    table("customers", ["id", "name"]),
  );

  it("resolves by FROM-clause name", () => {
    const found = findTableMetadata(meta, { table: "orders" }, [
      "id",
      "customer_id",
      "total",
    ]);
    expect(found?.name).toBe("orders");
  });

  it("uses result columns to disambiguate duplicate FROM-clause names", () => {
    const duplicateMeta = metadata(
      table("orders", ["id", "created_at"], [], "public"),
      table("orders", ["id", "customer_id", "total"], [], "sales"),
    );
    const found = findTableMetadata(duplicateMeta, { table: "orders" }, [
      "id",
      "customer_id",
    ]);
    expect(found?.schema).toBe("sales");
  });

  it("keeps a unique FROM-clause match even when result columns are computed", () => {
    const found = findTableMetadata(meta, { table: "orders" }, ["count"]);
    expect(found?.name).toBe("orders");
  });

  it("falls back to column matching when the FROM table is unknown", () => {
    const found = findTableMetadata(meta, { table: "missing_table" }, [
      "id",
      "name",
    ]);
    expect(found?.name).toBe("customers");
  });

  it("falls back to a unique column superset when FROM is unknown", () => {
    const found = findTableMetadata(meta, null, ["id", "name"]);
    expect(found?.name).toBe("customers");
  });

  it("returns null when the column match is ambiguous", () => {
    // "id" alone is a superset of both tables.
    expect(findTableMetadata(meta, null, ["id"])).toBeNull();
  });
});

describe("findTableByName", () => {
  const meta = metadata(
    table("orders", ["id"]),
    table("customers", ["id"], [], "sales"),
  );

  it("matches case-insensitively, optionally by schema", () => {
    expect(findTableByName(meta, undefined, "ORDERS")?.name).toBe("orders");
    expect(findTableByName(meta, "sales", "customers")?.schema).toBe("sales");
    expect(findTableByName(meta, "public", "customers")).toBeNull();
  });
});

describe("foreignKeyColumns", () => {
  const fk: ForeignKey = {
    columns: ["customer_id"],
    referencesTable: "customers",
    referencesColumns: ["id"],
  };
  const orders = table("orders", ["id", "customer_id", "total"], [fk]);

  it("maps a FK local column to its result index", () => {
    const map = foreignKeyColumns(orders, ["id", "customer_id", "total"]);
    expect(map.get(1)?.fk.referencesTable).toBe("customers");
    expect(map.get(1)?.columnIndexes).toEqual([1]);
    expect(map.has(0)).toBe(false);
  });

  it("maps FK columns case-insensitively", () => {
    const map = foreignKeyColumns(orders, ["ID", "CUSTOMER_ID", "TOTAL"]);
    expect(map.get(1)?.fk.referencesTable).toBe("customers");
    expect(map.get(1)?.columnIndexes).toEqual([1]);
  });

  it("skips FKs whose columns are not all present in the result", () => {
    const map = foreignKeyColumns(orders, ["id", "total"]);
    expect(map.size).toBe(0);
  });

  it("handles composite foreign keys", () => {
    const composite: ForeignKey = {
      columns: ["org_id", "user_id"],
      referencesTable: "members",
      referencesColumns: ["org_id", "id"],
    };
    const t = table("audit", ["org_id", "user_id", "action"], [composite]);
    const map = foreignKeyColumns(t, ["org_id", "user_id", "action"]);
    expect(map.get(0)).toBe(map.get(1));
    expect(map.get(0)?.columnIndexes).toEqual([0, 1]);
  });
});

describe("quoteIdent", () => {
  it("quotes per dialect and escapes", () => {
    expect(quoteIdent("col", "postgres")).toBe('"col"');
    expect(quoteIdent("col", "sqlite")).toBe('"col"');
    expect(quoteIdent("col", "mysql")).toBe("`col`");
    expect(quoteIdent("col", "sqlserver")).toBe("[col]");
    expect(quoteIdent('we"ird', "postgres")).toBe('"we""ird"');
    expect(quoteIdent("ev]il", "sqlserver")).toBe("[ev]]il]");
  });
});

describe("buildForeignKeyLookup", () => {
  it("builds a parameterized single-column lookup", () => {
    const fk: ForeignKey = {
      columns: ["customer_id"],
      referencesTable: "customers",
      referencesColumns: ["id"],
    };
    const { sql, params } = buildForeignKeyLookup(fk, [42], "postgres");
    expect(sql).toBe('SELECT * FROM "customers" WHERE "id" = :fk0');
    expect(params).toEqual([{ key: { kind: "name", name: "fk0" }, value: 42 }]);
  });

  it("schema-qualifies and supports composite keys", () => {
    const fk: ForeignKey = {
      columns: ["org_id", "user_id"],
      referencesSchema: "sales",
      referencesTable: "members",
      referencesColumns: ["org_id", "id"],
    };
    const { sql, params } = buildForeignKeyLookup(fk, [7, 9], "mysql");
    expect(sql).toBe(
      "SELECT * FROM `sales`.`members` WHERE `org_id` = :fk0 AND `id` = :fk1",
    );
    expect(params).toHaveLength(2);
    expect(params[1]).toEqual({ key: { kind: "name", name: "fk1" }, value: 9 });
  });
});
