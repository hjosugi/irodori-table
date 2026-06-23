import {
  type FormEvent,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Bolt,
  ChevronDown,
  Clock3,
  Columns3,
  Database,
  Download,
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
import { runQueryStream } from "./db-stream";
import {
  dbCancel,
  dbConnect,
  dbDisconnect,
  dbListObjects,
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
const queryHistoryStorageKey = "irodori.queryHistory.v1";
const maxQueryHistoryItems = 50;

type QueryHistoryItem = {
  id: string;
  connectionId: string;
  connectionName: string;
  engine: string;
  sql: string;
  status: "ok" | "error";
  rowCount: number;
  elapsedMs: number;
  truncated: boolean;
  error?: string;
  ranAt: string;
};

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
  {
    id: "sqlite-memory",
    name: "SQLite Memory",
    engine: "sqlite",
    mode: "fields",
    url: "",
    host: "",
    port: "",
    user: "",
    password: "",
    database: ":memory:",
  },
  {
    id: "duckdb-memory",
    name: "DuckDB Memory",
    engine: "duckdb",
    mode: "url",
    url: ":memory:",
    host: "",
    port: "",
    user: "",
    password: "",
    database: ":memory:",
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

function memoryDefaults(engine: DbEngine): Partial<ConnectionDraft> {
  if (engine === "sqlite") {
    return {
      mode: "fields",
      url: "",
      host: "",
      port: "",
      user: "",
      password: "",
      database: ":memory:",
    };
  }
  if (engine === "duckdb") {
    return {
      mode: "url",
      url: ":memory:",
      host: "",
      port: "",
      user: "",
      password: "",
      database: ":memory:",
    };
  }
  return {
    port: defaultPort(engine),
  };
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

function withStarterProfiles(profiles: ConnectionDraft[]) {
  const existing = new Set(profiles.map((profile) => profile.id));
  return [
    ...profiles,
    ...starterProfiles.filter((profile) => !existing.has(profile.id)),
  ];
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
    return withStarterProfiles(
      parsed.map((profile) => ({
        ...newDraft(1),
        ...profile,
        password: "",
        port: profile.port ?? defaultPort(profile.engine),
      })),
    );
  } catch {
    return starterProfiles;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadQueryHistory(): QueryHistoryItem[] {
  try {
    const raw = window.localStorage.getItem(queryHistoryStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .flatMap((item): QueryHistoryItem[] => {
        if (
          !isRecord(item) ||
          typeof item.id !== "string" ||
          typeof item.connectionId !== "string" ||
          typeof item.connectionName !== "string" ||
          typeof item.engine !== "string" ||
          typeof item.sql !== "string" ||
          typeof item.ranAt !== "string" ||
          (item.status !== "ok" && item.status !== "error")
        ) {
          return [];
        }
        return [
          {
            id: item.id,
            connectionId: item.connectionId,
            connectionName: item.connectionName,
            engine: item.engine,
            sql: item.sql,
            status: item.status,
            rowCount: Number(item.rowCount) || 0,
            elapsedMs: Number(item.elapsedMs) || 0,
            truncated: Boolean(item.truncated),
            error: typeof item.error === "string" ? item.error : undefined,
            ranAt: item.ranAt,
          },
        ];
      })
      .slice(0, maxQueryHistoryItems);
  } catch {
    return [];
  }
}

function compactSql(sql: string, maxLength = 92) {
  const compact = sql.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
}

function formatHistoryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dollarTagAt(sql: string, index: number) {
  const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
  return match?.[0];
}

function statementDelimiters(sql: string) {
  const delimiters: number[] = [];
  let quote: "normal" | "single" | "double" | "line" | "block" | "dollar" =
    "normal";
  let dollarTag = "";

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (quote === "single") {
      if (char === "'" && next === "'") {
        index += 1;
      } else if (char === "'") {
        quote = "normal";
      }
      continue;
    }

    if (quote === "double") {
      if (char === '"' && next === '"') {
        index += 1;
      } else if (char === '"') {
        quote = "normal";
      }
      continue;
    }

    if (quote === "line") {
      if (char === "\n") {
        quote = "normal";
      }
      continue;
    }

    if (quote === "block") {
      if (char === "*" && next === "/") {
        quote = "normal";
        index += 1;
      }
      continue;
    }

    if (quote === "dollar") {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        quote = "normal";
      }
      continue;
    }

    if (char === "'") {
      quote = "single";
    } else if (char === '"') {
      quote = "double";
    } else if (char === "-" && next === "-") {
      quote = "line";
      index += 1;
    } else if (char === "/" && next === "*") {
      quote = "block";
      index += 1;
    } else if (char === "$") {
      const tag = dollarTagAt(sql, index);
      if (tag) {
        quote = "dollar";
        dollarTag = tag;
        index += tag.length - 1;
      }
    } else if (char === ";") {
      delimiters.push(index);
    }
  }

  return delimiters;
}

function selectedOrCurrentStatement(
  textarea: HTMLTextAreaElement | null,
  sql: string,
) {
  const selectionStart = textarea?.selectionStart ?? 0;
  const selectionEnd = textarea?.selectionEnd ?? selectionStart;
  const selectedSql = sql.slice(selectionStart, selectionEnd).trim();

  if (selectedSql) {
    return selectedSql;
  }

  const cursor = Math.min(selectionStart, sql.length);
  const delimiters = statementDelimiters(sql);
  let previous: number | undefined;
  for (const delimiter of delimiters) {
    if (delimiter >= cursor) {
      break;
    }
    previous = delimiter;
  }
  const next = delimiters.find((delimiter) => delimiter >= cursor);
  const start = previous === undefined ? 0 : previous + 1;
  const end = next === undefined ? sql.length : next + 1;
  const statement = sql.slice(start, end).trim();

  return statement || sql.trim();
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvFromResult(result: QueryResult) {
  const rows = result.rows.map((row) =>
    result.columns.map((_, index) => csvCell(row[index])).join(","),
  );
  return [result.columns.map(csvCell).join(","), ...rows].join("\r\n");
}

function downloadName(connectionId: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `irodori-${connectionId}-${timestamp}.csv`;
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
  if (draft.mode === "fields" && draft.engine === "sqlite" && !draft.database.trim()) {
    return "SQLite needs a file path or :memory:";
  }
  if (draft.mode === "fields" && draft.engine !== "sqlite" && draft.engine !== "duckdb") {
    if (!draft.host.trim()) {
      return "host is required";
    }
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

// Result grid virtualization: fixed row height (mirrors `.grid-row` / `.grid-pad`
// in App.css) and how many off-screen rows to keep rendered above/below the
// viewport so fast scrolling does not flash blank rows.
const GRID_ROW_HEIGHT = 27;
const GRID_OVERSCAN = 8;

function App() {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridScrollRaf = useRef<number | null>(null);
  const [gridScrollTop, setGridScrollTop] = useState(0);
  const [gridViewport, setGridViewport] = useState(480);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(fallbackSnapshot);
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [activeConnectionId, setActiveConnectionId] = useState(
    fallbackSnapshot.activeConnectionId,
  );
  const [query, setQuery] = useState(initialQuery);
  const [running, setRunning] = useState(false);
  // Id of the in-flight query so the Cancel button can stop that specific run.
  const runningQueryIdRef = useRef<string | null>(null);
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
  const [history, setHistory] = useState<QueryHistoryItem[]>(loadQueryHistory);
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

  useEffect(() => {
    window.localStorage.setItem(queryHistoryStorageKey, JSON.stringify(history));
  }, [history]);

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
  const scopedHistory = useMemo(
    () =>
      history
        .filter((item) => item.connectionId === activeConnectionId)
        .slice(0, 10),
    [activeConnectionId, history],
  );

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

  // Track the result grid's viewport height so the virtualized window covers it.
  useEffect(() => {
    const element = gridRef.current;
    if (!element) {
      return;
    }
    const measure = () => setGridViewport(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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

  // Virtualize the result grid: render only the rows in (and just around) the
  // viewport, with top/bottom spacers preserving the scrollbar. A 10k-row page is
  // ~30 DOM rows instead of 10k, so streaming stays smooth.
  const totalRows = resultCells.length;
  const firstVisible = Math.max(
    0,
    Math.floor(gridScrollTop / GRID_ROW_HEIGHT) - GRID_OVERSCAN,
  );
  const windowSize = Math.ceil(gridViewport / GRID_ROW_HEIGHT) + GRID_OVERSCAN * 2;
  const lastVisible = Math.min(totalRows, firstVisible + windowSize);
  const topPad = firstVisible * GRID_ROW_HEIGHT;
  const bottomPad = Math.max(0, (totalRows - lastVisible) * GRID_ROW_HEIGHT);
  const visibleCells = resultCells.slice(firstVisible, lastVisible);

  function onGridScroll(event: UIEvent<HTMLDivElement>) {
    const top = event.currentTarget.scrollTop;
    if (gridScrollRaf.current != null) {
      return;
    }
    gridScrollRaf.current = requestAnimationFrame(() => {
      gridScrollRaf.current = null;
      setGridScrollTop(top);
    });
  }

  const resultSummary = result
    ? `${toCount(result.rowCount)} rows${result.truncated ? " capped" : ""} in ${toCount(
        result.elapsedMs,
      )} ms`
    : "sample preview";

  function updateDraft(patch: Partial<ConnectionDraft>) {
    setDraft((current) => {
      const next = patch.engine
        ? { ...current, ...memoryDefaults(patch.engine), ...patch }
        : { ...current, ...patch };
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

  function appendHistory(item: QueryHistoryItem) {
    setHistory((current) => [item, ...current].slice(0, maxQueryHistoryItems));
  }

  function exportCsv() {
    if (!result) {
      return;
    }
    const blob = new Blob(["\uFEFF", csvFromResult(result)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadName(activeConnectionId);
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function runQuery() {
    if (!activeConnectionOpen) {
      setQueryError(`not connected: ${activeConnectionId}`);
      return;
    }
    const sqlToRun = selectedOrCurrentStatement(editorRef.current, query);
    if (!sqlToRun) {
      setQueryError("query is empty");
      return;
    }
    setRunning(true);
    setQueryError(null);
    // Start a fresh result at the top of the grid.
    if (gridRef.current) {
      gridRef.current.scrollTop = 0;
    }
    setGridScrollTop(0);
    const started = performance.now();
    const ranAt = new Date().toISOString();
    const queryId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    runningQueryIdRef.current = queryId;
    try {
      // Stream the run so the grid fills as batches arrive instead of waiting for
      // the whole result. Query errors surface as an "error" event (the command
      // itself resolves); the catch below only handles invoke-level failures.
      let columns: string[] = [];
      const rows: unknown[][] = [];
      await runQueryStream(
        { connectionId: activeConnectionId, sql: sqlToRun, maxRows: 10_000, queryId },
        (event) => {
          switch (event.type) {
            case "columns":
              columns = event.columns;
              setResult({
                columns,
                rows: [],
                rowCount: 0n,
                elapsedMs: 0n,
                truncated: false,
              });
              break;
            case "rows":
              for (const row of event.rows) {
                rows.push(row);
              }
              setResult({
                columns,
                rows: [...rows],
                rowCount: BigInt(rows.length),
                elapsedMs: BigInt(Math.round(performance.now() - started)),
                truncated: false,
              });
              break;
            case "done":
              setResult({
                columns,
                rows: [...rows],
                rowCount: BigInt(event.rowCount),
                elapsedMs: BigInt(event.elapsedMs),
                truncated: event.truncated,
              });
              appendHistory({
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                connectionId: activeConnectionId,
                connectionName: activeConnection.name,
                engine: activeConnection.engine,
                sql: sqlToRun,
                status: "ok",
                rowCount: event.rowCount,
                elapsedMs: event.elapsedMs,
                truncated: event.truncated,
                ranAt,
              });
              if (/^\s*(alter|create|drop|rename|truncate)\b/i.test(sqlToRun)) {
                void refreshObjects(activeConnectionId, true);
              }
              break;
            case "error":
              setQueryError(event.message);
              appendHistory({
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                connectionId: activeConnectionId,
                connectionName: activeConnection.name,
                engine: activeConnection.engine,
                sql: sqlToRun,
                status: "error",
                rowCount: 0,
                elapsedMs: Math.max(1, Math.round(performance.now() - started)),
                truncated: false,
                error: event.message,
                ranAt,
              });
              break;
          }
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setQueryError(message);
      appendHistory({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        connectionId: activeConnectionId,
        connectionName: activeConnection.name,
        engine: activeConnection.engine,
        sql: sqlToRun,
        status: "error",
        rowCount: 0,
        elapsedMs: Math.max(1, Math.round(performance.now() - started)),
        truncated: false,
        error: message,
        ranAt,
      });
    } finally {
      runningQueryIdRef.current = null;
      setRunning(false);
    }
  }

  // Ask the backend to stop the in-flight query; the pending run then rejects with
  // "query cancelled" and the runQuery catch/finally resets the UI.
  async function cancelQuery() {
    const id = runningQueryIdRef.current;
    if (!id) {
      return;
    }
    try {
      await dbCancel(id);
    } catch {
      // Best-effort: if the run already finished there is nothing to cancel.
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
          onClick={cancelQuery}
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
                  ref={editorRef}
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
                  <span>History</span>
                  <Clock3 size={14} />
                </div>
                <div className="history-list">
                  {scopedHistory.length > 0 ? (
                    scopedHistory.map((item) => (
                      <button
                        className={`history-item ${item.status}`}
                        key={item.id}
                        type="button"
                        title={item.status === "error" && item.error ? item.error : item.sql}
                        onClick={() => setQuery(item.sql)}
                      >
                        <strong>{compactSql(item.sql)}</strong>
                        <small>
                          <span>{formatHistoryTime(item.ranAt)}</span>
                          <span>
                            {item.status === "ok"
                              ? `${toCount(item.rowCount)} rows${
                                  item.truncated ? " capped" : ""
                                } · ${toCount(item.elapsedMs)} ms`
                              : "failed"}
                          </span>
                        </small>
                      </button>
                    ))
                  ) : (
                    <div className="empty-browser">No query history</div>
                  )}
                </div>
              </section>
              <section>
                <div className="section-heading">
                  <span>Commands</span>
                  <Layers3 size={14} />
                </div>
                <div className="command-list">
                  {commands.map((command) => (
                    <button
                      className="command-item"
                      key={command}
                      type="button"
                      onClick={
                        command === "Run current statement" ? runQuery : undefined
                      }
                    >
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
                <button
                  className="text-button"
                  type="button"
                  disabled={!result}
                  onClick={exportCsv}
                >
                  <Download size={13} />
                  <span>CSV</span>
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
            <div
              className="result-grid"
              role="table"
              aria-label="Query result"
              ref={gridRef}
              onScroll={onGridScroll}
            >
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
              {topPad > 0 ? (
                <div
                  className="grid-pad"
                  style={{ height: topPad }}
                  aria-hidden="true"
                />
              ) : null}
              {visibleCells.map((row, index) => {
                const rowIndex = firstVisible + index;
                return (
                  <div
                    className="grid-row"
                    role="row"
                    key={rowIndex}
                    style={{ gridTemplateColumns }}
                  >
                    {row.map((cell, cellIndex) => (
                      <span role="cell" key={`${cellIndex}-${cell}`}>
                        {cell}
                      </span>
                    ))}
                  </div>
                );
              })}
              {bottomPad > 0 ? (
                <div
                  className="grid-pad"
                  style={{ height: bottomPad }}
                  aria-hidden="true"
                />
              ) : null}
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
