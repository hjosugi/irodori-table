import { describe, expect, it } from "vitest";
import type { Completion } from "@codemirror/autocomplete";
import {
  buildSqlCompletionIndex,
  completeSqlLightweight,
} from "./completion";
import type {
  ColumnMetadata,
  DatabaseMetadata,
  DbObjectMetadata,
  ForeignKey,
} from "../generated/irodori-api";

function table(
  schema: string,
  name: string,
  columns: string[],
  options: {
    primaryKey?: string[];
    foreignKeys?: ForeignKey[];
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
  };
}

const metadata: DatabaseMetadata = {
  schemas: [
    {
      name: "public",
      objects: [
        table("public", "customers", ["id", "name", "email"], {
          primaryKey: ["id"],
        }),
        table("public", "orders", ["id", "customer_id", "total"], {
          primaryKey: ["id"],
          foreignKeys: [
            {
              columns: ["customer_id"],
              referencesTable: "customers",
              referencesColumns: ["id"],
            },
          ],
        }),
        {
          ...table("public", "normalize_email", ["email"]),
          kind: "function",
        },
      ],
    },
    {
      name: "sales",
      objects: [table("sales", "invoices", ["id", "customer_id", "status"])],
    },
  ],
};

function withCursor(sql: string): { doc: string; pos: number } {
  const pos = sql.indexOf("|");
  return pos >= 0 ? { doc: sql.replace("|", ""), pos } : { doc: sql, pos: sql.length };
}

function complete(sql: string, explicit = false): readonly Completion[] {
  return completeWithMetadata(sql, metadata, explicit);
}

function completeWithMetadata(
  sql: string,
  completionMetadata: DatabaseMetadata,
  explicit = false,
): readonly Completion[] {
  const cursor = withCursor(sql);
  return (
    completeSqlLightweight({
      doc: cursor.doc,
      engine: "postgres",
      explicit,
      index: buildSqlCompletionIndex(completionMetadata),
      pos: cursor.pos,
    })?.options ?? []
  );
}

function labels(sql: string, explicit = false): string[] {
  return complete(sql, explicit).map((option) => option.label);
}

function applies(sql: string, explicit = false): string[] {
  return complete(sql, explicit).map((option) => String(option.apply ?? option.label));
}

function appliesWithMetadata(sql: string, completionMetadata: DatabaseMetadata): string[] {
  return completeWithMetadata(sql, completionMetadata).map((option) =>
    String(option.apply ?? option.label),
  );
}

describe("completeSqlLightweight", () => {
  it("does not auto-open broad empty completions", () => {
    expect(labels("select ")).toEqual([]);
    expect(labels("select ", true)).toContain("customers");
  });

  it("suggests schema members after schema dot", () => {
    expect(labels("select * from sales.")).toEqual(["invoices"]);
    expect(applies("select * from sales.")).toEqual(["invoices"]);
  });

  it("keeps explicit empty relation completions deterministic", () => {
    expect(labels("select * from |", true)).toEqual([
      "customers",
      "invoices",
      "orders",
      "public",
      "sales",
    ]);
    expect(applies("select * from |", true)).toEqual([
      "customers",
      "sales.invoices",
      "orders",
      "public.",
      "sales.",
    ]);
  });

  it("qualifies duplicate relation insert text deterministically", () => {
    const duplicateMetadata: DatabaseMetadata = {
      schemas: [
        { name: "public", objects: [table("public", "customers", ["id"])] },
        { name: "sales", objects: [table("sales", "customers", ["id"])] },
      ],
    };

    expect(appliesWithMetadata("select * from cust", duplicateMetadata)).toEqual([
      "public.customers",
      "sales.customers",
    ]);
  });

  it("suggests columns after aliases without keywords or tables", () => {
    expect(labels("select c.| from customers c")).toEqual(["id", "name", "email"]);
  });

  it("qualifies unqualified columns when aliases are present", () => {
    expect(labels("select id from customers c join orders o on o.|")).toEqual([
      "id",
      "customer_id",
      "total",
    ]);
    expect(labels("select * from customers c join orders o where id")).toEqual([
      "c.id",
      "o.id",
    ]);
  });

  it("adds foreign-key join snippets in JOIN relation context", () => {
    const options = complete("select * from customers c join ord");
    const join = options.find(
      (option) => option.label === "orders" && String(option.apply).includes(" on "),
    );
    expect(join?.apply).toBe("orders o on o.customer_id = c.id");
  });

  it("falls back to cheap keyword completion without metadata matches", () => {
    expect(labels("sel")).toContain("select");
    expect(labels("select * from customers c where ema")).toContain("c.email");
  });

  it("suppresses completions inside strings and comments", () => {
    expect(labels("select 'ema")).toEqual([]);
    expect(labels("select 1 -- ema")).toEqual([]);
  });
});
