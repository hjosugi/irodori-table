import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bolt,
  ChevronDown,
  Clock3,
  Columns3,
  Database,
  KeyRound,
  Folder,
  Keyboard,
  Layers3,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  SplitSquareHorizontal,
  Square,
  Table2,
  TerminalSquare,
} from "lucide-react";
import {
  dbConnect,
  dbDisconnect,
  dbListObjects,
  dbRunQuery,
  type ConnectionInfo,
  type ConnectionProfile,
  type DatabaseMetadata,
  type DbEngine,
  type DbObjectMetadata,
  type QueryResult,
  workspaceSnapshot,
  type WorkspaceSnapshot,
} from "./generated/irodori-api";
import "./App.css";

const fallbackSnapshot: WorkspaceSnapshot = {
  activeConnectionId: "local-pg",
  connections: [
    {
      id: "local-pg",
      name: "Local Warehouse",
      engine: "PostgreSQL 16",
      status: "connected",
      latencyMs: 3,
      proxy: "direct",
      objects: [
        { name: "orders", kind: "table", rows: "1.2M" },
        { name: "customers", kind: "table", rows: "83K" },
        { name: "invoice_lines", kind: "table", rows: "4.8M" },
        { name: "recent_revenue", kind: "view" },
        { name: "refresh_rollups", kind: "procedure" },
      ],
    },
    {
      id: "oracle-dev",
      name: "Oracle Dev",
      engine: "Oracle 23ai",
      status: "idle",
      latencyMs: 18,
      proxy: "ssh > socks5",
      objects: [
        { name: "APP_USERS", kind: "table", rows: "42K" },
        { name: "LEDGER_ENTRY", kind: "table", rows: "9.1M" },
        { name: "PKG_BILLING", kind: "procedure" },
      ],
    },
  ],
};

const tabs = [
  { id: "scratch", label: "scratch.sql", group: "Daily work" },
  { id: "audit", label: "audit-window.sql", group: "Revenue" },
  { id: "explain", label: "explain-plan.sql", group: "Tuning" },
];

const initialQuery = `select
  c.id,
  c.name,
  sum(o.total) as lifetime_value,
  max(o.created_at) as last_order_at
from customers c
join orders o on o.customer_id = c.id
where o.created_at >= now() - interval '90 days'
group by c.id, c.name
order by lifetime_value desc
limit 200;`;

const resultRows = [
  ["1029", "Kawase Foods", "9841200", "2026-06-20 18:34"],
  ["917", "Northwind Retail", "7720100", "2026-06-20 11:12"],
  ["1441", "Aster Works", "6533000", "2026-06-19 23:41"],
  ["447", "Minato Labs", "5128800", "2026-06-19 08:03"],
  ["620", "Higashi Market", "4889100", "2026-06-18 19:27"],
  ["233", "Shiro Systems", "4412200", "2026-06-18 16:15"],
  ["1104", "Iris Trading", "3824000", "2026-06-17 21:06"],
];

const completions = [
  { label: "orders.customer_id", detail: "fk -> customers.id" },
  { label: "customers.name", detail: "text, indexed" },
  { label: "recent_revenue", detail: "view, refreshed 2m ago" },
  { label: "date_trunc('day', ...)", detail: "PostgreSQL function" },
];

const commands = [
  "Run current statement",
  "Open anything",
  "Toggle Vim mode",
  "Split editor right",
  "Show explain plan",
];

const engineOptions: Array<{ value: DbEngine; label: string }> = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sqlite", label: "SQLite" },
  { value: "mariadb", label: "MariaDB" },
  { value: "cockroachdb", label: "CockroachDB" },
  { value: "timescaledb", label: "TimescaleDB" },
  { value: "sqlserver", label: "SQL Server" },
  { value: "duckdb", label: "DuckDB" },
  { value: "mongodb", label: "MongoDB" },
  { value: "oracle", label: "Oracle" },
  { value: "yugabytedb", label: "YugabyteDB" },
  { value: "tidb", label: "TiDB" },
  { value: "redshift", label: "Redshift" },
];

