import type { ConnectionProfile, LocalEngine, QueryResult, RuntimeStatus } from "../types";
import { duckDbSeedSql, sqliteSeedSql } from "./sample-data";
import type { LocalWorkerRequest, LocalWorkerResponse } from "./worker-protocol";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type WorkerHandle = {
  connectionId: string;
  databaseId: string;
  engine: LocalEngine;
  worker: Worker;
  pending: Map<number, PendingRequest>;
  sequence: number;
  busy: boolean;
  lastUsedAt: number;
};

function isLocalEngine(engine: ConnectionProfile["engine"]): engine is LocalEngine {
  return engine === "sqlite" || engine === "duckdb";
}

function createWorker(engine: LocalEngine) {
  if (engine === "duckdb") {
    return new Worker(new URL("./duckdb.worker.ts", import.meta.url), {
      type: "module",
    });
  }
  return new Worker(new URL("./sqlite.worker.ts", import.meta.url), {
    type: "module",
  });
}

function seedFor(engine: LocalEngine) {
  return engine === "duckdb" ? duckDbSeedSql : sqliteSeedSql;
}

export class LocalWorkerPool {
  private readonly handles = new Map<string, WorkerHandle>();

  constructor(private readonly maxWorkers = 4) {}

  async connect(profile: ConnectionProfile): Promise<void> {
    if (!isLocalEngine(profile.engine)) {
      throw new Error(`${profile.engine} is not supported as a local browser engine`);
    }
    const handle = this.ensureHandle(profile);
    await this.send(handle, {
      id: 0,
      type: "init",
      connectionId: profile.id,
      databaseId: handle.databaseId,
      engine: profile.engine,
      seedSql: seedFor(profile.engine),
    });
  }

  async runQuery(
    profile: ConnectionProfile,
    sql: string,
    maxRows: number,
  ): Promise<QueryResult> {
    if (!isLocalEngine(profile.engine)) {
      throw new Error(`${profile.engine} is not supported as a local browser engine`);
    }
    const handle = this.ensureHandle(profile);
    return this.send<QueryResult>(handle, {
      id: 0,
      type: "query",
      sql,
      maxRows,
    });
  }

  async reset(profile: ConnectionProfile): Promise<void> {
    if (!isLocalEngine(profile.engine)) {
      throw new Error(`${profile.engine} is not supported as a local browser engine`);
    }
    const handle = this.ensureHandle(profile);
    await this.send(handle, {
      id: 0,
      type: "reset",
      seedSql: seedFor(profile.engine),
    });
  }

  async exportDatabase(profile: ConnectionProfile): Promise<Uint8Array> {
    if (profile.engine !== "sqlite") {
      throw new Error("Only SQLite export is available in this web build");
    }
    const handle = this.ensureHandle(profile);
    const result = await this.send<{ bytes: Uint8Array }>(handle, {
      id: 0,
      type: "export",
    });
    return result.bytes;
  }

  async importDatabase(profile: ConnectionProfile, bytes: Uint8Array): Promise<void> {
    if (profile.engine !== "sqlite") {
      throw new Error("Only SQLite import is available in this web build");
    }
    const handle = this.ensureHandle(profile);
    await this.send(handle, {
      id: 0,
      type: "import",
      bytes,
    });
  }

  status(): RuntimeStatus {
    return {
      workers: Array.from(this.handles.values()).map((handle) => ({
        connectionId: handle.connectionId,
        engine: handle.engine,
        busy: handle.busy,
        lastUsedAt: handle.lastUsedAt,
      })),
    };
  }

  terminate() {
    for (const handle of this.handles.values()) {
      handle.worker.terminate();
    }
    this.handles.clear();
  }

  private ensureHandle(profile: ConnectionProfile): WorkerHandle {
    if (!isLocalEngine(profile.engine)) {
      throw new Error(`${profile.engine} is not supported as a local browser engine`);
    }
    const existing = this.handles.get(profile.id);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
    this.evictIdleHandle();
    const worker = createWorker(profile.engine);
    const handle: WorkerHandle = {
      connectionId: profile.id,
      databaseId: profile.databaseId ?? profile.id,
      engine: profile.engine,
      worker,
      pending: new Map(),
      sequence: 0,
      busy: false,
      lastUsedAt: Date.now(),
    };
    worker.onmessage = (event: MessageEvent<LocalWorkerResponse>) => {
      const pending = handle.pending.get(event.data.id);
      if (!pending) {
        return;
      }
      handle.pending.delete(event.data.id);
      handle.busy = handle.pending.size > 0;
      if (event.data.ok) {
        pending.resolve(event.data.data);
      } else {
        pending.reject(new Error(event.data.error));
      }
    };
    worker.onerror = (event) => {
      for (const pending of handle.pending.values()) {
        pending.reject(new Error(event.message));
      }
      handle.pending.clear();
      handle.busy = false;
    };
    this.handles.set(profile.id, handle);
    return handle;
  }

  private evictIdleHandle() {
    if (this.handles.size < this.maxWorkers) {
      return;
    }
    const idle = Array.from(this.handles.values())
      .filter((handle) => !handle.busy)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (idle) {
      idle.worker.terminate();
      this.handles.delete(idle.connectionId);
    }
  }

  private send<T>(handle: WorkerHandle, request: LocalWorkerRequest): Promise<T> {
    const id = ++handle.sequence;
    handle.busy = true;
    handle.lastUsedAt = Date.now();
    return new Promise((resolve, reject) => {
      handle.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      handle.worker.postMessage({ ...request, id });
    });
  }
}
