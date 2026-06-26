import { describe, expect, it } from "vitest";
import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import { deriveResultEditTarget } from "@/result-edit-target";

function table(overrides: Partial<DbObjectMetadata>): DbObjectMetadata {
  return {
    schema: "public",
    name: "orders",
    kind: "table",
    columns: [
      { name: "id", dataType: "integer", nullable: false, ordinal: 1 },
      { name: "customer_id", dataType: "integer", nullable: false, ordinal: 2 },
      { name: "total", dataType: "numeric", nullable: false, ordinal: 3 },
      { name: "email", dataType: "text", nullable: false, ordinal: 4 },
    ],
    indexes: [],
    primaryKey: ["id"],
    foreignKeys: [],
    ...overrides,
  };
}

function metadata(objects: DbObjectMetadata[] = [table({})]): DatabaseMetadata {
  return { schemas: [{ name: "public", objects }] };
}

describe("deriveResultEditTarget", () => {
  it("returns a primary-key edit target for a direct single-table select", () => {
    expect(
      deriveResultEditTarget({
        sql: "select id, total from public.orders",
        metadata: metadata(),
        resultColumns: ["id", "total"],
      }),
    ).toEqual({ schema: "public", table: "orders", keyColumns: ["id"] });
  });

  it("uses a unique index when no primary key exists", () => {
    expect(
      deriveResultEditTarget({
        sql: "select email, total from orders",
        metadata: metadata([
          table({
            primaryKey: [],
            indexes: [
              { name: "orders_email_key", columns: ["email"], unique: true },
            ],
          }),
        ]),
        resultColumns: ["email", "total"],
      }),
    ).toEqual({ table: "orders", keyColumns: ["email"] });
  });

  it("accepts qualified direct projections and aliases", () => {
    expect(
      deriveResultEditTarget({
        sql: 'select o.id, o.total from "public"."orders" o where o.id = 1',
        metadata: metadata(),
        resultColumns: ["id", "total"],
      }),
    ).toEqual({ schema: "public", table: "orders", keyColumns: ["id"] });
  });

  it("returns null for joins", () => {
    expect(
      deriveResultEditTarget({
        sql: "select orders.id, customers.email from orders join customers on customers.id = orders.customer_id",
        metadata: metadata(),
        resultColumns: ["id", "email"],
      }),
    ).toBeNull();
  });

  it("returns null when metadata is missing", () => {
    expect(
      deriveResultEditTarget({
        sql: "select id, total from orders",
        metadata: null,
        resultColumns: ["id", "total"],
      }),
    ).toBeNull();
  });

  it("returns null when key columns are not present in the result", () => {
    expect(
      deriveResultEditTarget({
        sql: "select total from orders",
        metadata: metadata(),
        resultColumns: ["total"],
      }),
    ).toBeNull();
  });

  it("uses a present unique index when another key is unavailable", () => {
    expect(
      deriveResultEditTarget({
        sql: "select email, total from orders",
        metadata: metadata([
          table({
            indexes: [
              {
                name: "orders_customer_total_key",
                columns: ["customer_id", "total"],
                unique: true,
              },
              { name: "orders_email_key", columns: ["email"], unique: true },
            ],
          }),
        ]),
        resultColumns: ["email", "total"],
      }),
    ).toEqual({ table: "orders", keyColumns: ["email"] });
  });

  it("returns null when the table has no primary key or unique index", () => {
    expect(
      deriveResultEditTarget({
        sql: "select id, total from orders",
        metadata: metadata([table({ primaryKey: [], indexes: [] })]),
        resultColumns: ["id", "total"],
      }),
    ).toBeNull();
  });

  it("returns null for computed result projections", () => {
    expect(
      deriveResultEditTarget({
        sql: "select id, total * 2 from orders",
        metadata: metadata(),
        resultColumns: ["id", "double_total"],
      }),
    ).toBeNull();
  });

  it("returns null for ambiguous duplicate result columns", () => {
    expect(
      deriveResultEditTarget({
        sql: "select id, id from orders",
        metadata: metadata(),
        resultColumns: ["id", "id"],
      }),
    ).toBeNull();
  });

  it("returns null for subquery sources", () => {
    expect(
      deriveResultEditTarget({
        sql: "select id from (select id from orders) nested",
        metadata: metadata(),
        resultColumns: ["id"],
      }),
    ).toBeNull();
  });
});
