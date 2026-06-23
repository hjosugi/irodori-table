import { describe, expect, it } from "vitest";
import {
  MSSQL,
  MariaSQL,
  MySQL,
  PLSQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
} from "@codemirror/lang-sql";
import {
  buildSqlConfig,
  cmDialect,
  formatterLanguage,
  metadataToNamespace,
} from "./dialect";
import type { DatabaseMetadata } from "../generated/irodori-api";

describe("cmDialect", () => {
  it("routes all Postgres-wire engines to PostgreSQL", () => {
    for (const engine of [
      "postgres",
      "cockroachdb",
      "yugabytedb",
      "redshift",
      "timescaledb",
      "neon",
      "h2",
      "duckdb",
    ] as const) {
      expect(cmDialect(engine)).toBe(PostgreSQL);
    }
  });
  it("routes MySQL-wire engines, with MariaDB on its own dialect", () => {
    expect(cmDialect("mysql")).toBe(MySQL);
    expect(cmDialect("tidb")).toBe(MySQL);
    expect(cmDialect("mariadb")).toBe(MariaSQL);
  });
  it("maps sqlite / sqlserver / oracle", () => {
    expect(cmDialect("sqlite")).toBe(SQLite);
    expect(cmDialect("sqlserver")).toBe(MSSQL);
    expect(cmDialect("oracle")).toBe(PLSQL);
  });
  it("falls back to StandardSQL for non-SQL engines", () => {
    expect(cmDialect("mongodb")).toBe(StandardSQL);
    expect(cmDialect("neo4j")).toBe(StandardSQL);
  });
});

describe("formatterLanguage", () => {
  it("maps engines onto sql-formatter languages", () => {
    expect(formatterLanguage("postgres")).toBe("postgresql");
    expect(formatterLanguage("sqlserver")).toBe("transactsql");
    expect(formatterLanguage("oracle")).toBe("plsql");
    expect(formatterLanguage("mariadb")).toBe("mariadb");
    expect(formatterLanguage("redshift")).toBe("redshift");
    expect(formatterLanguage("duckdb")).toBe("duckdb");
    expect(formatterLanguage("mongodb")).toBe("sql");
  });
});

const meta: DatabaseMetadata = {
  schemas: [
    {
      name: "public",
      objects: [
        {
          schema: "public",
          name: "users",
          kind: "table",
          columns: [
            { name: "id", dataType: "int4", nullable: false, ordinal: 1 },
            { name: "email", dataType: "text", nullable: true, ordinal: 2 },
          ],
          indexes: [],
          primaryKey: ["id"],
          foreignKeys: [],
        },
        {
          schema: "public",
          name: "v_active",
          kind: "view",
          columns: [{ name: "id", dataType: "int4", nullable: false, ordinal: 1 }],
          indexes: [],
          primaryKey: [],
          foreignKeys: [],
        },
        {
          schema: "public",
          name: "users_pkey",
          kind: "index",
          columns: [],
          indexes: [],
          primaryKey: [],
          foreignKeys: [],
        },
      ],
    },
  ],
};

describe("metadataToNamespace", () => {
  it("returns undefined for empty metadata", () => {
    expect(metadataToNamespace(undefined)).toBeUndefined();
    expect(metadataToNamespace({ schemas: [] })).toBeUndefined();
  });
  it("builds schema -> table -> columns and skips indexes", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ns = metadataToNamespace(meta) as Record<string, any>;
    expect(Object.keys(ns)).toEqual(["public"]);
    expect(Object.keys(ns.public).sort()).toEqual(["users", "v_active"]);
    expect(ns.public.users.self.label).toBe("users");
    expect(ns.public.users.children.map((c: { label: string }) => c.label)).toEqual([
      "id",
      "email",
    ]);
    expect(ns.public.users.children[0].detail).toContain("not null");
    expect(ns.public.users.children[1].detail).toBe("text");
  });
});

describe("buildSqlConfig", () => {
  it("always sets the dialect and adds schema only when metadata exists", () => {
    const withMeta = buildSqlConfig("postgres", meta);
    expect(withMeta.dialect).toBe(PostgreSQL);
    expect(withMeta.schema).toBeDefined();
    expect(withMeta.defaultSchema).toBe("public");

    const without = buildSqlConfig("mysql", undefined);
    expect(without.dialect).toBe(MySQL);
    expect(without.schema).toBeUndefined();
  });
});
