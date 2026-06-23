import { describe, expect, it } from "vitest";
import {
  MSSQL,
  MariaSQL,
  MySQL,
  PLSQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  type SQLDialect,
} from "@codemirror/lang-sql";
import {
  buildSqlConfig,
  cmDialect,
  formatterLanguage,
  metadataToNamespace,
} from "./dialect";
import type { DatabaseMetadata, DbEngine } from "../generated/irodori-api";

describe("cmDialect", () => {
  const engineExpectations: Record<
    DbEngine,
    { dialect: SQLDialect; formatter: string }
  > = {
    postgres: { dialect: PostgreSQL, formatter: "postgresql" },
    mysql: { dialect: MySQL, formatter: "mysql" },
    sqlite: { dialect: SQLite, formatter: "sqlite" },
    oracle: { dialect: PLSQL, formatter: "plsql" },
    sqlserver: { dialect: MSSQL, formatter: "transactsql" },
    duckdb: { dialect: PostgreSQL, formatter: "duckdb" },
    mongodb: { dialect: StandardSQL, formatter: "sql" },
    cockroachdb: { dialect: PostgreSQL, formatter: "postgresql" },
    yugabytedb: { dialect: PostgreSQL, formatter: "postgresql" },
    redshift: { dialect: PostgreSQL, formatter: "redshift" },
    timescaledb: { dialect: PostgreSQL, formatter: "postgresql" },
    mariadb: { dialect: MariaSQL, formatter: "mariadb" },
    tidb: { dialect: MySQL, formatter: "tidb" },
    neon: { dialect: PostgreSQL, formatter: "postgresql" },
    h2: { dialect: PostgreSQL, formatter: "postgresql" },
    clickhouse: { dialect: StandardSQL, formatter: "clickhouse" },
    neo4j: { dialect: StandardSQL, formatter: "sql" },
    memgraph: { dialect: StandardSQL, formatter: "sql" },
    influxdb: { dialect: StandardSQL, formatter: "sql" },
    qdrant: { dialect: StandardSQL, formatter: "sql" },
    milvus: { dialect: StandardSQL, formatter: "sql" },
    pinecone: { dialect: StandardSQL, formatter: "sql" },
  };

  it("maps every engine to the expected CodeMirror SQL dialect", () => {
    for (const [engine, expected] of Object.entries(engineExpectations) as Array<
      [DbEngine, (typeof engineExpectations)[DbEngine]]
    >) {
      expect(cmDialect(engine), engine).toBe(expected.dialect);
    }
  });

  it("maps every engine to the expected sql-formatter language", () => {
    for (const [engine, expected] of Object.entries(engineExpectations) as Array<
      [DbEngine, (typeof engineExpectations)[DbEngine]]
    >) {
      expect(formatterLanguage(engine), engine).toBe(expected.formatter);
    }
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