type WorkspaceConnection = WorkspaceSnapshot["connections"][number];
type ConnectionInputMode = "url" | "fields";

type ConnectionDraft = {
  id: string;
  name: string;
  engine: DbEngine;
  mode: ConnectionInputMode;
  url: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
};

const profilesStorageKey = "irodori.connectionProfiles.v1";

const starterProfiles: ConnectionDraft[] = [
  {
    id: "local-pg",
    name: "Local Postgres",
    engine: "postgres",
    mode: "url",
    url: "postgres://irodori:irodori@localhost:55432/samples",
    host: "localhost",
    port: "55432",
    user: "irodori",
    password: "",
    database: "samples",
  },
  {
    id: "local-mysql",
    name: "Local MySQL",
    engine: "mysql",
    mode: "url",
    url: "mysql://irodori:irodori@localhost:55306/samples",
    host: "localhost",
    port: "55306",
    user: "irodori",
    password: "",
    database: "samples",
  },
];

function engineLabel(engine: DbEngine) {
  return engineOptions.find((item) => item.value === engine)?.label ?? engine;
}

function describeConnection(
  info: ConnectionInfo,
  elapsedMs: number,
  displayName = info.id,
): WorkspaceConnection {
  const label = engineLabel(info.engine);
  return {
    id: info.id,
    name: displayName,
    engine: `${label} ${info.serverVersion}`,
    status: "connected",
    latencyMs: elapsedMs,
    proxy: "direct",
    objects: [],
  };
}

