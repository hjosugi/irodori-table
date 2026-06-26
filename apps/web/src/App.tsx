import {
  Cloud,
  Cpu,
  Database,
  Download,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Smartphone,
  Trash2,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { LocalWorkerPool, resolveMaxWorkerCount } from "./db/worker-client";
import { runOnlineQuery } from "./db/online-client";
import { starterSql } from "./db/sample-data";
import {
  loadActiveProfileId,
  loadHistory,
  loadProfiles,
  loadQuery,
  saveActiveProfileId,
  saveHistory,
  saveProfiles,
  saveQuery,
} from "./storage";
import type {
  ConnectionMode,
  ConnectionProfile,
  LocalEngine,
  OnlineEngine,
  QueryHistoryItem,
  QueryResult,
  RuntimeStatus,
} from "./types";

const maxRows = 500;
const workerPool = new LocalWorkerPool(resolveMaxWorkerCount());

const onlineEngines: OnlineEngine[] = [
  "postgres",
  "mysql",
  "mariadb",
  "sqlite",
  "duckdb",
  "sqlserver",
  "custom",
];

function isLocalEngine(engine: ConnectionProfile["engine"]): engine is LocalEngine {
  return engine === "sqlite" || engine === "duckdb";
}

function fallbackQuery(profile: ConnectionProfile) {
  return isLocalEngine(profile.engine)
    ? starterSql(profile.engine)
    : "select current_timestamp as now;";
}

function profileBadge(profile: ConnectionProfile) {
  return `${profile.mode} / ${profile.engine}`;
}

function newProfile(mode: ConnectionMode, index: number): ConnectionProfile {
  if (mode === "local") {
    return {
      id: `local-sqlite-${index}`,
      name: `Local SQLite ${index}`,
      mode: "local",
      engine: "sqlite",
      databaseId: `local-sqlite-${index}`,
    };
  }
  return {
    id: `online-${index}`,
    name: `Online ${index}`,
    mode: "online",
    engine: "postgres",
    endpoint: "/api/query",
  };
}

function downloadBytes(fileName: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/vnd.sqlite3" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [profiles, setProfiles] = useState(loadProfiles);
  const [activeProfileId, setActiveProfileId] = useState(loadActiveProfileId);
  const activeProfile =
    profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const [sql, setSql] = useState(() => loadQuery(fallbackQuery(activeProfile)));
  const [result, setResult] = useState<QueryResult | null>(null);
  const [history, setHistory] = useState(loadHistory);
  const [status, setStatus] = useState<RuntimeStatus>(workerPool.status());
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeWorkers = useMemo(
    () =>
      status.workers.map((worker) => ({
        ...worker,
        profile: profiles.find((profile) => profile.id === worker.connectionId),
      })),
    [profiles, status],
  );

  useEffect(() => {
    saveProfiles(profiles);
  }, [profiles]);

  useEffect(() => {
    saveActiveProfileId(activeProfile.id);
  }, [activeProfile.id]);

  useEffect(() => {
    saveQuery(sql);
  }, [sql]);

  useEffect(() => {
    return () => workerPool.terminate();
  }, []);

  async function connect(profile = activeProfile) {
    setMessage("");
    if (profile.mode === "local") {
      await workerPool.connect(profile);
      setStatus(workerPool.status());
      setMessage(`${profile.name} ready`);
      return;
    }
    setMessage(`${profile.name} endpoint selected`);
  }

  async function run() {
    setRunning(true);
    setMessage("");
    const startedAt = new Date().toISOString();
    try {
      let nextResult: QueryResult;
      if (activeProfile.mode === "local") {
        await workerPool.connect(activeProfile);
        nextResult = await workerPool.runQuery(activeProfile, sql, maxRows);
      } else {
        nextResult = await runOnlineQuery(activeProfile, sql, maxRows);
      }
      setResult(nextResult);
      const item: QueryHistoryItem = {
        id: `${Date.now()}`,
        connectionName: activeProfile.name,
        engine: activeProfile.engine,
        mode: activeProfile.mode,
        sql,
        elapsedMs: nextResult.elapsedMs,
        rowCount: nextResult.rowCount,
        status: "ok",
        ranAt: startedAt,
      };
      setHistory((items) => {
        const next = [item, ...items].slice(0, 30);
        saveHistory(next);
        return next;
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      setMessage(errorText);
      setHistory((items) => {
        const next = [
          {
            id: `${Date.now()}`,
            connectionName: activeProfile.name,
            engine: activeProfile.engine,
            mode: activeProfile.mode,
            sql,
            elapsedMs: 0,
            rowCount: 0,
            status: "error" as const,
            ranAt: startedAt,
            error: errorText,
          },
          ...items,
        ].slice(0, 30);
        saveHistory(next);
        return next;
      });
    } finally {
      setRunning(false);
      setStatus(workerPool.status());
    }
  }

  function updateActiveProfile(patch: Partial<ConnectionProfile>) {
    setProfiles((items) =>
      items.map((profile) =>
        profile.id === activeProfile.id ? { ...profile, ...patch } : profile,
      ),
    );
  }

  function addProfile(mode: ConnectionMode) {
    const profile = newProfile(mode, profiles.length + 1);
    setProfiles((items) => [...items, profile]);
    setActiveProfileId(profile.id);
    setSql(fallbackQuery(profile));
  }

  function removeActiveProfile() {
    if (profiles.length === 1) {
      return;
    }
    const nextProfiles = profiles.filter((profile) => profile.id !== activeProfile.id);
    setProfiles(nextProfiles);
    setActiveProfileId(nextProfiles[0].id);
  }

  async function resetLocal() {
    if (activeProfile.mode !== "local") {
      return;
    }
    await workerPool.reset(activeProfile);
    setSql(fallbackQuery(activeProfile));
    setResult(null);
    setStatus(workerPool.status());
    setMessage(`${activeProfile.name} reset`);
  }

  async function exportSqlite() {
    const bytes = await workerPool.exportDatabase(activeProfile);
    downloadBytes(`${activeProfile.databaseId ?? activeProfile.id}.sqlite`, bytes);
  }

  async function importSqlite(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }
    try {
      await workerPool.connect(activeProfile);
      await workerPool.importDatabase(activeProfile, new Uint8Array(await file.arrayBuffer()));
      setResult(null);
      setStatus(workerPool.status());
      setMessage(`${file.name} imported`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    event.currentTarget.value = "";
  }

  function switchProfile(id: string) {
    const profile = profiles.find((item) => item.id === id);
    if (!profile) {
      return;
    }
    setActiveProfileId(id);
    setSql(fallbackQuery(profile));
    setResult(null);
    setMessage("");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Connections">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          <div>
            <strong>Irodori Web</strong>
            <span>local + online</span>
          </div>
        </div>

        <div className="connection-list">
          {profiles.map((profile) => (
            <button
              className={profile.id === activeProfile.id ? "connection active" : "connection"}
              key={profile.id}
              onClick={() => switchProfile(profile.id)}
              type="button"
            >
              {profile.mode === "local" ? <Smartphone size={18} /> : <Cloud size={18} />}
              <span>
                <strong>{profile.name}</strong>
                <small>{profileBadge(profile)}</small>
              </span>
            </button>
          ))}
        </div>

        <div className="button-row">
          <button type="button" onClick={() => addProfile("local")}>
            <Plus size={16} />
            Local
          </button>
          <button type="button" onClick={() => addProfile("online")}>
            <Plus size={16} />
            Online
          </button>
        </div>
      </aside>

      <section className="workbench" aria-label="SQL workbench">
        <header className="topbar">
          <div>
            <p>{profileBadge(activeProfile)}</p>
            <h1>{activeProfile.name}</h1>
          </div>
          <div className="topbar-actions">
            <button type="button" onClick={() => void connect()}>
              <Database size={17} />
              Connect
            </button>
            <button className="primary" type="button" onClick={() => void run()} disabled={running}>
              {running ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
              Run
            </button>
          </div>
        </header>

        <section className="profile-editor" aria-label="Active connection">
          <label>
            Name
            <input
              value={activeProfile.name}
              onChange={(event) => updateActiveProfile({ name: event.target.value })}
            />
          </label>
          <label>
            Mode
            <select
              value={activeProfile.mode}
              onChange={(event) => {
                const mode = event.target.value as ConnectionMode;
                updateActiveProfile({
                  mode,
                  engine: mode === "local" ? "sqlite" : "postgres",
                  endpoint: mode === "online" ? "/api/query" : undefined,
                });
              }}
            >
              <option value="local">local</option>
              <option value="online">online</option>
            </select>
          </label>
          <label>
            Engine
            {activeProfile.mode === "local" ? (
              <select
                value={activeProfile.engine}
                onChange={(event) =>
                  updateActiveProfile({
                    engine: event.target.value as LocalEngine,
                    databaseId: `${event.target.value}-${activeProfile.id}`,
                  })
                }
              >
                <option value="sqlite">sqlite</option>
                <option value="duckdb">duckdb</option>
              </select>
            ) : (
              <select
                value={activeProfile.engine}
                onChange={(event) =>
                  updateActiveProfile({ engine: event.target.value as OnlineEngine })
                }
              >
                {onlineEngines.map((engine) => (
                  <option key={engine} value={engine}>
                    {engine}
                  </option>
                ))}
              </select>
            )}
          </label>
          {activeProfile.mode === "online" ? (
            <label className="wide">
              Endpoint
              <input
                value={activeProfile.endpoint ?? ""}
                onChange={(event) => updateActiveProfile({ endpoint: event.target.value })}
                placeholder="/api/query"
              />
            </label>
          ) : (
            <label className="wide">
              Database id
              <input
                value={activeProfile.databaseId ?? activeProfile.id}
                onChange={(event) => updateActiveProfile({ databaseId: event.target.value })}
              />
            </label>
          )}
          <button className="icon-button danger" type="button" onClick={removeActiveProfile}>
            <Trash2 size={17} />
          </button>
        </section>

        <section className="editor-panel" aria-label="SQL editor">
          <textarea
            spellCheck={false}
            value={sql}
            onChange={(event) => setSql(event.target.value)}
          />
        </section>

        {message ? <div className="message">{message}</div> : null}

        <section className="result-panel" aria-label="Query result">
          <div className="panel-heading">
            <div>
              <h2>Results</h2>
              <span>
                {result
                  ? `${result.rowCount.toLocaleString()} rows / ${result.elapsedMs.toFixed(1)} ms`
                  : "No result"}
              </span>
            </div>
            {result?.truncated ? <strong>{maxRows.toLocaleString()} row cap</strong> : null}
          </div>
          <div className="table-scroll">
            {result?.columns.length ? (
              <table>
                <thead>
                  <tr>
                    {result.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, columnIndex) => (
                        <td key={columnIndex}>{cell == null ? "NULL" : String(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-result">{result?.message ?? "Run a query"}</div>
            )}
          </div>
        </section>
      </section>

      <aside className="inspector" aria-label="Runtime">
        <section>
          <div className="panel-heading compact">
            <div>
              <h2>Local setup</h2>
              <span>{activeProfile.mode === "local" ? activeProfile.engine : "endpoint"}</span>
            </div>
          </div>
          <div className="stack">
            <button type="button" onClick={resetLocal} disabled={activeProfile.mode !== "local"}>
              <RefreshCw size={16} />
              Reset demo
            </button>
            <button
              type="button"
              onClick={() => void exportSqlite()}
              disabled={activeProfile.mode !== "local" || activeProfile.engine !== "sqlite"}
            >
              <Download size={16} />
              Export
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={activeProfile.mode !== "local" || activeProfile.engine !== "sqlite"}
            >
              <Upload size={16} />
              Import
            </button>
            <input
              ref={fileInputRef}
              hidden
              type="file"
              accept=".sqlite,.sqlite3,.db"
              onChange={(event) => void importSqlite(event)}
            />
          </div>
        </section>

        <section>
          <div className="panel-heading compact">
            <div>
              <h2>Workers</h2>
              <span>
                {activeWorkers.length.toLocaleString()} /{" "}
                {status.maxWorkers.toLocaleString()} active
              </span>
            </div>
          </div>
          <div className="worker-list">
            {activeWorkers.length ? (
              activeWorkers.map((worker) => (
                <div className="worker" key={worker.connectionId}>
                  <Cpu size={16} />
                  <span>
                    <strong>{worker.profile?.name ?? worker.connectionId}</strong>
                    <small>{worker.busy ? "busy" : "idle"}</small>
                  </span>
                </div>
              ))
            ) : (
              <div className="empty-result">No local workers</div>
            )}
          </div>
        </section>

        <section>
          <div className="panel-heading compact">
            <div>
              <h2>History</h2>
              <span>{history.length.toLocaleString()} runs</span>
            </div>
            <Save size={16} />
          </div>
          <div className="history-list">
            {history.slice(0, 8).map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setSql(item.sql)}
                className={item.status === "error" ? "history error" : "history"}
              >
                <strong>{item.connectionName}</strong>
                <span>
                  {item.status === "ok"
                    ? `${item.rowCount.toLocaleString()} rows`
                    : item.error ?? "error"}
                </span>
              </button>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}
