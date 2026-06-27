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
} from "@/sql/dialect";
import { buildSqlCompletionIndex, completeSqlLightweight } from "@/sql/completion";
import type {
  ColumnMetadata,
  DatabaseMetadata,
  DbEngine,
  DbObjectMetadata,
} from "@/generated/irodori-api";

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
    motherduck: { dialect: PostgreSQL, formatter: "duckdb" },
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
    snowflake: { dialect: StandardSQL, formatter: "snowflake" },
    bigquery: { dialect: StandardSQL, formatter: "bigquery" },
    athena: { dialect: StandardSQL, formatter: "sql" },
    redis: { dialect: StandardSQL, formatter: "sql" },
    cassandra: { dialect: StandardSQL, formatter: "sql" },
    bigtable: { dialect: StandardSQL, formatter: "sql" },
    trinoPresto: { dialect: StandardSQL, formatter: "sql" },
    firebird: { dialect: StandardSQL, formatter: "sql" },
    databricks: { dialect: StandardSQL, formatter: "sql" },
    elasticsearch: { dialect: StandardSQL, formatter: "sql" },
    openSearch: { dialect: StandardSQL, formatter: "sql" },
    couchbase: { dialect: StandardSQL, formatter: "sql" },
    dynamodb: { dialect: StandardSQL, formatter: "sql" },
    scylladb: { dialect: StandardSQL, formatter: "sql" },
    arangodb: { dialect: StandardSQL, formatter: "sql" },
    questdb: { dialect: PostgreSQL, formatter: "postgresql" },
    iotdb: { dialect: StandardSQL, formatter: "sql" },
    hive: { dialect: StandardSQL, formatter: "sql" },
    iceberg: { dialect: PostgreSQL, formatter: "duckdb" },
    s3Tables: { dialect: StandardSQL, formatter: "sql" },
    objectStore: { dialect: StandardSQL, formatter: "sql" },
    deltaLake: { dialect: StandardSQL, formatter: "sql" },
    hudi: { dialect: StandardSQL, formatter: "sql" },
    cloudSpanner: { dialect: StandardSQL, formatter: "sql" },
    kvStore: { dialect: StandardSQL, formatter: "sql" },
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
          name: "orders",
          kind: "table",
          columns: [
            { name: "id", dataType: "int4", nullable: false, ordinal: 1 },
            { name: "user_id", dataType: "int4", nullable: false, ordinal: 2 },
            { name: "total", dataType: "numeric", nullable: false, ordinal: 3 },
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
          name: "normalize_email",
          kind: "function",
          columns: [],
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
    {
      name: "sales",
      objects: [
        {
          schema: "sales",
          name: "invoices",
          kind: "table",
          columns: [
            { name: "id", dataType: "int4", nullable: false, ordinal: 1 },
            { name: "status", dataType: "text", nullable: false, ordinal: 2 },
          ],
          indexes: [],
          primaryKey: ["id"],
          foreignKeys: [],
        },
      ],
    },
  ],
};

function sqlWithCursor(sql: string): { doc: string; pos: number } {
  const pos = sql.indexOf("|");
  if (pos < 0) return { doc: sql, pos: sql.length };
  return { doc: sql.slice(0, pos) + sql.slice(pos + 1), pos };
}

function completionLabels(sql: string, metadata = meta, explicit = false): string[] {
  const { doc, pos } = sqlWithCursor(sql);
  return (
    completeSqlLightweight({
      doc,
      pos,
      engine: "postgres",
      explicit,
      index: buildSqlCompletionIndex(metadata),
    })?.options.map((option) => option.label) ?? []
  );
}

function completionApplies(sql: string, metadata = meta, explicit = false): string[] {
  const { doc, pos } = sqlWithCursor(sql);
  return (
    completeSqlLightweight({
      doc,
      pos,
      engine: "postgres",
      explicit,
      index: buildSqlCompletionIndex(metadata),
    })?.options.map((option) => String(option.apply ?? option.label)) ?? []
  );
}

function table(
  schema: string,
  name: string,
  columns: string[] = ["id"],
): DbObjectMetadata {
  return {
    schema,
    name,
    kind: "table",
    columns: columns.map<ColumnMetadata>((column, index) => ({
      name: column,
      dataType: "text",
      nullable: true,
      ordinal: index + 1,
    })),
    indexes: [],
    primaryKey: [],
    foreignKeys: [],
  };
}

describe("completeSqlLightweight", () => {
  it("returns no metadata completions for empty metadata", () => {
    expect(
      completeSqlLightweight({
        doc: "select * from u",
        engine: "postgres",
        index: buildSqlCompletionIndex(undefined),
      }),
    ).toBeNull();
    expect(
      completeSqlLightweight({
        doc: "select * from u",
        engine: "postgres",
        index: buildSqlCompletionIndex({ schemas: [] }),
      }),
    ).toBeNull();
  });

  it("suggests only relations and schemas in FROM/JOIN positions", () => {
    const labels = completionLabels("select * from us");
    expect(labels).toEqual(["users"]);
    expect(labels).not.toContain("email");
    expect(labels).not.toContain("users_pkey");
    expect(labels).not.toContain("normalize_email");
  });

  it("completes schema-qualified relation names", () => {
    expect(completionLabels("select * from sales.")).toEqual(["invoices"]);
    expect(completionApplies("select * from sales.")).toEqual(["invoices"]);
  });

  it("completes columns from a table alias after a dot", () => {
    expect(completionLabels("select * from users u where u.")).toEqual([
      "id",
      "email",
    ]);
  });

  it("uses the current statement only for unqualified columns", () => {
    expect(
      completionLabels("select * from users; select * from orders o where em"),
    ).not.toContain("email");
    expect(
      completionLabels("select * from users; select * from orders o where to"),
    ).toEqual(["o.total"]);
  });

  it("qualifies column labels when more than one relation is in scope", () => {
    expect(
      completionLabels("select * from users u join orders o on o.user_id = u.id where id"),
    ).toEqual(expect.arrayContaining(["u.id", "o.id"]));
  });

  it("suggests routines only when no relation is in scope", () => {
    expect(completionLabels("select norm")).toEqual(["normalize_email"]);
  });

  it("caps metadata candidates after applying the typed prefix", () => {
    const manyTables: DatabaseMetadata = {
      schemas: [
        {
          name: "public",
          objects: Array.from({ length: 80 }, (_, index) =>
            table("public", `table_${String(index).padStart(2, "0")}`),
          ),
        },
      ],
    };

    expect(completionLabels("select * from ", manyTables, true)).toHaveLength(50);
    expect(completionLabels("select * from table_7", manyTables)).toEqual([
      "table_70",
      "table_71",
      "table_72",
      "table_73",
      "table_74",
      "table_75",
      "table_76",
      "table_77",
      "table_78",
      "table_79",
    ]);
  });
});

describe("buildSqlConfig", () => {
  it("sets the dialect without binding broad schema completion", () => {
    const withMeta = buildSqlConfig("postgres", meta);
    expect(withMeta.dialect).toBe(PostgreSQL);
    expect(withMeta.schema).toBeUndefined();
    expect(withMeta.defaultSchema).toBeUndefined();

    const without = buildSqlConfig("mysql", undefined);
    expect(without.dialect).toBe(MySQL);
    expect(without.schema).toBeUndefined();
  });
});