function formatCell(value: unknown) {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function toCount(value: bigint | number) {
  return Number(value).toLocaleString();
}

function objectKindLabel(object: DbObjectMetadata) {
  return object.kind === "view" ? "view" : "table";
}

function defaultPort(engine: DbEngine) {
  switch (engine) {
    case "postgres":
    case "timescaledb":
      return "5432";
    case "cockroachdb":
      return "26257";
    case "yugabytedb":
      return "5433";
    case "redshift":
      return "5439";
    case "mysql":
    case "mariadb":
      return "3306";
    case "tidb":
      return "4000";
    case "sqlserver":
      return "1433";
    case "mongodb":
      return "27017";
    case "oracle":
      return "1521";
    default:
      return "";
  }
}

function newDraft(seed: number): ConnectionDraft {
  return {
    id: `connection-${seed}`,
    name: `Connection ${seed}`,
    engine: "postgres",
    mode: "url",
    url: "",
    host: "localhost",
    port: "5432",
    user: "",
    password: "",
    database: "",
  };
}

function sanitizedProfile(profile: ConnectionDraft): ConnectionDraft {
  return { ...profile, password: "" };
}

function loadProfiles() {
  try {
    const raw = window.localStorage.getItem(profilesStorageKey);
    if (!raw) {
      return starterProfiles;
    }
    const parsed = JSON.parse(raw) as ConnectionDraft[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return starterProfiles;
    }
    return parsed.map((profile) => ({
      ...newDraft(1),
      ...profile,
      password: "",
      port: profile.port ?? defaultPort(profile.engine),
    }));
  } catch {
    return starterProfiles;
  }
}

function validateDraft(draft: ConnectionDraft): string | null {
  if (!draft.id.trim()) {
    return "connection id is required";
  }
  if (!draft.name.trim()) {
    return "name is required";
  }
  if (draft.mode === "url" && !draft.url.trim()) {
    return "URL/DSN is required";
  }
  if (draft.port.trim() && !Number.isInteger(Number(draft.port))) {
    return "port must be a number";
  }
  return null;
}

function profileFromDraft(draft: ConnectionDraft): ConnectionProfile {
  if (draft.mode === "url") {
    return {
      id: draft.id.trim(),
      engine: draft.engine,
      url: draft.url.trim(),
    };
  }
  return {
    id: draft.id.trim(),
    engine: draft.engine,
    host: draft.host.trim() || undefined,
    port: draft.port.trim() ? Number(draft.port) : undefined,
    user: draft.user.trim() || undefined,
    password: draft.password || undefined,
    database: draft.database.trim() || undefined,
  };
}

function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(fallbackSnapshot);
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [activeConnectionId, setActiveConnectionId] = useState(
    fallbackSnapshot.activeConnectionId,
  );
  const [query, setQuery] = useState(initialQuery);
  const [running, setRunning] = useState(false);
  const [profiles, setProfiles] = useState<ConnectionDraft[]>(loadProfiles);
  const [selectedProfileId, setSelectedProfileId] = useState(
    () => profiles[0]?.id ?? "local-pg",
  );
  const [draft, setDraft] = useState<ConnectionDraft>(
    () => profiles[0] ?? starterProfiles[0],
  );
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [liveConnections, setLiveConnections] = useState<
    Record<string, WorkspaceConnection>
  >({});
  const [connecting, setConnecting] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [metadataByConnection, setMetadataByConnection] = useState<
    Record<string, DatabaseMetadata>
  >({});
  const [metadataLoading, setMetadataLoading] = useState<Set<string>>(new Set());
  const [metadataErrors, setMetadataErrors] = useState<Record<string, string>>(
    {},
  );

  useEffect(() => {
    workspaceSnapshot()
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setActiveConnectionId(nextSnapshot.activeConnectionId);
      })
      .catch(() => {
        setSnapshot(fallbackSnapshot);
      });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      profilesStorageKey,
      JSON.stringify(profiles.map(sanitizedProfile)),
    );
  }, [profiles]);

  const connections = useMemo(() => {
    const byId = new Map<string, WorkspaceConnection>();
    snapshot.connections.forEach((connection) => {
      byId.set(connection.id, connection);
    });
    Object.values(liveConnections).forEach((connection) => {
      byId.set(connection.id, connection);
    });
    return Array.from(byId.values()).map((connection) => ({
      ...connection,
      status: connectedIds.has(connection.id) ? "connected" : connection.status,
    }));
  }, [connectedIds, liveConnections, snapshot.connections]);

  const activeConnection = useMemo(
    () =>
      connections.find((item) => item.id === activeConnectionId) ??
      connections[0],
    [activeConnectionId, connections],
  );

  const activeConnectionOpen = connectedIds.has(activeConnectionId);
  const activeMetadata = metadataByConnection[activeConnectionId];
  const activeMetadataLoading = metadataLoading.has(activeConnectionId);
  const activeMetadataError = metadataErrors[activeConnectionId];

  useEffect(() => {
    if (
      activeConnectionOpen &&
      !activeMetadata &&
      !activeMetadataLoading &&
      !activeMetadataError
    ) {
      void refreshObjects(activeConnectionId);
    }
  }, [
    activeConnectionId,
    activeConnectionOpen,
    activeMetadata,
    activeMetadataError,
    activeMetadataLoading,
  ]);

  const lineNumbers = useMemo(
    () =>
      query
        .split("\n")
        .map((_, index) => index + 1)
        .join("\n"),
    [query],
  );

  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label;

  const resultColumns = result?.columns ?? [
    "id",
    "name",
    "lifetime_value",
    "last_order_at",
  ];
  const resultCells =
    result?.rows.map((row) => row.map(formatCell)) ?? resultRows;
  const gridTemplateColumns = resultColumns
    .map(() => "minmax(140px, 1fr)")
    .join(" ");
  const resultSummary = result
    ? `${toCount(result.rowCount)} rows${result.truncated ? " capped" : ""} in ${toCount(
        result.elapsedMs,
      )} ms`
    : "sample preview";

  function updateDraft(patch: Partial<ConnectionDraft>) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      if (patch.engine && !patch.port) {
        next.port = defaultPort(patch.engine);
      }
      return next;
    });
    setConnectionError(null);
  }

  function selectProfile(profile: ConnectionDraft) {
    setSelectedProfileId(profile.id);
    setDraft(profile);
    setConnectionError(null);
  }

  function saveDraft(showSaved = true) {
    const validationError = validateDraft(draft);
    if (validationError) {
      setConnectionError(validationError);
      return false;
    }
    const cleanDraft = sanitizedProfile(draft);
    setProfiles((current) => {
      const existing = current.findIndex((profile) => profile.id === cleanDraft.id);
      if (existing === -1) {
        return [...current, cleanDraft];
      }
      return current.map((profile, index) =>
        index === existing ? cleanDraft : profile,
      );
    });
    setSelectedProfileId(cleanDraft.id);
    if (showSaved) {
      setConnectionError(null);
    }
    return true;
  }

  function addProfile() {
    const next = newDraft(profiles.length + 1);
    setProfiles((current) => [...current, sanitizedProfile(next)]);
    setSelectedProfileId(next.id);
    setDraft(next);
    setConnectionError(null);
  }

  async function deleteProfile() {
    const id = draft.id;
    if (connectedIds.has(id)) {
      await dbDisconnect(id).catch(() => undefined);
    }
    setConnectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setProfiles((current) => {
      const next = current.filter((profile) => profile.id !== id);
      const fallback = next[0] ?? newDraft(1);
      setSelectedProfileId(fallback.id);
      setDraft(fallback);
      return next.length > 0 ? next : [sanitizedProfile(fallback)];
    });
  }

  async function testActiveProfile() {
    const validationError = validateDraft(draft);
    if (validationError) {
      setConnectionError(validationError);
      return;
    }
    setTestingConnection(true);
    setConnectionError(null);
    const testId = `__test_${draft.id}_${Date.now()}`;
    try {
      await dbConnect({
        ...profileFromDraft(draft),
        id: testId,
      });
      await dbDisconnect(testId);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setTestingConnection(false);
    }
  }

  async function connectActiveProfile(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!saveDraft(false)) {
      return;
    }
    setConnecting(true);
    setConnectionError(null);
    try {
      const started = performance.now();
      const info = await dbConnect(profileFromDraft(draft));
      const elapsedMs = Math.max(1, Math.round(performance.now() - started));
      const nextConnection = describeConnection(info, elapsedMs, draft.name.trim());
      setLiveConnections((current) => ({
        ...current,
        [nextConnection.id]: nextConnection,
      }));
      setConnectedIds((current) => new Set(current).add(nextConnection.id));
      setActiveConnectionId(nextConnection.id);
      void refreshObjects(nextConnection.id, true);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectActiveProfile() {
    const id = activeConnectionId;
    if (!connectedIds.has(id)) {
      return;
    }
    await dbDisconnect(id).catch(() => undefined);
    setConnectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setMetadataByConnection((current) => {
      const { [id]: _removed, ...next } = current;
      return next;
    });
    setMetadataErrors((current) => {
      const { [id]: _removed, ...next } = current;
      return next;
    });
  }

  async function refreshObjects(connectionId = activeConnectionId, force = false) {
    if (!force && !connectedIds.has(connectionId)) {
      return;
    }
    setMetadataLoading((current) => new Set(current).add(connectionId));
    setMetadataErrors((current) => {
      const { [connectionId]: _removed, ...next } = current;
      return next;
    });
    try {
      const metadata = await dbListObjects(connectionId);
      setMetadataByConnection((current) => ({
        ...current,
        [connectionId]: metadata,
      }));
    } catch (error) {
      setMetadataErrors((current) => ({
        ...current,
        [connectionId]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setMetadataLoading((current) => {
        const next = new Set(current);
        next.delete(connectionId);
        return next;
      });
    }
  }

  async function runQuery() {
    if (!activeConnectionOpen) {
      setQueryError(`not connected: ${activeConnectionId}`);
      return;
    }
    setRunning(true);
    setQueryError(null);
    try {
      const nextResult = await dbRunQuery(activeConnectionId, query, 10_000);
      setResult(nextResult);
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="window-controls" aria-hidden="true">
          <span className="dot red" />
          <span className="dot amber" />
          <span className="dot green" />
        </div>
        <div className="brand">
          <Database size={18} />
          <span>Irodori Table</span>
        </div>
        <div className="global-search">
          <Search size={15} />
          <input aria-label="Search" placeholder="Open anything" />
        </div>
        <div className="keymap-chip">
          <Keyboard size={14} />
          <span>Vim</span>
        </div>
      </header>

      <section className="toolbar" aria-label="Workspace toolbar">
        <button className="connection-select" type="button">
          <Database size={16} />
          <span>{activeConnection.name}</span>
          <small>{activeConnection.engine}</small>
          <ChevronDown size={15} />
        </button>
        <button
          className="primary-action"
          type="button"
          disabled={running}
          onClick={runQuery}
        >
          <Play size={15} fill="currentColor" />
          <span>Run Current</span>
        </button>
        <button
          className="icon-button"
          type="button"
          title="Cancel query"
          aria-label="Cancel query"
          disabled={!running}
          onClick={() => setRunning(false)}
        >
          <Square size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Save query"
          aria-label="Save query"
        >
          <Save size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Split editor"
          aria-label="Split editor"
        >
          <SplitSquareHorizontal size={15} />
        </button>
        <div className="toolbar-spacer" />
        <div className="latency">
          <Bolt size={14} />
          <span>
            {activeConnectionOpen ? `${activeConnection.latencyMs} ms` : "closed"}
          </span>
        </div>
        <div className="latency proxy">
          <ShieldCheck size={14} />
          <span>{activeConnection.proxy}</span>
        </div>
      </section>

      <div className="workspace">
        <aside className="sidebar">
          <section className="sidebar-section connection-section">
            <div className="section-heading">
              <span>Connections</span>
              <button
                className="mini-button"
                type="button"
                title="New connection"
                aria-label="New connection"
                onClick={addProfile}
              >
                <Plus size={14} />
              </button>
            </div>
            <form className="connection-editor" onSubmit={connectActiveProfile}>
              <div className="profile-strip" aria-label="Connection profiles">
                {profiles.map((profile) => (
                  <button
                    className={
                      profile.id === selectedProfileId
                        ? "profile-pill active"
                        : "profile-pill"
                    }
                    key={profile.id}
                    type="button"
                    onClick={() => selectProfile(profile)}
                  >
                    <Database size={13} />
                    <span>{profile.name}</span>
                  </button>
                ))}
              </div>
              <div className="quick-connect-row">
                <input
                  aria-label="Connection name"
                  placeholder="Name"
                  value={draft.name}
                  onChange={(event) => updateDraft({ name: event.currentTarget.value })}
                />
                <input
                  aria-label="Connection id"
                  placeholder="ID"
                  value={draft.id}
                  onChange={(event) => updateDraft({ id: event.currentTarget.value })}
                />
              </div>
              <div className="quick-connect-row">
                <select
                  aria-label="Engine"
                  value={draft.engine}
                  onChange={(event) =>
                    updateDraft({ engine: event.currentTarget.value as DbEngine })
                  }
                >
                  {engineOptions.map((engine) => (
                    <option key={engine.value} value={engine.value}>
                      {engine.label}
                    </option>
                  ))}
                </select>
                <div className="mode-toggle" aria-label="Connection input mode">
                  <button
                    className={draft.mode === "url" ? "active" : ""}
                    type="button"
                    onClick={() => updateDraft({ mode: "url" })}
                  >
                    URL
                  </button>
                  <button
                    className={draft.mode === "fields" ? "active" : ""}
                    type="button"
                    onClick={() => updateDraft({ mode: "fields" })}
                  >
                    Fields
                  </button>
                </div>
              </div>
              {draft.mode === "url" ? (
                <input
                  aria-label="Connection URL"
                  placeholder="URL / DSN"
                  value={draft.url}
                  onChange={(event) => updateDraft({ url: event.currentTarget.value })}
                />
              ) : (
                <>
                  <div className="quick-connect-row host-row">
                    <input
                      aria-label="Host"
                      placeholder="Host"
                      value={draft.host}
                      onChange={(event) => updateDraft({ host: event.currentTarget.value })}
                    />
                    <input
                      aria-label="Port"
                      placeholder="Port"
                      inputMode="numeric"
                      value={draft.port}
                      onChange={(event) => updateDraft({ port: event.currentTarget.value })}
                    />
                  </div>
                  <div className="quick-connect-row">
                    <input
                      aria-label="User"
                      placeholder="User"
                      value={draft.user}
                      onChange={(event) => updateDraft({ user: event.currentTarget.value })}
                    />
                    <input
                      aria-label="Password"
                      placeholder="Password"
                      type="password"
                      value={draft.password}
                      onChange={(event) =>
                        updateDraft({ password: event.currentTarget.value })
                      }
                    />
                  </div>
                  <input
                    aria-label="Database"
                    placeholder="Database / service / path"
                    value={draft.database}
                    onChange={(event) =>
                      updateDraft({ database: event.currentTarget.value })
                    }
                  />
                </>
              )}
              <div className="quick-connect-actions">
                <button className="text-button" type="button" onClick={() => saveDraft()}>
                  Save
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={testingConnection}
                  onClick={testActiveProfile}
                >
                  {testingConnection ? "Testing" : "Test"}
                </button>
                <button
                  className="primary-action compact"
                  type="submit"
                  disabled={connecting}
                >
                  <Database size={14} />
                  <span>{connecting ? "Connecting" : "Connect"}</span>
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={!activeConnectionOpen}
                  onClick={disconnectActiveProfile}
                >
                  Disconnect
                </button>
                <button className="text-button danger" type="button" onClick={deleteProfile}>
                  Delete
                </button>
              </div>
              {connectionError ? (
                <p className="inline-error">
                  <AlertTriangle size={13} />
                  <span>{connectionError}</span>
                </p>
              ) : null}
            </form>
            <div className="connection-list">
              {connections.map((connection) => (
                <button
                  className={
                    connection.id === activeConnectionId
                      ? "connection-item active"
                      : "connection-item"
                  }
                  key={connection.id}
                  type="button"
                  onClick={() => setActiveConnectionId(connection.id)}
                >
                  <Database size={16} />
                  <span>
                    <strong>{connection.name}</strong>
                    <small>{connection.engine}</small>
                  </span>
                  <i className={connection.status} />
                </button>
              ))}
            </div>
          </section>

          <section className="sidebar-section browser-section">
            <div className="section-heading">
              <span>
                {activeMetadata
                  ? `${activeMetadata.schemas.length} schemas`
                  : "public"}
              </span>
              <button
                className="mini-button"
                type="button"
                title="Refresh objects"
                aria-label="Refresh objects"
                disabled={!activeConnectionOpen || activeMetadataLoading}
                onClick={() => refreshObjects()}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="object-browser">
              {activeMetadataLoading ? (
                <div className="empty-browser">Loading objects...</div>
              ) : activeMetadataError ? (
                <div className="inline-error browser-error">
                  <AlertTriangle size={13} />
                  <span>{activeMetadataError}</span>
                </div>
              ) : activeMetadata ? (
                activeMetadata.schemas.length > 0 ? (
                  activeMetadata.schemas.map((schema) => (
                    <details className="schema-tree" key={schema.name} open>
                      <summary>
                        <Folder size={14} />
                        <span>{schema.name}</span>
                        <small>{schema.objects.length}</small>
                      </summary>
                      {schema.objects.map((object) => (
                        <details
                          className="object-tree"
                          key={`${object.schema}.${object.name}`}
                        >
                          <summary>
                            <Table2 size={15} />
                            <span>{object.name}</span>
                            <small>
                              {objectKindLabel(object)} · {object.columns.length}
                            </small>
                          </summary>
                          <div className="metadata-children">
                            {object.columns.map((column) => (
                              <button
                                className="metadata-row"
                                key={`${object.schema}.${object.name}.${column.name}`}
                                type="button"
                                title={`${column.name}: ${column.dataType}`}
                              >
                                <Columns3 size={14} />
                                <span>{column.name}</span>
                                <small>
                                  {column.dataType}
                                  {column.nullable ? "" : " not null"}
                                </small>
                              </button>
                            ))}
                            {object.indexes.map((index) => (
                              <button
                                className="metadata-row"
                                key={`${object.schema}.${object.name}.${index.name}`}
                                type="button"
                                title={`${index.name}: ${index.columns.join(", ")}`}
                              >
                                <KeyRound size={14} />
                                <span>{index.name}</span>
                                <small>
                                  {index.unique ? "unique" : "index"}
                                  {index.columns.length > 0
                                    ? ` · ${index.columns.join(", ")}`
                                    : ""}
                                </small>
                              </button>
                            ))}
                          </div>
                        </details>
                      ))}
                    </details>
                  ))
                ) : (
                  <div className="empty-browser">No objects found</div>
                )
              ) : activeConnection.objects.length > 0 ? (
                activeConnection.objects.map((object) => (
                  <button className="object-row" key={object.name} type="button">
                    {object.kind === "procedure" ? (
                      <TerminalSquare size={15} />
                    ) : (
                      <Table2 size={15} />
                    )}
                    <span>{object.name}</span>
                    <small>{object.rows ?? object.kind}</small>
                  </button>
                ))
              ) : (
                <div className="empty-browser">No objects loaded</div>
              )}
            </div>
          </section>
        </aside>

        <section className="main-pane">
          <div className="tab-strip">
            <div className="tab-folder">
              <Folder size={14} />
              <span>{tabs.find((tab) => tab.id === activeTab)?.group}</span>
            </div>
            {tabs.map((tab) => (
              <button
                className={tab.id === activeTab ? "tab active" : "tab"}
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
            <button
              className="mini-button"
              type="button"
              title="New tab"
              aria-label="New tab"
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="editor-and-inspector">
            <section className="editor-pane" aria-label={activeTabLabel}>
              <div className="editor-meta">
                <span>{activeTabLabel}</span>
                <span>
                  {running ? "running..." : activeConnectionOpen ? "ready" : "closed"}
                </span>
              </div>
              <div className="editor-shell">
                <pre className="line-numbers" aria-hidden="true">
                  {lineNumbers}
                </pre>
                <textarea
                  aria-label="SQL editor"
                  spellCheck={false}
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </div>
            </section>

            <aside className="inspector">
              <section>
                <div className="section-heading">
                  <span>Completion</span>
                  <Columns3 size={14} />
                </div>
                <div className="completion-list">
                  {completions.map((item) => (
                    <button className="completion-item" key={item.label}>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <div className="section-heading">
                  <span>Commands</span>
                  <Layers3 size={14} />
                </div>
                <div className="command-list">
                  {commands.map((command) => (
                    <button className="command-item" key={command}>
                      {command}
                    </button>
                  ))}
                </div>
              </section>
            </aside>
          </div>

          <section className="results-pane">
            <div className="results-header">
              <div>
                <strong>Result 1</strong>
                <span>{queryError ? "failed" : resultSummary}</span>
              </div>
              <div className="results-actions">
                <button className="text-button" type="button">
                  Export CSV
                </button>
                <button className="text-button" type="button">
                  Edit Data
                </button>
              </div>
            </div>
            {queryError ? (
              <div className="result-error" role="alert">
                <AlertTriangle size={16} />
                <span>{queryError}</span>
              </div>
            ) : null}
            <div className="result-grid" role="table" aria-label="Query result">
              <div
                className="grid-row header"
                role="row"
                style={{ gridTemplateColumns }}
              >
                {resultColumns.map((column) => (
                  <span role="columnheader" key={column}>
                    {column}
                  </span>
                ))}
              </div>
              {resultCells.map((row, rowIndex) => (
                <div
                  className="grid-row"
                  role="row"
                  key={`${rowIndex}-${row.join("-")}`}
                  style={{ gridTemplateColumns }}
                >
                  {row.map((cell, cellIndex) => (
                    <span role="cell" key={`${cellIndex}-${cell}`}>
                      {cell}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>

      <footer className="statusbar">
        <span>
          <Clock3 size={13} />
          history scoped to {activeConnection.name}
        </span>
        <span>{query.split("\n").length} lines</span>
        <span>{running ? "query running" : "idle"}</span>
      </footer>
    </main>
  );
}

export default App;
