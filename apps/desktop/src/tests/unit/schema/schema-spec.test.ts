import { describe, expect, it } from "vitest";
import type { DatabaseMetadata, DbObjectMetadata } from "@/generated/irodori-api";
import {
  buildTableSpecDocument,
  ddlFromTableSpecDocument,
  exportTableSpecJson,
  exportTableSpecMarkdown,
  parseTableSpecDocument,
  tableSpecFormat,
} from "@/features/schema-designer";

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
    comment: `${name} table`,
    columns: columns.map(([column, dataType, nullable], index) => ({
      name: column,
      dataType,
      nullable: nullable ?? column !== "id",
      ordinal: index + 1,
    })),
    indexes: [
      {
        name: `idx_${name}_lookup`,
        columns: columns.length > 1 ? [columns[1][0]] : ["id"],
        unique: false,
      },
    ],
    primaryKey: ["id"],
    foreignKeys,
  };
}

describe("table specification documents", () => {
  const metadata: DatabaseMetadata = {
    schemas: [
      {
        name: "sales",
        objects: [
          table("sales", "customers", [
            ["id", "INTEGER", false],
            ["name", "TEXT", false],
          ]),
          table(
            "sales",
            "orders",
            [
              ["id", "INTEGER", false],
              ["customer_id", "INTEGER", false],
              ["total", "NUMERIC(12,2)", false],
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
        ],
      },
    ],
  };

  it("exports a clean-room JSON and Markdown table definition spec", () => {
    const document = buildTableSpecDocument(metadata, {
      connectionId: "local/main",
      connectionName: "Local Main",
      now: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(document.format).toBe(tableSpecFormat);
    expect(document.schemas[0].tables).toHaveLength(2);
    expect(document.schemas[0].tables[1].foreignKeys[0]).toMatchObject({
      columns: ["customer_id"],
      referencesSchema: "sales",
      referencesTable: "customers",
      referencesColumns: ["id"],
    });

    const json = exportTableSpecJson(document);
    expect(json.extension).toBe("irodori-schema.json");
    expect(parseTableSpecDocument(json.content)).toEqual(document);

    const markdown = exportTableSpecMarkdown(document).content;
    expect(markdown).toContain("# Table Definition Specification");
    expect(markdown).toContain("| sales | orders | 3 | id | 1 |");
    expect(markdown).toContain("customer_id -> sales.customers (id)");
  });

  it("generates reviewable DDL from a JSON table specification", () => {
    const document = parseTableSpecDocument(
      exportTableSpecJson(buildTableSpecDocument(metadata)).content,
    );

    const ddl = ddlFromTableSpecDocument(document);

    expect(ddl).toContain('CREATE TABLE "sales"."customers"');
    expect(ddl).toContain('"name" TEXT NOT NULL');
    expect(ddl).toContain('CREATE TABLE "sales"."orders"');
    expect(ddl).toContain('PRIMARY KEY ("id")');
    expect(ddl).toContain(
      'CONSTRAINT "fk_orders_customer_id" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers" ("id")',
    );
    expect(ddl).toContain(
      'CREATE INDEX "idx_orders_lookup" ON "sales"."orders" ("customer_id");',
    );
  });

  it("exports the currently filtered diagram scope", () => {
    const document = buildTableSpecDocument(metadata, { search: "total" });

    expect(document.source?.filtered).toBe(true);
    expect(document.schemas[0].tables.map((item) => item.name)).toEqual(["orders"]);
    expect(document.schemas[0].tables[0].foreignKeys).toEqual([]);
  });
});
