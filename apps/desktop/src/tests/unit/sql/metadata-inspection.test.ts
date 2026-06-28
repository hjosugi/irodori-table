import { describe, expect, it } from "vitest";
import type {
  ColumnMetadata,
  DatabaseMetadata,
  DbObjectMetadata,
  ForeignKey,
  IndexMetadata,
} from "@/generated/irodori-api";
import {
  inspectSqlMetadataAt,
  sqlColumnDefinitionPreview,
  sqlColumnSampleValues,
  sqlMetadataTargetTitle,
  sqlObjectColumnDefinitionRows,
  sqlObjectDefinitionPreview,
} from "@/sql/metadata-inspection";

function table(
  schema: string,
  name: string,
  columns: string[],
  options: {
    primaryKey?: string[];
    foreignKeys?: ForeignKey[];
    indexes?: IndexMetadata[];
    columnMeta?: Partial<Record<string, Partial<ColumnMetadata>>>;
    sample?: DbObjectMetadata["sample"];
  } = {},
): DbObjectMetadata {
  return {
    schema,
    name,
    kind: "table",
    columns: columns.map<ColumnMetadata>((column, index) => ({
      name: column,
      dataType: column.endsWith("_id") || column === "id" ? "int4" : "text",
      nullable: !options.primaryKey?.includes(column),
      ordinal: index + 1,
      ...options.columnMeta?.[column],
    })),
    indexes: options.indexes ?? [],
    primaryKey: options.primaryKey ?? [],
    foreignKeys: options.foreignKeys ?? [],
    sample: options.sample,
  };
}

const customers = table("public", "customers", ["id", "name", "email"], {
  primaryKey: ["id"],
  sample: {
    columns: ["id", "name", "email"],
    rows: [["1", "Ada", "ada@example.test"]],
    truncated: false,
  },
});

const orders = table("public", "orders", ["id", "customer_id", "total"], {
  primaryKey: ["id"],
  indexes: [
    {
      name: "idx_orders_customer_id",
      columns: ["customer_id"],
      unique: false,
    },
  ],
  foreignKeys: [
    {
      columns: ["customer_id"],
      referencesTable: "customers",
      referencesColumns: ["id"],
    },
  ],
});

const metadata: DatabaseMetadata = {
  schemas: [
    {
      name: "public",
      objects: [customers, orders],
    },
  ],
};

function atMarker(sql: string) {
  const pos = sql.indexOf("|");
  return { doc: sql.replace("|", ""), pos };
}

function inspect(sql: string) {
  const { doc, pos } = atMarker(sql);
  return inspectSqlMetadataAt(doc, pos, metadata);
}

describe("inspectSqlMetadataAt", () => {
  it("resolves table identifiers to object metadata", () => {
    const target = inspect("select * from cust|omers");

    expect(target?.kind).toBe("object");
    expect(target ? sqlMetadataTargetTitle(target) : "").toBe(
      "public.customers",
    );
  });

  it("resolves alias-qualified columns", () => {
    const target = inspect("select c.na|me from customers c");

    expect(target?.kind).toBe("column");
    if (target?.kind === "column") {
      expect(target.object.name).toBe("customers");
      expect(target.column.name).toBe("name");
      expect(sqlColumnDefinitionPreview(target.object, target.column)).toBe(
        "name text",
      );
      expect(sqlColumnSampleValues(target.object, target.column)).toEqual([
        "Ada",
      ]);
    }
  });

  it("resolves unqualified columns from the statement relation", () => {
    const target = inspect("select ema|il from customers");

    expect(target?.kind).toBe("column");
    if (target?.kind === "column") {
      expect(target.object.name).toBe("customers");
      expect(target.column.name).toBe("email");
    }
  });

  it("resolves schema-qualified tables", () => {
    const target = inspect("select * from public.ord|ers");

    expect(target?.kind).toBe("object");
    expect(target ? sqlMetadataTargetTitle(target) : "").toBe("public.orders");
  });

  it("builds a definition preview when DDL is unavailable", () => {
    expect(sqlObjectDefinitionPreview(customers)).toContain(
      "create table public.customers",
    );
    expect(sqlObjectDefinitionPreview(customers)).toContain("primary key (id)");
    expect(sqlObjectDefinitionPreview(orders)).toContain(
      "foreign key (customer_id) references public.customers(id)",
    );
  });

  it("builds table column definition rows with keys and references", () => {
    expect(sqlObjectColumnDefinitionRows(orders)).toContain(
      "id int4 not null primary key",
    );
    expect(sqlObjectColumnDefinitionRows(orders)).toContain(
      "customer_id int4 references public.customers(id)",
    );
  });

  it("builds a complete column definition preview for hover cards", () => {
    const customerId = orders.columns.find(
      (column) => column.name === "customer_id",
    );
    expect(customerId).toBeTruthy();
    expect(sqlColumnDefinitionPreview(orders, customerId!)).toBe(
      "customer_id int4 references public.customers(id)",
    );
  });
});
