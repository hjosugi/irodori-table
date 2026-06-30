import { describe, expect, it } from "vitest";
import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import {
  buildCreateDatabaseSql,
  buildTableSpecDocument,
  ddlFromTableSpecDocument,
  exportTableSpecJson,
  exportTableSpecMarkdown,
  parseTableSpecDocument,
  tableSpecFormat,
  type TableSpecDocument,
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
    expect(document.schemas[0].tables.map((item) => item.name)).toEqual([
      "orders",
    ]);
    expect(document.schemas[0].tables[0].foreignKeys).toEqual([]);
  });
});

describe("forward-engineering a create-database script", () => {
  it("creates referenced tables before the tables that reference them", () => {
    const metadata: DatabaseMetadata = {
      schemas: [
        {
          name: "sales",
          objects: [
            // Declared before its dependency on purpose.
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

    const sql = buildCreateDatabaseSql(buildTableSpecDocument(metadata));

    expect(sql.indexOf('CREATE TABLE "sales"."customers"')).toBeLessThan(
      sql.indexOf('CREATE TABLE "sales"."orders"'),
    );
    expect(sql).toContain(
      'CONSTRAINT "fk_orders_customer_id" FOREIGN KEY ("customer_id") REFERENCES "sales"."customers" ("id")',
    );
    expect(sql).not.toContain("ALTER TABLE");
  });

  it("emits self-referential foreign keys as ALTER statements", () => {
    const metadata: DatabaseMetadata = {
      schemas: [
        {
          name: "hr",
          objects: [
            table(
              "hr",
              "employees",
              [
                ["id", "INTEGER", false],
                ["manager_id", "INTEGER", true],
              ],
              [
                {
                  columns: ["manager_id"],
                  referencesSchema: "hr",
                  referencesTable: "employees",
                  referencesColumns: ["id"],
                },
              ],
            ),
          ],
        },
      ],
    };

    const sql = buildCreateDatabaseSql(buildTableSpecDocument(metadata));

    expect(sql).toContain('CREATE TABLE "hr"."employees"');
    expect(sql).toContain(
      'ALTER TABLE "hr"."employees" ADD CONSTRAINT "fk_employees_manager_id" FOREIGN KEY ("manager_id") REFERENCES "hr"."employees" ("id");',
    );
    // The CREATE statement must not carry the self-reference inline.
    const createPart = sql.slice(0, sql.indexOf("ALTER TABLE"));
    expect(createPart).not.toContain("FOREIGN KEY");
    expect(sql.indexOf("CREATE TABLE")).toBeLessThan(
      sql.indexOf("ALTER TABLE"),
    );
  });

  it("breaks dependency cycles with a single deferred ALTER", () => {
    const metadata: DatabaseMetadata = {
      schemas: [
        {
          name: "app",
          objects: [
            table(
              "app",
              "a",
              [
                ["id", "INTEGER", false],
                ["b_id", "INTEGER", true],
              ],
              [
                {
                  columns: ["b_id"],
                  referencesSchema: "app",
                  referencesTable: "b",
                  referencesColumns: ["id"],
                },
              ],
            ),
            table(
              "app",
              "b",
              [
                ["id", "INTEGER", false],
                ["a_id", "INTEGER", true],
              ],
              [
                {
                  columns: ["a_id"],
                  referencesSchema: "app",
                  referencesTable: "a",
                  referencesColumns: ["id"],
                },
              ],
            ),
          ],
        },
      ],
    };

    const sql = buildCreateDatabaseSql(buildTableSpecDocument(metadata));

    expect(sql).toContain('CREATE TABLE "app"."a"');
    expect(sql).toContain('CREATE TABLE "app"."b"');
    // Exactly one back-edge is deferred so the rest of the script stays runnable.
    expect(sql.match(/ALTER TABLE/g)).toHaveLength(1);
    expect(sql).toContain(
      'CONSTRAINT "fk_b_a_id" FOREIGN KEY ("a_id") REFERENCES "app"."a" ("id")',
    );
    expect(sql).toContain(
      'ALTER TABLE "app"."a" ADD CONSTRAINT "fk_a_b_id" FOREIGN KEY ("b_id") REFERENCES "app"."b" ("id");',
    );
  });

  it("defers foreign keys to tables outside the document as ALTER statements", () => {
    const document: TableSpecDocument = {
      format: tableSpecFormat,
      exportedAt: "2026-06-30T00:00:00.000Z",
      schemas: [
        {
          name: "app",
          tables: [
            {
              name: "events",
              columns: [
                { name: "id", dataType: "INTEGER", nullable: false },
                { name: "actor_id", dataType: "INTEGER", nullable: true },
              ],
              primaryKey: ["id"],
              indexes: [],
              foreignKeys: [
                {
                  name: "fk_events_actor_id",
                  columns: ["actor_id"],
                  referencesTable: "external_users",
                  referencesColumns: ["id"],
                },
              ],
            },
          ],
        },
      ],
    };

    const sql = buildCreateDatabaseSql(document);

    expect(sql).toContain('CREATE TABLE "app"."events"');
    const createPart = sql.slice(0, sql.indexOf("ALTER TABLE"));
    expect(createPart).not.toContain("FOREIGN KEY");
    expect(sql).toContain(
      'ADD CONSTRAINT "fk_events_actor_id" FOREIGN KEY ("actor_id") REFERENCES "external_users" ("id");',
    );
  });

  it("is deterministic and matches the ddlFromTableSpecDocument alias", () => {
    const document = buildTableSpecDocument({
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
    });

    expect(buildCreateDatabaseSql(document)).toBe(
      buildCreateDatabaseSql(document),
    );
    expect(ddlFromTableSpecDocument(document)).toBe(
      buildCreateDatabaseSql(document),
    );
  });
});
