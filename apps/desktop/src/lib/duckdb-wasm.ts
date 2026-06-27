import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbWasmEh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import duckdbWorkerEh from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import duckdbWasmMvp from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import duckdbWorkerMvp from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import type { Table } from "apache-arrow";
import type {
  ColumnMetadata,
  ConnectionInfo,
  ConnectionProfile,
  DatabaseMetadata,
  DbObjectMetadata,
  QueryResult,
} from "@/generated/irodori-api";

const duckDbBundles: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: duckdbWasmMvp,
    mainWorker: duckdbWorkerMvp,
  },
  eh: {
    mainModule: duckdbWasmEh,
    mainWorker: duckdbWorkerEh,
  },
};

type DuckDbWasmRuntime = {
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
  worker: Worker;
};

const runtimes = new Map<string, DuckDbWasmRuntime>();

export function canUseDuckDbWasm() {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

export function shouldUseDuckDbWasm(profile: Pick<ConnectionProfile, "engine"> | undefined) {
  return profile?.engine === "duckdb" && canUseDuckDbWasm();
}

export async function connectDuckDbWasm(
  profile: ConnectionProfile,
): Promise<ConnectionInfo> {
  if (!shouldUseDuckDbWasm(profile)) {
    throw new Error("DuckDB-WASM is not available in this browser.");
  }
  await disconnectDuckDbWasm(profile.id);

  const bundle = await duckdb.selectBundle(duckDbBundles);
  if (!bundle.mainWorker) {
    throw new Error("DuckDB-WASM worker bundle is unavailable.");
  }
  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await db.open({
    path: duckDbWasmPath(profile),
    filesystem: {
      allowFullHTTPReads: true,
    },
    opfs: {
      fileHandling: "auto",
    },
    query: {
      castTimestampToDate: true,
    },
    arrowLosslessConversion: true,
  });
  const conn = await db.connect();
  runtimes.set(profile.id, { db, conn, worker });

  if (shouldSeedDuckDbSample(profile)) {
    await seedDuckDbWasm(conn);
  }

  const version = await db.getVersion();
  return {
    id: profile.id,
    engine: "duckdb",
    serverVersion: `DuckDB-WASM ${version}`,
  };
}

export async function disconnectDuckDbWasm(connectionId: string) {
  const runtime = runtimes.get(connectionId);
  if (!runtime) {
    return;
  }
  runtimes.delete(connectionId);
  try {
    await runtime.conn.close();
  } finally {
    await runtime.db.terminate();
  }
}

export async function listDuckDbWasmObjects(
  connectionId: string,
): Promise<DatabaseMetadata> {
  const runtime = requireRuntime(connectionId);
  const objectRows = await queryRows(runtime.conn, `
    select table_schema, table_name, table_type
    from information_schema.tables
    where table_schema not in ('information_schema', 'pg_catalog')
    order by table_schema, table_name
  `);
  const columnRows = await queryRows(runtime.conn, `
    select table_schema, table_name, column_name, data_type,
           is_nullable, ordinal_position, column_default
    from information_schema.columns
    where table_schema not in ('information_schema', 'pg_catalog')
    order by table_schema, table_name, ordinal_position
  `);

  const schemas = new Map<string, Map<string, DbObjectMetadata>>();
  for (const row of objectRows) {
    const schema = String(row.TABLE_SCHEMA ?? row.table_schema ?? "main");
    const name = String(row.TABLE_NAME ?? row.table_name ?? "");
    if (!name) continue;
    const tableType = String(row.TABLE_TYPE ?? row.table_type ?? "");
    const kind = tableType.toLowerCase().includes("view") ? "view" : "table";
    getSchemaObjects(schemas, schema).set(name, {
      schema,
      name,
      kind,
      columns: [],
      indexes: [],
      primaryKey: [],
      foreignKeys: [],
    });
  }

  for (const row of columnRows) {
    const schema = String(row.TABLE_SCHEMA ?? row.table_schema ?? "main");
    const table = String(row.TABLE_NAME ?? row.table_name ?? "");
    const object = schemas.get(schema)?.get(table);
    if (!object) continue;
    object.columns.push({
      name: String(row.COLUMN_NAME ?? row.column_name ?? ""),
      dataType: String(row.DATA_TYPE ?? row.data_type ?? ""),
      nullable: String(row.IS_NULLABLE ?? row.is_nullable ?? "").toUpperCase() === "YES",
      ordinal: Number(row.ORDINAL_POSITION ?? row.ordinal_position ?? 0),
      defaultValue: optionalString(row.COLUMN_DEFAULT ?? row.column_default),
    });
  }

  return {
    schemas: Array.from(schemas, ([name, objects]) => ({
      name,
      objects: Array.from(objects.values()),
    })),
  };
}

export async function runDuckDbWasmQuery(
  connectionId: string,
  sql: string,
  maxRows = 10_000,
): Promise<QueryResult> {
  const runtime = requireRuntime(connectionId);
  const started = performance.now();
  const table = await runtime.conn.query(sql);
  const converted = arrowTableToRows(table, maxRows);
  return {
    columns: converted.columns,
    rows: converted.rows,
    rowCount: BigInt(table.numRows),
    elapsedMs: BigInt(Math.max(1, Math.round(performance.now() - started))),
    truncated: converted.truncated,
    message: converted.truncated ? `result capped at ${maxRows} rows` : undefined,
  };
}

async function queryRows(
  conn: duckdb.AsyncDuckDBConnection,
  sql: string,
): Promise<Array<Record<string, unknown>>> {
  const table = await conn.query(sql);
  const converted = arrowTableToRows(table, Number.MAX_SAFE_INTEGER);
  return converted.rows.map((row) =>
    Object.fromEntries(converted.columns.map((column, index) => [column, row[index]])),
  );
}

function arrowTableToRows(table: Table, maxRows: number) {
  const columns = table.schema.fields.map((field) => field.name);
  const vectors = columns.map((_, index) => table.getChildAt(index));
  const rowCount = Math.min(table.numRows, maxRows);
  const rows: unknown[][] = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    rows.push(vectors.map((vector) => normalizeDuckDbValue(vector?.get(rowIndex))));
  }
  return {
    columns,
    rows,
    truncated: table.numRows > maxRows,
  };
}

function normalizeDuckDbValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Uint8Array) {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  if (Array.isArray(value)) {
    return value.map(normalizeDuckDbValue);
  }
  if (value && typeof value === "object") {
    if ("toJSON" in value && typeof value.toJSON === "function") {
      return normalizeDuckDbValue(value.toJSON());
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeDuckDbValue(item)]),
    );
  }
  return value ?? null;
}

function duckDbWasmPath(profile: ConnectionProfile) {
  const requested = (profile.database ?? profile.url ?? "").trim();
  if (!requested || requested === ":memory:") {
    return ":memory:";
  }
  if (requested.startsWith("opfs://")) {
    return requested;
  }
  return `opfs://irodori/${safeDuckDbName(profile.id)}.duckdb`;
}

function shouldSeedDuckDbSample(profile: ConnectionProfile) {
  if (profile.id !== "duckdb-memory") {
    return false;
  }
  const requested = (profile.database ?? profile.url ?? "").trim();
  return !requested || requested === ":memory:";
}

async function seedDuckDbWasm(conn: duckdb.AsyncDuckDBConnection) {
  await conn.query(`
    create table if not exists countries (
      id integer primary key,
      iso_code varchar not null,
      name varchar not null
    );
    create table if not exists customers (
      id integer primary key,
      name varchar not null,
      country_id integer,
      lifetime_value bigint not null,
      last_order_at timestamp
    );
    create table if not exists orders (
      id integer primary key,
      customer_id integer not null,
      ordered_at timestamp not null,
      total bigint not null,
      status varchar not null
    );
    create or replace view customer_revenue as
    select c.id, c.name, coalesce(sum(o.total), 0) as total_revenue
    from customers c
    left join orders o on o.customer_id = c.id
    group by c.id, c.name;
  `);

  const existing = await conn.query("select count(*) as n from customers");
  const count = Number(arrowTableToRows(existing, 1).rows[0]?.[0] ?? 0);
  if (count > 0) {
    return;
  }

  await conn.query(`
    insert into countries values
      (1, 'JP', 'Japan'),
      (2, 'US', 'United States'),
      (3, 'NL', 'Netherlands');

    insert into customers values
      (233, 'Shiro Systems', 1, 4412200, timestamp '2026-06-18 16:15:00'),
      (447, 'Minato Labs', 1, 5128800, timestamp '2026-06-19 08:03:00'),
      (620, 'Higashi Market', 1, 4889100, timestamp '2026-06-18 19:27:00'),
      (917, 'Northwind Retail', 2, 7720100, timestamp '2026-06-20 11:12:00'),
      (1029, 'Kawase Foods', 1, 9841200, timestamp '2026-06-20 18:34:00'),
      (1104, 'Iris Trading', 3, 3824000, timestamp '2026-06-17 21:06:00'),
      (1441, 'Aster Works', 2, 6533000, timestamp '2026-06-19 23:41:00');

    insert into orders values
      (1, 1029, timestamp '2026-06-20 18:34:00', 9841200, 'paid'),
      (2, 917, timestamp '2026-06-20 11:12:00', 7720100, 'paid'),
      (3, 1441, timestamp '2026-06-19 23:41:00', 6533000, 'paid'),
      (4, 447, timestamp '2026-06-19 08:03:00', 5128800, 'processing'),
      (5, 620, timestamp '2026-06-18 19:27:00', 4889100, 'paid'),
      (6, 233, timestamp '2026-06-18 16:15:00', 4412200, 'paid'),
      (7, 1104, timestamp '2026-06-17 21:06:00', 3824000, 'refunded');
  `);
}

function getSchemaObjects(
  schemas: Map<string, Map<string, DbObjectMetadata>>,
  schema: string,
) {
  const existing = schemas.get(schema);
  if (existing) {
    return existing;
  }
  const created = new Map<string, DbObjectMetadata>();
  schemas.set(schema, created);
  return created;
}

function requireRuntime(connectionId: string) {
  const runtime = runtimes.get(connectionId);
  if (!runtime) {
    throw new Error(`DuckDB-WASM connection is not open: ${connectionId}`);
  }
  return runtime;
}

function optionalString(value: unknown): ColumnMetadata["defaultValue"] {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  return String(value);
}

function safeDuckDbName(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_") || "database";
}
