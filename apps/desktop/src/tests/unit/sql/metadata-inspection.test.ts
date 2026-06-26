import { describe, expect, it } from "vitest";
import type {
  ColumnMetadata,
  DatabaseMetadata,
  DbObjectMetadata,
  ForeignKey,
} from "@/generated/irodori-api";
import {
  inspectSqlMetadataAt,
  sqlColumnSampleValues,
  sqlMetadataTargetTitle,
  sqlObjectDefinitionPreview,
} from "@/sql/metadata-inspection";

function table(
  schema: string,
  name: string,
  columns: string[],
  options: {
    primaryKey?: string[];
    foreignKeys?: ForeignKey[];
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
    })),
    indexes: [],
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
    expect(target ? sqlMetadataTargetTitle(target) : "").toBe("public.customers");
  });

  it("resolves alias-qualified columns", () => {
    const target = inspect("select c.na|me from customers c");

    expect(target?.kind).toBe("column");
    if (target?.kind === "column") {
      expect(target.object.name).toBe("customers");
      expect(target.column.name).toBe("name");
      expect(sqlColumnSampleValues(target.object, target.column)).toEqual(["Ada"]);
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
  });
});
