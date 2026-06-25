import * as duckdb from "@duckdb/duckdb-wasm";
import { emptyQueryResult, normalizeCell } from "./result";
import type { JsonCell, QueryResult } from "../types";
import type { LocalWorkerRequest, LocalWorkerResponse } from "./worker-protocol";

const bundles: duckdb.DuckDBBundles = {
  mvp: {
    mainModule: new URL(
      "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm",
      import.meta.url,
    ).toString(),
    mainWorker: new URL(
      "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js",
      import.meta.url,
    ).toString(),
  },
  eh: {
    mainModule: new URL(
      "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm",
      import.meta.url,
    ).toString(),
    mainWorker: new URL(
      "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js",
      import.meta.url,
    ).toString(),
  },
};

let database: duckdb.AsyncDuckDB | null = null;
let connection: duckdb.AsyncDuckDBConnection | null = null;

async function ensureDuckDb() {
  if (database && connection) {
    return connection;
  }
  const bundle = await duckdb.selectBundle(bundles);
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  database = new duckdb.AsyncDuckDB(logger, worker);
  await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
  connection = await database.connect();
  return connection;
}

function rowValue(row: unknown, column: string): JsonCell {
  if (row && typeof row === "object") {
    if (column in row) {
      return normalizeCell((row as Record<string, unknown>)[column]);
    }
    const json = "toJSON" in row ? (row as { toJSON: () => unknown }).toJSON() : null;
    if (json && typeof json === "object" && column in json) {
      return normalizeCell((json as Record<string, unknown>)[column]);
    }
  }
  return normalizeCell(null);
}

function tableToResult(table: unknown, maxRows: number, elapsedMs: number): QueryResult {
  const arrowTable = table as {
    schema?: { fields?: Array<{ name: string }> };
    numRows?: number;
    toArray?: () => unknown[];
  };
  const columns = arrowTable.schema?.fields?.map((field) => field.name) ?? [];
  const rawRows = arrowTable.toArray?.() ?? [];
  const rows = rawRows
    .slice(0, maxRows)
    .map((row) => columns.map((column) => rowValue(row, column)));
  const rowCount = Number(arrowTable.numRows ?? rawRows.length);
  return {
    columns,
    rows,
    rowCount,
    elapsedMs,
    truncated: rowCount > rows.length,
  };
}

async function initialize(seedSql?: string) {
  const conn = await ensureDuckDb();
  if (seedSql?.trim()) {
    await conn.query(seedSql);
  }
  return emptyQueryResult("DuckDB WASM ready");
}

async function runQuery(sql: string, maxRows: number) {
  const conn = await ensureDuckDb();
  const start = performance.now();
  const table = await conn.query(sql);
  return tableToResult(table, maxRows, performance.now() - start);
}

async function reset(seedSql?: string) {
  if (connection) {
    await connection.close();
  }
  if (database) {
    await database.terminate();
  }
  database = null;
  connection = null;
  return initialize(seedSql);
}

async function handle(request: LocalWorkerRequest): Promise<LocalWorkerResponse> {
  try {
    switch (request.type) {
      case "init":
        return { id: request.id, ok: true, data: await initialize(request.seedSql) };
      case "query":
        return { id: request.id, ok: true, data: await runQuery(request.sql, request.maxRows) };
      case "export":
        throw new Error("DuckDB export is not available in the web preview yet");
      case "import":
        throw new Error("DuckDB import is not available in the web preview yet");
      case "reset":
        return { id: request.id, ok: true, data: await reset(request.seedSql) };
      case "delete":
        return { id: request.id, ok: true, data: await reset() };
    }
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

self.onmessage = (event: MessageEvent<LocalWorkerRequest>) => {
  void handle(event.data).then((response) => {
    self.postMessage(response);
  });
};
