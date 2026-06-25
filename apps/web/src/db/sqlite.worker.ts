import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { deleteDatabaseBytes, loadDatabaseBytes, saveDatabaseBytes } from "./local-store";
import { emptyQueryResult, resultFromSqlJsExec } from "./result";
import type { LocalWorkerRequest, LocalWorkerResponse } from "./worker-protocol";

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let activeDatabaseId = "";

async function ensureSql(): Promise<SqlJsStatic> {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: () => wasmUrl,
    });
  }
  return SQL;
}

function activeDb(): Database {
  if (!db) {
    throw new Error("SQLite database is not initialized");
  }
  return db;
}

async function persist(): Promise<void> {
  if (!activeDatabaseId || !db) {
    return;
  }
  saveDatabaseBytes(activeDatabaseId, db.export());
}

async function initialize(databaseId: string, seedSql?: string) {
  const sql = await ensureSql();
  const stored = await loadDatabaseBytes(databaseId);
  activeDatabaseId = databaseId;
  db = stored ? new sql.Database(stored) : new sql.Database();
  if (!stored && seedSql?.trim()) {
    db.exec(seedSql);
    await persist();
  }
  return emptyQueryResult(stored ? "SQLite database loaded" : "SQLite database created");
}

async function reset(seedSql?: string) {
  activeDb().close();
  const sql = await ensureSql();
  db = new sql.Database();
  if (seedSql?.trim()) {
    db.exec(seedSql);
  }
  await persist();
  return emptyQueryResult("SQLite database reset");
}

async function importBytes(bytes: Uint8Array) {
  activeDb().close();
  const sql = await ensureSql();
  db = new sql.Database(bytes);
  await persist();
  return emptyQueryResult("SQLite database imported");
}

async function runQuery(sql: string, maxRows: number) {
  const start = performance.now();
  const database = activeDb();
  const execResults = database.exec(sql);
  const elapsedMs = performance.now() - start;
  const result = resultFromSqlJsExec(
    execResults,
    maxRows,
    database.getRowsModified(),
    elapsedMs,
  );
  await persist();
  return result;
}

async function deleteActiveDatabase() {
  activeDb().close();
  db = null;
  if (activeDatabaseId) {
    await deleteDatabaseBytes(activeDatabaseId);
  }
  return emptyQueryResult("SQLite database deleted");
}

async function handle(request: LocalWorkerRequest): Promise<LocalWorkerResponse> {
  try {
    switch (request.type) {
      case "init":
        return { id: request.id, ok: true, data: await initialize(request.databaseId, request.seedSql) };
      case "query":
        return { id: request.id, ok: true, data: await runQuery(request.sql, request.maxRows) };
      case "export":
        return { id: request.id, ok: true, data: { bytes: activeDb().export() } };
      case "import":
        return { id: request.id, ok: true, data: await importBytes(request.bytes) };
      case "reset":
        return { id: request.id, ok: true, data: await reset(request.seedSql) };
      case "delete":
        return { id: request.id, ok: true, data: await deleteActiveDatabase() };
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
