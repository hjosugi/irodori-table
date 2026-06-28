import { describe, expect, it } from "vitest";
import type { DbObjectMetadata } from "@/generated/irodori-api";
import {
  blankSchemaDraft,
  buildSchemaSql,
  schemaDraftFromObject,
  splitIdentifierList,
} from "@/features/schema-designer/schema-designer";

describe("schema designer SQL", () => {
  it("builds create table SQL with primary key, index, and foreign key", () => {
    const draft = blankSchemaDraft();
    draft.schema = "public";
    draft.table = "orders";
    draft.columns = [
      {
        id: "id",
        name: "id",
        dataType: "INTEGER",
        nullable: false,
        primaryKey: true,
        defaultValue: "",
      },
      {
        id: "customer",
        name: "customer_id",
        dataType: "INTEGER",
        nullable: false,
        primaryKey: false,
        defaultValue: "",
      },
    ];
    draft.indexes = [
      {
        id: "idx",
        name: "",
        columns: "customer_id",
        unique: false,
      },
    ];
    draft.foreignKeys = [
      {
        id: "fk",
        name: "",
        columns: "customer_id",
        referencesSchema: "public",
        referencesTable: "customers",
        referencesColumns: "id",
        onDelete: "CASCADE",
      },
    ];

    const sql = buildSchemaSql(draft);
    expect(sql).toContain('CREATE TABLE "public"."orders"');
    expect(sql).toContain('PRIMARY KEY ("id")');
    expect(sql).toContain(
      'CONSTRAINT "fk_orders_customer_id" FOREIGN KEY ("customer_id") REFERENCES "public"."customers" ("id") ON DELETE CASCADE',
    );
    expect(sql).toContain(
      'CREATE INDEX "idx_orders_customer_id" ON "public"."orders" ("customer_id");',
    );
  });

  it("builds alter SQL only for newly added items", () => {
    const object: DbObjectMetadata = {
      schema: "public",
      name: "customers",
      kind: "table",
      columns: [
        {
          name: "id",
          dataType: "INTEGER",
          nullable: false,
          ordinal: 1,
        },
      ],
      indexes: [],
      primaryKey: ["id"],
      foreignKeys: [],
    };
    const draft = schemaDraftFromObject(object);
    draft.columns.push({
      id: "new-email",
      name: "email",
      dataType: "TEXT",
      nullable: true,
      primaryKey: false,
      defaultValue: "",
    });
    draft.indexes.push({
      id: "idx-email",
      name: "idx_customers_email",
      columns: "email",
      unique: true,
    });

    const sql = buildSchemaSql(draft);
    expect(sql).toContain(
      'ALTER TABLE "public"."customers" ADD COLUMN "email" TEXT;',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "idx_customers_email" ON "public"."customers" ("email");',
    );
    expect(sql).not.toContain('ADD COLUMN "id"');
  });

  it("builds alter SQL for a new foreign key and escapes names", () => {
    const object: DbObjectMetadata = {
      schema: "public",
      name: "orders",
      kind: "table",
      columns: [
        {
          name: "id",
          dataType: "INTEGER",
          nullable: false,
          ordinal: 1,
        },
        {
          name: "customer_id",
          dataType: "INTEGER",
          nullable: false,
          ordinal: 2,
        },
      ],
      indexes: [],
      primaryKey: ["id"],
      foreignKeys: [],
    };
    const draft = schemaDraftFromObject(object);
    draft.foreignKeys.push({
      id: "fk-customer",
      name: 'fk "customer"',
      columns: "customer_id",
      referencesSchema: "public",
      referencesTable: "customers",
      referencesColumns: "id",
      onDelete: "SET NULL",
    });

    expect(buildSchemaSql(draft)).toBe(
      'ALTER TABLE "public"."orders" ADD CONSTRAINT "fk ""customer""" FOREIGN KEY ("customer_id") REFERENCES "public"."customers" ("id") ON DELETE SET NULL;\n',
    );
  });

  it("returns a placeholder when alter mode has no additions", () => {
    const draft = blankSchemaDraft();
    draft.mode = "alter";
    draft.columns = draft.columns.map((column) => ({
      ...column,
      existing: true,
    }));
    expect(buildSchemaSql(draft)).toBe(
      "-- Add a new column, index, or foreign key to generate ALTER SQL.\n",
    );
  });

  it("splits comma separated identifier lists", () => {
    expect(splitIdentifierList("a, b,, c ")).toEqual(["a", "b", "c"]);
  });
});
