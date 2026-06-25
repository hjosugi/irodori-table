import {
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  AlignLeft,
  Bolt,
  ChevronDown,
  Clock3,
  Columns3,
  Copy,
  Database,
  Download,
  ImageDown,
  KeyRound,
  Folder,
  Keyboard,
  Layers3,
  ListFilter,
  Maximize2,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Share2,
  Save,
  Search,
  ShieldCheck,
  SplitSquareHorizontal,
  Square,
  Sun,
  Table2,
  TerminalSquare,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { runQueryStream } from "./db-stream";
import {
  buildErdModel,
  hasDiagram,
  layoutErdModel,
  toMermaidErd,
  type ErdLayout,
} from "./erd";
import {
  downloadBlob,
  erdFileName,
  serializeSvgElement,
  svgMarkupToPngBlob,
  writePngBlobToClipboard,
  writeTextToClipboard,
} from "./erd-export";
import { ErdSvg, erdSvgStyle } from "./erd-svg";
import { errorMessage } from "./errors";
import {
  detectImportFileKind,
  generateImportSql,
  inferImportTableName,
  parseImportText,
  type ImportTextFormat,
  type ParsedImport,
} from "./importers";
import {
  KEY_SEQUENCE_TIMEOUT_MS,
  commandHasConflict,
  commandCatalog,
  effectiveKeymap,
  eventToChord,
  findConflicts,
  formatKeySequence,
  type CommandMeta,
  type KeybindingScope,
  type Keymap,
  loadOverrides,
  resolveKeybinding,
  saveOverrides,
} from "./keybindings";
import {
  buildResultExport,
  resultExportFileName,
  resultExportFormats,
  type ResultExportFormat,
} from "./result-export";
import {
  calculateResultGridVirtualColumnWindow,
  calculateResultGridVirtualRowWindow,
  cycleResultSortRules,
  formatResultGridTsv,
  formatResultGridTsvRow,
  resultFilterNeedsValue,
  resultFilterOperators,
  type ResultFilterJoin,
  type ResultFilterOperator,
  type ResultFilterRule,
  type ResultGridRowLike,
  type ResultSortRule,
} from "./result-grid";
import {
  buildResultGridViewModel,
  formatResultGridCell as formatCell,
  resultGridRowKey,
  type ResultGridDraftCell as GridCellDraft,
  type ResultGridRowOrigin,
} from "./result-view-model";
import {
  blankSchemaDraft,
  buildSchemaSql,
  schemaDraftFromObject,
  schemaDraftId,
  type SchemaColumnDraft,
  type SchemaDesignerDraft,
  type SchemaDesignerMode,
  type SchemaForeignKeyDraft,
  type SchemaIndexDraft,
} from "./schema-designer";
import {
  dbApplyEdits,
  dbCancel,
  dbConnect,
  dbDisconnect,
  dbListObjects,
  dbQueryParameters,
  type CellValue,
  type ConnectionInfo,
  type ConnectionProfile,
  type DatabaseMetadata,
  type DbEngine,
  type DbObjectMetadata,
  type QueryResult,
  type QueryResultSet,
  type QueryParameterInput,
  type QueryParameterPromptSet,
  type RowDelete,
  type RowInsert,
  type RowUpdate,
  type TableEdits,
  workspaceSnapshot,
  type WorkspaceSnapshot,
} from "./generated/irodori-api";
import SqlEditor, { type SqlEditorHandle } from "./SqlEditor";
import {
  formatterOptions,
  isSqlFormatterId,
  type SqlFormatterId,
} from "./sql/formatter";
import { selectedOrCurrentStatement } from "./sql/statements";
import {
  cssVariables,
  darkTheme,
  lightTheme,
  type ThemeKind,
} from "./theme";
import { RowDetailSidebar } from "./RowDetailSidebar";
import { findTableMetadata, parseSourceTable } from "./row-detail";
import "./App.css";

const resultCopyCommands: CommandMeta[] = [
  {
    id: "result.copySelection",
    title: "Copy selected cell or row",
    category: "Result",
    scope: "grid",
  },
  {
    id: "result.copyRow",
    title: "Copy selected row as TSV",
    category: "Result",
    scope: "grid",
  },
  {
    id: "result.copyVisible",
    title: "Copy visible result as TSV",
    category: "Result",
    scope: "grid",
  },
];

const appCommandCatalog: CommandMeta[] = [
  ...commandCatalog,
  ...resultCopyCommands,
];

const resultCopyDefaultKeymap: Keymap = {
  "result.copySelection": "Mod+C",
};

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
  { value: "neon", label: "Neon" },
  { value: "h2", label: "H2" },
  { value: "clickhouse", label: "ClickHouse" },
  { value: "neo4j", label: "Neo4j" },
  { value: "memgraph", label: "Memgraph" },
  { value: "influxdb", label: "InfluxDB" },
  { value: "qdrant", label: "Qdrant" },
  { value: "milvus", label: "Milvus" },
  { value: "pinecone", label: "Pinecone" },
  { value: "snowflake", label: "Snowflake" },
  { value: "bigquery", label: "Google BigQuery" },
  { value: "redis", label: "Redis" },
  { value: "cassandra", label: "Cassandra/ScyllaDB" },
  { value: "bigtable", label: "Google Cloud Bigtable" },
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
const queryParameterMemoryStorageKey = "irodori.queryParameters.v1";
const themeStorageKey = "irodori.theme.v1";
const vimModeStorageKey = "irodori.editor.vimMode.v1";
const formatterStorageKey = "irodori.editor.formatter.v1";
const sidebarStorageKey = "irodori.sidebar.open.v1";
const sidebarWidthStorageKey = "irodori.sidebar.width.v1";
const inspectorWidthStorageKey = "irodori.inspector.width.v1";
const resultsHeightStorageKey = "irodori.results.height.v1";

function loadThemeKind(): ThemeKind {
  return window.localStorage.getItem(themeStorageKey) === "light"
    ? "light"
    : "dark";
}

function loadVimMode() {
  return window.localStorage.getItem(vimModeStorageKey) === "true";
}

function loadFormatter(): SqlFormatterId {
  const stored = window.localStorage.getItem(formatterStorageKey);
  return isSqlFormatterId(stored) ? stored : "sql-formatter";
}

function loadSidebarOpen() {
  return window.localStorage.getItem(sidebarStorageKey) !== "false";
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function loadStoredNumber(
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const stored = Number(window.localStorage.getItem(key));
  return Number.isFinite(stored) ? clampNumber(stored, min, max) : fallback;
}

function keyScopeFromTarget(
  target: EventTarget | null,
  fallback: KeybindingScope,
): KeybindingScope {
  if (!(target instanceof HTMLElement)) {
    return fallback;
  }
  if (target.closest(".cm-host")) {
    return "editor";
  }
  if (target.closest(".result-grid")) {
    return "grid";
  }
  return "global";
}

function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function isCellEditorClipboardShortcut(
  event: KeyboardEvent,
  target: HTMLElement | null,
): boolean {
  return (
    !!target?.closest(".cell-editor") &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    ["c", "x", "v"].includes(event.key.toLowerCase())
  );
}

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

type QueryParameterMemory = Record<string, Record<string, string>>;

type PendingQueryParameters = {
  sql: string;
  promptSet: QueryParameterPromptSet;
};

type ImportPreview = ParsedImport & {
  fileName: string;
  format: ImportTextFormat;
  tableName: string;
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

// Parse pasted clipboard text (TSV, or CSV as a fallback) into a grid of strings.
function parseClipboardTable(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const delimiter = rows.some((row) => row.includes("\t")) ? "\t" : ",";
  return rows.map((row) => row.split(delimiter));
}

function toCount(value: bigint | number) {
  return Number(value).toLocaleString();
}

function objectKindLabel(object: DbObjectMetadata) {
  switch (object.kind) {
    case "view":
      return "view";
    case "function":
      return "function";
    case "procedure":
      return "procedure";
    case "index":
      return "index";
    default:
      return "table";
  }
}

type CompletionHint = {
  label: string;
  detail: string;
  insertText: string;
};

function completionHintsFromMetadata(
  metadata: DatabaseMetadata | undefined,
): CompletionHint[] {
  if (!metadata) {
    return [];
  }
  const relationHints = metadata.schemas.flatMap((schema) =>
    schema.objects
      .filter((object) => object.kind !== "index")
      .map((object) => {
        const qualifiedName = schema.name
          ? `${schema.name}.${object.name}`
          : object.name;
        return {
          label: object.name,
          detail: `${schema.name || "default"} ${objectKindLabel(object)}`,
          insertText:
            object.kind === "function" || object.kind === "procedure"
              ? `${qualifiedName}()`
              : qualifiedName,
        };
      }),
  );
  const columnHints = metadata.schemas.flatMap((schema) =>
    schema.objects
      .filter((object) => object.kind === "table" || object.kind === "view")
      .flatMap((object) =>
        object.columns.slice(0, 4).map((column) => ({
          label: `${object.name}.${column.name}`,
          detail: `${column.dataType}${column.nullable ? "" : " not null"}`,
          insertText: `${object.name}.${column.name}`,
        })),
      ),
  );
  return [...relationHints, ...columnHints].slice(0, 8);
}

function defaultPort(engine: DbEngine) {
  switch (engine) {
    case "postgres":
    case "timescaledb":
    case "neon":
      return "5432";
    case "cockroachdb":
      return "26257";
    case "yugabytedb":
      return "5433";
    case "redshift":
      return "5439";
    case "h2":
      return "5435";
    case "clickhouse":
      return "8123";
    case "snowflake":
    case "bigquery":
      return "443";
    case "redis":
      return "6379";
    case "cassandra":
      return "9042";
    case "neo4j":
    case "memgraph":
      return "7687";
    case "influxdb":
      return "8086";
    case "qdrant":
      return "6333";
    case "milvus":
      return "19530";
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

function loadQueryParameterMemory(): QueryParameterMemory {
  try {
    const raw = window.localStorage.getItem(queryParameterMemoryStorageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    const memory: QueryParameterMemory = {};
    for (const [signature, values] of Object.entries(parsed)) {
      if (!isRecord(values)) {
        continue;
      }
      const entry: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === "string") {
          entry[key] = value;
        }
      }
      memory[signature] = entry;
    }
    return memory;
  } catch {
    return {};
  }
}

function parseParameterValue(input: string): unknown {
  const trimmed = input.trim();
  if (trimmed === "null") {
    return null;
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isSafeInteger(value)) {
      return value;
    }
  }
  if (/^-?(?:\d+\.\d+|\d+e[+-]?\d+|\d+\.\d+e[+-]?\d+)$/i.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return input;
    }
  }
  return input;
}

function buildParameterInputs(
  promptSet: QueryParameterPromptSet,
  values: Record<string, string>,
): QueryParameterInput[] {
  return promptSet.prompts.map((prompt) => ({
    key: prompt.key,
    value: parseParameterValue(values[prompt.id] ?? ""),
  }));
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
    if (draft.engine === "pinecone") {
      return "Pinecone is selectable as a placeholder; a driver is not implemented yet";
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
const GRID_COLUMN_WIDTH = 148;
const GRID_COLUMN_OVERSCAN = 2;
const GRID_GUTTER_WIDTH = 34;
const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 420;
const INSPECTOR_WIDTH_MIN = 220;
const INSPECTOR_WIDTH_MAX = 420;
const RESULTS_HEIGHT_MIN = 150;
const RESULTS_HEIGHT_MAX = 520;

function App() {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const diagramSvgRef = useRef<SVGSVGElement | null>(null);
  const diagramCanvasRef = useRef<HTMLDivElement | null>(null);
  const gridScrollRaf = useRef<number | null>(null);
  const pendingGridScroll = useRef({ top: 0, left: 0 });
  const [gridScrollTop, setGridScrollTop] = useState(0);
  const [gridScrollLeft, setGridScrollLeft] = useState(0);
  const [gridViewportHeight, setGridViewportHeight] = useState(480);
  const [gridViewportWidth, setGridViewportWidth] = useState(900);
  const editorApiRef = useRef<SqlEditorHandle>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(fallbackSnapshot);
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [activeConnectionId, setActiveConnectionId] = useState(
    fallbackSnapshot.activeConnectionId,
  );
  const [query, setQuery] = useState(initialQuery);
  const [themeKind, setThemeKind] = useState<ThemeKind>(loadThemeKind);
  const theme = themeKind === "dark" ? darkTheme : lightTheme;
  const [vimMode, setVimMode] = useState(loadVimMode);
  const [formatter, setFormatter] = useState<SqlFormatterId>(loadFormatter);
  const [sidebarOpen, setSidebarOpen] = useState(loadSidebarOpen);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    loadStoredNumber(
      sidebarWidthStorageKey,
      272,
      SIDEBAR_WIDTH_MIN,
      SIDEBAR_WIDTH_MAX,
    ),
  );
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    loadStoredNumber(
      inspectorWidthStorageKey,
      285,
      INSPECTOR_WIDTH_MIN,
      INSPECTOR_WIDTH_MAX,
    ),
  );
  const [resultsHeight, setResultsHeight] = useState(() =>
    loadStoredNumber(
      resultsHeightStorageKey,
      228,
      RESULTS_HEIGHT_MIN,
      RESULTS_HEIGHT_MAX,
    ),
  );
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
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [queryError, setQueryError] = useState<string | null>(null);
  // SQL of the last run, used to infer the editable target table.
  const [lastRunSql, setLastRunSql] = useState<string>("");
  // Staged (non-immediate) result editing: changes accumulate until Commit.
  const [editMode, setEditMode] = useState(false);
  const [cellEdits, setCellEdits] = useState<Map<string, GridCellDraft>>(
    new Map(),
  );
  const [newRows, setNewRows] = useState<GridCellDraft[][]>([]);
  const [deletedRows, setDeletedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{
    key: string;
    col: number;
    seed?: string;
  } | null>(null);
  const [selectedCell, setSelectedCell] = useState<{
    key: string;
    col: number;
  } | null>(null);
  const [sortRules, setSortRules] = useState<ResultSortRule[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState("");
  const [filterJoin, setFilterJoin] = useState<ResultFilterJoin>("and");
  const [filterRules, setFilterRules] = useState<ResultFilterRule[]>([]);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  // Remappable keybindings: defaults merged with user overrides (localStorage).
  const [keymapOverrides, setKeymapOverrides] = useState<Keymap>(loadOverrides);
  const [activeKeyScope, setActiveKeyScope] =
    useState<KeybindingScope>("global");
  const [recordingCommand, setRecordingCommand] = useState<string | null>(null);
  const [recordingSequence, setRecordingSequence] = useState<string[]>([]);
  // Command palette (Ctrl/Cmd+Shift+P).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  // ER diagram modal (rendered from metadata through our SVG layout).
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [diagramError, setDiagramError] = useState<string | null>(null);
  const [diagramSearch, setDiagramSearch] = useState("");
  const [diagramSchemaNames, setDiagramSchemaNames] = useState<string[]>([]);
  const [diagramZoom, setDiagramZoom] = useState(1);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [schemaDesignerOpen, setSchemaDesignerOpen] = useState(false);
  const [schemaDraft, setSchemaDraft] = useState<SchemaDesignerDraft>(
    blankSchemaDraft,
  );
  const diagramInitializedFor = useRef<string | null>(null);
  const [history, setHistory] = useState<QueryHistoryItem[]>(loadQueryHistory);
  const [queryParameterMemory, setQueryParameterMemory] = useState<QueryParameterMemory>(
    loadQueryParameterMemory,
  );
  const [pendingQueryParameters, setPendingQueryParameters] =
    useState<PendingQueryParameters | null>(null);
  const [parameterDraftValues, setParameterDraftValues] = useState<
    Record<string, string>
  >({});
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

  useEffect(() => {
    window.localStorage.setItem(
      queryParameterMemoryStorageKey,
      JSON.stringify(queryParameterMemory),
    );
  }, [queryParameterMemory]);

  useEffect(() => {
    window.localStorage.setItem(themeStorageKey, themeKind);
  }, [themeKind]);

  useEffect(() => {
    window.localStorage.setItem(vimModeStorageKey, String(vimMode));
  }, [vimMode]);

  useEffect(() => {
    window.localStorage.setItem(formatterStorageKey, formatter);
  }, [formatter]);

  useEffect(() => {
    window.localStorage.setItem(sidebarStorageKey, String(sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    window.localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(inspectorWidthStorageKey, String(inspectorWidth));
  }, [inspectorWidth]);

  useEffect(() => {
    window.localStorage.setItem(resultsHeightStorageKey, String(resultsHeight));
  }, [resultsHeight]);

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
  const completionHints = useMemo(
    () => completionHintsFromMetadata(activeMetadata),
    [activeMetadata],
  );
  const scopedHistory = useMemo(
    () =>
      history
        .filter((item) => item.connectionId === activeConnectionId)
        .slice(0, 10),
    [activeConnectionId, history],
  );
  const availableDiagramSchemas = useMemo(
    () =>
      activeMetadata?.schemas
        .filter((schema) => schema.objects.some((object) => object.kind === "table"))
        .map((schema) => schema.name) ?? [],
    [activeMetadata],
  );
  const diagramModel = useMemo(
    () =>
      activeMetadata
        ? buildErdModel(activeMetadata, {
            schemaNames: diagramSchemaNames,
            search: diagramSearch,
          })
        : null,
    [activeMetadata, diagramSchemaNames, diagramSearch],
  );
  const diagramLayout = useMemo<ErdLayout | null>(
    () => (diagramModel ? layoutErdModel(diagramModel) : null),
    [diagramModel],
  );
  const diagramSvgStyle = useMemo(() => erdSvgStyle(theme), [theme]);
  const diagramMermaid = useMemo(
    () => (activeMetadata ? toMermaidErd(activeMetadata) : ""),
    [activeMetadata],
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

  // Track the result grid viewport so both row and column windows cover it.
  useEffect(() => {
    const element = gridRef.current;
    if (!element) {
      return;
    }
    const measure = () => {
      setGridViewportHeight(element.clientHeight);
      setGridViewportWidth(element.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [result]);

  // Dialect for the editor: prefer the active connection's profile engine,
  // then the connection-form draft, then Postgres.
  const editorEngine = useMemo<DbEngine>(() => {
    const profile = profiles.find((item) => item.id === activeConnectionId);
    return profile?.engine ?? draft.engine ?? "postgres";
  }, [profiles, activeConnectionId, draft.engine]);

  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label;

  const resultSets = useMemo<QueryResultSet[]>(() => {
    if (!result) {
      return [];
    }
    if (result.resultSets && result.resultSets.length > 0) {
      return result.resultSets;
    }
    return [
      {
        statementIndex: 0,
        statement: "statement 1",
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        elapsedMs: result.elapsedMs,
        truncated: result.truncated,
        message: result.message,
      },
    ];
  }, [result]);
  const activeResult =
    resultSets[Math.min(activeResultIndex, Math.max(0, resultSets.length - 1))] ??
    null;

  useEffect(() => {
    if (activeResultIndex >= resultSets.length) {
      setActiveResultIndex(0);
    }
  }, [activeResultIndex, resultSets.length]);

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.scrollTop = 0;
      gridRef.current.scrollLeft = 0;
    }
    setGridScrollTop(0);
    setGridScrollLeft(0);
    setSelectedRowKey(null);
    setSelectedCell(null);
  }, [activeResultIndex, result]);

  const resultColumns = activeResult?.columns ?? [
    "id",
    "name",
    "lifetime_value",
    "last_order_at",
  ];
  // Resolve which table the active result came from so foreign-key cells become
  // navigable in the row-detail drawer. Falls back to column matching; a null table
  // simply disables FK links while the rest of the detail view still works.
  const rowDetailTable = findTableMetadata(
    activeMetadata,
    parseSourceTable(query),
    resultColumns,
  );
  // The raw (unformatted) values of the selected original row. Staged "new" rows
  // (keys starting with "n") have no backing result row, so they have no detail view.
  const selectedRowValues =
    activeResult && selectedRowKey && selectedRowKey.startsWith("o")
      ? (activeResult.rows[Number(selectedRowKey.slice(1))] ?? null)
      : null;
  const gridGutterWidth = editMode ? GRID_GUTTER_WIDTH : 0;
  const gridTotalWidth = Math.max(
    1,
    gridGutterWidth + resultColumns.length * GRID_COLUMN_WIDTH,
  );
  const columnWindow = calculateResultGridVirtualColumnWindow({
    columnCount: resultColumns.length,
    scrollLeft: Math.max(0, gridScrollLeft - gridGutterWidth),
    viewportWidth: Math.max(0, gridViewportWidth - gridGutterWidth),
    columnWidth: GRID_COLUMN_WIDTH,
    overscan: GRID_COLUMN_OVERSCAN,
  });
  const firstVisibleColumn = columnWindow.firstColumnIndex;
  const lastVisibleColumn = columnWindow.lastColumnIndex;
  const visibleColumnIndexes = Array.from(
    { length: Math.max(0, lastVisibleColumn - firstVisibleColumn) },
    (_, index) => firstVisibleColumn + index,
  );
  const leftColumnPad = columnWindow.leftPadPx;
  const rightColumnPad = columnWindow.rightPadPx;
  // In Edit Data mode a leading gutter column holds the per-row delete control.
  const gridTemplateColumns = [
    editMode ? `${GRID_GUTTER_WIDTH}px` : null,
    leftColumnPad > 0 ? `${leftColumnPad}px` : null,
    ...visibleColumnIndexes.map(() => `${GRID_COLUMN_WIDTH}px`),
    rightColumnPad > 0 ? `${rightColumnPad}px` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const gridRowStyle: CSSProperties = {
    gridTemplateColumns,
    minWidth: gridTotalWidth,
    width: gridTotalWidth,
  };

  // Build the display rows from raw results plus staged edits, filters, and sort.
  const resultGridView = useMemo(
    () =>
      buildResultGridViewModel({
        rows: activeResult?.rows ?? resultRows,
        cellEdits,
        newRows,
        deletedRows,
        filterRules,
        quickFilter,
        filterJoin,
        sortRules,
      }),
    [
      activeResult?.rows,
      cellEdits,
      newRows,
      deletedRows,
      filterRules,
      quickFilter,
      filterJoin,
      sortRules,
    ],
  );
  const {
    activeFilters,
    displayRows,
    filteredOutCount,
    filtersActive,
    pendingCount,
    sortRuleByColumn,
    unfilteredRows,
  } = resultGridView;

  // Virtualize the result grid: render only the rows in (and just around) the
  // viewport, with top/bottom spacers preserving the scrollbar. A 10k-row page is
  // ~30 DOM rows instead of 10k, so streaming stays smooth.
  const totalRows = displayRows.length;
  const rowWindow = calculateResultGridVirtualRowWindow({
    rowCount: totalRows,
    scrollTop: gridScrollTop,
    viewportHeight: gridViewportHeight,
    rowHeight: GRID_ROW_HEIGHT,
    overscan: GRID_OVERSCAN,
  });
  const firstVisible = rowWindow.firstRowIndex;
  const lastVisible = rowWindow.lastRowIndex;
  const topPad = rowWindow.topPadPx;
  const bottomPad = rowWindow.bottomPadPx;
  const visibleRows = displayRows.slice(firstVisible, lastVisible);

  function onGridScroll(event: UIEvent<HTMLDivElement>) {
    pendingGridScroll.current = {
      top: event.currentTarget.scrollTop,
      left: event.currentTarget.scrollLeft,
    };
    if (gridScrollRaf.current != null) {
      return;
    }
    gridScrollRaf.current = requestAnimationFrame(() => {
      gridScrollRaf.current = null;
      setGridScrollTop(pendingGridScroll.current.top);
      setGridScrollLeft(pendingGridScroll.current.left);
    });
  }

  function resetGridScrollPosition(clearSelection = false) {
    if (gridRef.current) {
      gridRef.current.scrollTop = 0;
      gridRef.current.scrollLeft = 0;
    }
    setGridScrollTop(0);
    setGridScrollLeft(0);
    if (clearSelection) {
      setSelectedRowKey(null);
      setSelectedCell(null);
    }
  }

  type PanelResizeKind = "sidebar" | "inspector" | "results";

  function resizePanel(kind: PanelResizeKind, delta: number) {
    switch (kind) {
      case "sidebar":
        setSidebarWidth((current) =>
          clampNumber(current + delta, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX),
        );
        break;
      case "inspector":
        setInspectorWidth((current) =>
          clampNumber(current + delta, INSPECTOR_WIDTH_MIN, INSPECTOR_WIDTH_MAX),
        );
        break;
      case "results":
        setResultsHeight((current) =>
          clampNumber(current + delta, RESULTS_HEIGHT_MIN, RESULTS_HEIGHT_MAX),
        );
        break;
    }
  }

  function beginPanelResize(
    kind: PanelResizeKind,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSidebarWidth = sidebarWidth;
    const startInspectorWidth = inspectorWidth;
    const startResultsHeight = resultsHeight;
    document.body.classList.add("panel-resizing");

    const onMove = (moveEvent: PointerEvent) => {
      if (kind === "sidebar") {
        setSidebarWidth(
          clampNumber(
            startSidebarWidth + moveEvent.clientX - startX,
            SIDEBAR_WIDTH_MIN,
            SIDEBAR_WIDTH_MAX,
          ),
        );
        return;
      }
      if (kind === "inspector") {
        setInspectorWidth(
          clampNumber(
            startInspectorWidth - (moveEvent.clientX - startX),
            INSPECTOR_WIDTH_MIN,
            INSPECTOR_WIDTH_MAX,
          ),
        );
        return;
      }
      setResultsHeight(
        clampNumber(
          startResultsHeight - (moveEvent.clientY - startY),
          RESULTS_HEIGHT_MIN,
          RESULTS_HEIGHT_MAX,
        ),
      );
    };

    const onEnd = () => {
      document.body.classList.remove("panel-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
    window.addEventListener("pointercancel", onEnd, { once: true });
  }

  function onPanelResizeKey(
    kind: PanelResizeKind,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown"
    ) {
      return;
    }
    event.preventDefault();
    const step = event.shiftKey ? 32 : 16;
    if (kind === "results") {
      resizePanel(kind, event.key === "ArrowUp" ? step : -step);
      return;
    }
    const direction = kind === "sidebar" ? 1 : -1;
    resizePanel(kind, (event.key === "ArrowRight" ? step : -step) * direction);
  }

  // Drop every staged edit (called on a new run and after a successful commit).
  function resetEdits() {
    setCellEdits(new Map());
    setNewRows([]);
    setDeletedRows(new Set());
    setEditingCell(null);
    setSelectedCell(null);
    setCommitError(null);
  }

  function resetGridView() {
    setSortRules([]);
    setQuickFilter("");
    setFilterRules([]);
    setFilterJoin("and");
    setFiltersOpen(false);
  }

  function toggleSort(col: number, additive = false) {
    setSortRules((current) => cycleResultSortRules(current, col, additive));
    resetGridScrollPosition();
  }

  function addFilterRule(columnIndex: number | "any" = "any") {
    setFilterRules((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        columnIndex,
        operator: "contains",
        value: "",
        enabled: true,
      },
    ]);
    setFiltersOpen(true);
    resetGridScrollPosition(true);
  }

  function updateFilterRule(id: string, patch: Partial<ResultFilterRule>) {
    setFilterRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
    resetGridScrollPosition(true);
  }

  function removeFilterRule(id: string) {
    setFilterRules((current) => current.filter((rule) => rule.id !== id));
    resetGridScrollPosition(true);
  }

  function clearResultFilters() {
    setQuickFilter("");
    setFilterRules([]);
    setFilterJoin("and");
    resetGridScrollPosition(true);
  }

  function selectGridCell(rowKey: string, col: number) {
    setSelectedRowKey(rowKey);
    setSelectedCell({ key: rowKey, col });
    gridRef.current?.focus({ preventScroll: true });
  }

  function selectGridRow(rowKey: string, focusGrid = false) {
    setSelectedRowKey(rowKey);
    setSelectedCell(null);
    if (focusGrid) {
      gridRef.current?.focus({ preventScroll: true });
    }
  }

  function beginCellEdit(key: string, col: number, seed?: string) {
    if (!editMode) {
      return;
    }
    selectGridCell(key, col);
    setEditingCell(seed === undefined ? { key, col } : { key, col, seed });
  }

  // Stage a single cell's new value against its origin (an original row keeps the
  // edit in `cellEdits`; a staged new row mutates `newRows`).
  function setCellValue(
    origin: ResultGridRowOrigin,
    col: number,
    value: GridCellDraft,
  ) {
    if (origin.kind === "orig") {
      setCellEdits((current) => {
        const next = new Map(current);
        const key = `o${origin.index}:${col}`;
        const originalRaw = activeResult?.rows[origin.index]?.[col] ?? null;
        const unchanged =
          value === null ? originalRaw === null : value === formatCell(originalRaw);
        if (unchanged) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
        return next;
      });
    } else {
      setNewRows((current) =>
        current.map((row, index) => {
          if (index !== origin.index) {
            return row;
          }
          const next = [...row];
          next[col] = value;
          return next;
        }),
      );
    }
  }

  function addNewRow() {
    setNewRows((current) => [...current, resultColumns.map(() => "")]);
    setEditMode(true);
  }

  // Stage a row delete (original rows) or drop a staged new row.
  function deleteRow(origin: ResultGridRowOrigin) {
    const rowKey = resultGridRowKey(origin);
    if (origin.kind === "orig") {
      setDeletedRows((current) => new Set(current).add(origin.index));
      setCellEdits((current) => {
        const next = new Map(current);
        for (const key of [...next.keys()]) {
          if (key.startsWith(`o${origin.index}:`)) {
            next.delete(key);
          }
        }
        return next;
      });
    } else {
      setNewRows((current) => current.filter((_, index) => index !== origin.index));
    }
    setEditingCell(null);
    setSelectedRowKey((current) => (current === rowKey ? null : current));
  }

  // Paste a TSV/CSV block starting at `origin`/`startCol`, spilling across columns
  // and into staged new rows as needed.
  function pasteTableAt(origin: ResultGridRowOrigin, startCol: number, text: string) {
    const block = parseClipboardTable(text);
    if (block.length === 0) {
      return;
    }
    const orderedKeys = displayRows.map((row) => row.key);
    const startPos = orderedKeys.indexOf(resultGridRowKey(origin));
    block.forEach((cells, rowOffset) => {
      const targetKey = orderedKeys[startPos + rowOffset];
      const target = targetKey
        ? displayRows.find((row) => row.key === targetKey)?.origin
        : undefined;
      if (target) {
        cells.forEach((value, colOffset) => {
          const col = startCol + colOffset;
          if (col < resultColumns.length) {
            setCellValue(target, col, value);
          }
        });
      } else {
        // Past the last row: append as new rows.
        const newRow = resultColumns.map((_, col) => {
          const colOffset = col - startCol;
          return colOffset >= 0 && colOffset < cells.length ? cells[colOffset] : "";
        });
        setNewRows((current) => [...current, newRow]);
      }
    });
    setEditMode(true);
  }

  function scrollGridCellIntoView(rowIndex: number, col: number) {
    const element = gridRef.current;
    if (!element) {
      return;
    }
    const targetTop = rowIndex * GRID_ROW_HEIGHT;
    const targetBottom = targetTop + GRID_ROW_HEIGHT;
    let nextTop = element.scrollTop;
    if (targetTop < element.scrollTop) {
      nextTop = targetTop;
    } else if (targetBottom > element.scrollTop + element.clientHeight) {
      nextTop = targetBottom - element.clientHeight;
    }

    const targetLeft = gridGutterWidth + col * GRID_COLUMN_WIDTH;
    const targetRight = targetLeft + GRID_COLUMN_WIDTH;
    let nextLeft = element.scrollLeft;
    if (targetLeft < element.scrollLeft) {
      nextLeft = targetLeft;
    } else if (targetRight > element.scrollLeft + element.clientWidth) {
      nextLeft = targetRight - element.clientWidth;
    }

    element.scrollTop = Math.max(0, nextTop);
    element.scrollLeft = Math.max(0, nextLeft);
    setGridScrollTop(element.scrollTop);
    setGridScrollLeft(element.scrollLeft);
  }

  function moveSelectedCell(rowDelta: number, colDelta: number) {
    if (displayRows.length === 0 || resultColumns.length === 0) {
      return;
    }
    const currentKey = selectedCell?.key ?? selectedRowKey ?? displayRows[0].key;
    const currentRowIndex = Math.max(
      0,
      displayRows.findIndex((row) => row.key === currentKey),
    );
    const currentCol = selectedCell?.col ?? 0;
    const nextRowIndex = clampNumber(
      currentRowIndex + rowDelta,
      0,
      displayRows.length - 1,
    );
    const nextCol = clampNumber(
      currentCol + colDelta,
      0,
      Math.max(0, resultColumns.length - 1),
    );
    const nextRow = displayRows[nextRowIndex];
    if (!nextRow) {
      return;
    }
    selectGridCell(nextRow.key, nextCol);
    scrollGridCellIntoView(nextRowIndex, nextCol);
  }

  function selectedDisplayRow() {
    if (!selectedCell && !selectedRowKey) {
      return null;
    }
    const key = selectedCell?.key ?? selectedRowKey;
    return displayRows.find((row) => row.key === key) ?? null;
  }

  function selectedRowForCopy() {
    const key = selectedRowKey ?? selectedCell?.key;
    return key ? (displayRows.find((row) => row.key === key) ?? null) : null;
  }

  function copyCellsForRow(row: ResultGridRowLike): string[] {
    return resultColumns.map((_, index) => row.cells[index] ?? "");
  }

  function selectedGridCopyText(): string | null {
    if (selectedCell) {
      const row = displayRows.find((item) => item.key === selectedCell.key);
      if (row) {
        return row.cells[selectedCell.col] ?? "";
      }
    }
    const row = selectedRowForCopy();
    return row ? formatResultGridTsvRow(copyCellsForRow(row)) : null;
  }

  async function copyGridText(text: string | null) {
    if (text === null) {
      return;
    }
    try {
      await writeTextToClipboard(text);
    } catch (error) {
      setQueryError(errorMessage(error));
    }
  }

  async function copySelectedGridCellOrRow() {
    if (editingCell) {
      return;
    }
    await copyGridText(selectedGridCopyText());
  }

  async function copySelectedGridRow() {
    if (editingCell) {
      return;
    }
    const row = selectedRowForCopy();
    await copyGridText(row ? formatResultGridTsvRow(copyCellsForRow(row)) : null);
  }

  async function copyVisibleResult() {
    if (editingCell || resultColumns.length === 0) {
      return;
    }
    await copyGridText(formatResultGridTsv(resultColumns, displayRows));
  }

  function onGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ||
      editingCell
    ) {
      return;
    }
    const row = selectedDisplayRow() ?? displayRows[0];
    const col = selectedCell?.col ?? 0;
    if (!row || resultColumns.length === 0) {
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelectedCell(-1, 0);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelectedCell(1, 0);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelectedCell(0, -1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelectedCell(0, 1);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveSelectedCell(0, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      if (editMode) {
        event.preventDefault();
        beginCellEdit(row.key, col);
      }
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && editMode) {
      event.preventDefault();
      setCellValue(row.origin, col, event.ctrlKey || event.metaKey ? null : "");
      return;
    }
    if (
      editMode &&
      event.key.length === 1 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      beginCellEdit(row.key, col, event.key);
    }
  }

  function onGridPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    if (!editMode) {
      return;
    }
    const row = selectedDisplayRow();
    if (!row || !selectedCell) {
      return;
    }
    event.preventDefault();
    pasteTableAt(row.origin, selectedCell.col, event.clipboardData.getData("text"));
  }

  function onGridCopy(event: ReactClipboardEvent<HTMLDivElement>) {
    if (editingCell || isEditableTarget(event.target)) {
      return;
    }
    const text = selectedGridCopyText();
    if (text === null) {
      return;
    }
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  }

  // Infer the table to write back to from the last run's `from <table>` and the
  // key columns from its metadata (a unique index, else every result column).
  function inferEditTarget(): {
    schema?: string;
    table: string;
    keyColumns: string[];
  } | null {
    const match = lastRunSql.match(/\bfrom\s+([`"[\]\w.]+)/i);
    if (!match) {
      return null;
    }
    const raw = match[1].replace(/[`"[\]]/g, "");
    const parts = raw.split(".");
    const table = parts[parts.length - 1];
    const schema = parts.length > 1 ? parts[parts.length - 2] : undefined;
    if (!table) {
      return null;
    }
    const meta = metadataByConnection[activeConnectionId];
    const object = meta?.schemas
      .flatMap((s) => s.objects)
      .find((o) => o.name === table && (schema ? o.schema === schema : true));
    // Prefer the real primary key, then any unique index, then every column.
    const primaryKey = object?.primaryKey ?? [];
    const unique = object?.indexes.find((index) => index.unique);
    const candidate =
      primaryKey.length > 0
        ? primaryKey
        : unique
          ? unique.columns
          : resultColumns;
    const keyColumns = candidate.every((c) => resultColumns.includes(c))
      ? candidate
      : resultColumns;
    return { schema, table, keyColumns };
  }

  function originalCell(rowIndex: number, column: string): CellValue {
    const col = resultColumns.indexOf(column);
    return { column, value: activeResult?.rows[rowIndex]?.[col] ?? null };
  }

  async function commitEdits() {
    const target = inferEditTarget();
    if (!target) {
      setCommitError("could not detect an editable target table from the query");
      return;
    }
    const updates: RowUpdate[] = [];
    const editedByRow = new Map<number, number[]>();
    for (const key of cellEdits.keys()) {
      const [rowPart, colPart] = key.split(":");
      const rowIndex = Number(rowPart.slice(1));
      const list = editedByRow.get(rowIndex) ?? [];
      list.push(Number(colPart));
      editedByRow.set(rowIndex, list);
    }
    for (const [rowIndex, cols] of editedByRow) {
      updates.push({
        keys: target.keyColumns.map((column) => originalCell(rowIndex, column)),
        set: cols.map((col) => ({
          column: resultColumns[col],
          value:
            cellEdits.get(`o${rowIndex}:${col}`) === undefined
              ? null
              : cellEdits.get(`o${rowIndex}:${col}`)!,
        })),
      });
    }
    const inserts: RowInsert[] = newRows
      .filter((row) => row.some((cell) => cell !== ""))
      .map((row) => ({
        values: resultColumns
          .map((column, col) => ({ column, value: row[col] }))
          .filter((cell) => cell.value !== ""),
      }));
    const deletes: RowDelete[] = [...deletedRows].map((rowIndex) => ({
      keys: target.keyColumns.map((column) => originalCell(rowIndex, column)),
    }));
    const edits: TableEdits = {
      schema: target.schema,
      table: target.table,
      updates,
      inserts,
      deletes,
    };

    setCommitting(true);
    setCommitError(null);
    try {
      await dbApplyEdits(activeConnectionId, edits);
      resetEdits();
      setEditMode(false);
      // Re-run the last query so the grid shows the committed state.
      await runQuery();
    } catch (error) {
      setCommitError(errorMessage(error));
    } finally {
      setCommitting(false);
    }
  }

  // Run a command by id (the keybinding handler and the Commands list share this).
  function runCommand(id: string) {
    switch (id) {
      case "palette.open":
        setPaletteQuery("");
        setPaletteOpen(true);
        break;
      case "diagram.show":
        setDiagramOpen(true);
        break;
      case "query.run":
        void runQuery();
        break;
      case "query.cancel":
        void cancelQuery();
        break;
      case "editor.focus":
        editorApiRef.current?.focus();
        break;
      case "editor.format":
        formatQuery();
        break;
      case "editor.comment.toggle":
        editorApiRef.current?.toggleComment();
        break;
      case "result.export":
        exportActiveResult("csv");
        break;
      case "result.copySelection":
        void copySelectedGridCellOrRow();
        break;
      case "result.copyRow":
        void copySelectedGridRow();
        break;
      case "result.copyVisible":
        void copyVisibleResult();
        break;
      case "edit.toggle":
        setEditMode((mode) => !mode);
        break;
      case "edit.addRow":
        addNewRow();
        break;
      case "edit.commit":
        void commitEdits();
        break;
    }
  }

  const keymap = { ...resultCopyDefaultKeymap, ...effectiveKeymap(keymapOverrides) };
  const keymapConflicts = findConflicts(keymap, appCommandCatalog);
  const paletteResults = appCommandCatalog.filter((command) =>
    `${command.title} ${command.category}`
      .toLowerCase()
      .includes(paletteQuery.trim().toLowerCase()),
  );
  // Keep the keydown listener stable while reading the latest state via refs.
  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;
  const activeKeyScopeRef = useRef(activeKeyScope);
  activeKeyScopeRef.current = activeKeyScope;
  const recordingRef = useRef(recordingCommand);
  recordingRef.current = recordingCommand;
  const pendingKeySequenceRef = useRef<string[]>([]);
  const pendingKeyTimerRef = useRef<number | null>(null);
  const recordingSequenceRef = useRef<string[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  function clearPendingKeySequence() {
    pendingKeySequenceRef.current = [];
    if (pendingKeyTimerRef.current !== null) {
      window.clearTimeout(pendingKeyTimerRef.current);
      pendingKeyTimerRef.current = null;
    }
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function cancelRecording() {
    clearRecordingTimer();
    recordingRef.current = null;
    recordingSequenceRef.current = [];
    setRecordingCommand(null);
    setRecordingSequence([]);
  }

  function commitRecordedKeybinding(commandId: string, sequence: readonly string[]) {
    const chord = sequence.join(" ");
    if (!chord) {
      cancelRecording();
      return;
    }
    clearRecordingTimer();
    setKeymapOverrides((prev) => {
      const next = { ...prev, [commandId]: chord };
      saveOverrides(next);
      return next;
    });
    recordingRef.current = null;
    recordingSequenceRef.current = [];
    setRecordingCommand(null);
    setRecordingSequence([]);
  }

  function beginRecording(commandId: string) {
    if (recordingRef.current === commandId) {
      cancelRecording();
      return;
    }
    clearRecordingTimer();
    recordingRef.current = commandId;
    recordingSequenceRef.current = [];
    setRecordingCommand(commandId);
    setRecordingSequence([]);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Recording a rebind: one or two non-modifier chords become the new sequence.
      const recording = recordingRef.current;
      if (recording) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelRecording();
          return;
        }
        const chord = eventToChord(event);
        if (!chord) {
          return;
        }
        event.preventDefault();
        clearRecordingTimer();
        const next = [...recordingSequenceRef.current, chord];
        recordingSequenceRef.current = next;
        setRecordingSequence(next);
        if (next.length >= 2) {
          commitRecordedKeybinding(recording, next);
        } else {
          recordingTimerRef.current = window.setTimeout(() => {
            commitRecordedKeybinding(recording, recordingSequenceRef.current);
          }, KEY_SEQUENCE_TIMEOUT_MS);
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing && isCellEditorClipboardShortcut(event, target)) {
        return;
      }
      const scope = keyScopeFromTarget(target, activeKeyScopeRef.current);
      if (scope !== activeKeyScopeRef.current) {
        activeKeyScopeRef.current = scope;
        setActiveKeyScope(scope);
      }
      const chord = eventToChord(event);
      if (!chord) {
        return;
      }
      const map = keymapRef.current;
      const hadPending = pendingKeySequenceRef.current.length > 0;
      const resolution = resolveKeybinding({
        keymap: map,
        scope,
        chord,
        pending: pendingKeySequenceRef.current,
        commands: appCommandCatalog,
        allowBare: !typing,
      });
      if (resolution.kind === "pending") {
        event.preventDefault();
        pendingKeySequenceRef.current = resolution.pending;
        if (pendingKeyTimerRef.current !== null) {
          window.clearTimeout(pendingKeyTimerRef.current);
        }
        pendingKeyTimerRef.current = window.setTimeout(
          clearPendingKeySequence,
          KEY_SEQUENCE_TIMEOUT_MS,
        );
        return;
      }
      clearPendingKeySequence();
      if (resolution.kind === "command") {
        event.preventDefault();
        runCommandRef.current(resolution.commandId);
        return;
      }
      if (hadPending) {
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearPendingKeySequence();
      clearRecordingTimer();
    };
  }, []);

  // Initialize diagram filters per connection when the ERD modal opens.
  useEffect(() => {
    if (!diagramOpen) {
      diagramInitializedFor.current = null;
      return;
    }
    if (!activeMetadata || !hasDiagram(activeMetadata)) {
      setDiagramError("No tables to diagram yet — connect and load metadata first.");
      return;
    }
    setDiagramError(null);
    const initKey = `${activeConnectionId}:${activeMetadata.schemas
      .map((schema) => schema.name)
      .join("|")}`;
    if (diagramInitializedFor.current !== initKey) {
      setDiagramSchemaNames(
        activeMetadata.schemas
          .filter((schema) => schema.objects.some((object) => object.kind === "table"))
          .map((schema) => schema.name),
      );
      setDiagramSearch("");
      setDiagramZoom(1);
      diagramInitializedFor.current = initKey;
    }
  }, [activeConnectionId, activeMetadata, diagramOpen]);

  function resetKeybinding(commandId: string) {
    if (recordingCommand === commandId) {
      cancelRecording();
    }
    setKeymapOverrides((prev) => {
      const next = { ...prev };
      delete next[commandId];
      saveOverrides(next);
      return next;
    });
  }

  const resultSummary = activeResult
    ? `${toCount(activeResult.rowCount)} rows${activeResult.truncated ? " capped" : ""} in ${toCount(
        activeResult.elapsedMs,
      )} ms`
    : "sample preview";
  const displayedResultSummary =
    activeResult && filtersActive
      ? `${toCount(totalRows)} / ${toCount(unfilteredRows.length)} shown · ${resultSummary}`
      : resultSummary;
  const importSqlPreview = importPreview
    ? generateImportSql(
        importPreview.tableName,
        importPreview.columns,
        importPreview.rows,
      )
    : "";
  const schemaSqlPreview = buildSchemaSql(schemaDraft);

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
      setConnectionError(`Test succeeded for ${draft.name.trim()} (${engineLabel(draft.engine)})`);
    } catch (error) {
      setConnectionError(errorMessage(error));
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
      setConnectionError(errorMessage(error));
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
        [connectionId]: errorMessage(error),
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

  function exportActiveResult(format: ResultExportFormat) {
    if (!activeResult) {
      return;
    }
    const target = inferEditTarget();
    const exported = buildResultExport(activeResult, format, target?.table ?? "query_result");
    const blob = new Blob([exported.bom ? "\uFEFF" : "", exported.content], {
      type: exported.mime,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = resultExportFileName(activeConnectionId, format);
    document.body.append(link);
    link.click();
    link.remove();
    setExportMenuOpen(false);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function currentDiagramSvgMarkup() {
    const svg = diagramSvgRef.current;
    if (!svg || !diagramLayout) {
      throw new Error("No ERD is rendered");
    }
    return {
      markup: serializeSvgElement(svg),
      width: diagramLayout.width,
      height: diagramLayout.height,
    };
  }

  function downloadDiagramSvg() {
    try {
      const { markup } = currentDiagramSvgMarkup();
      downloadBlob(
        new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
        erdFileName(activeConnectionId, "svg"),
      );
      setDiagramError(null);
    } catch (error) {
      setDiagramError(errorMessage(error));
    }
  }

  async function downloadDiagramPng() {
    try {
      const { markup, width, height } = currentDiagramSvgMarkup();
      const blob = await svgMarkupToPngBlob(markup, width, height);
      downloadBlob(blob, erdFileName(activeConnectionId, "png"));
      setDiagramError(null);
    } catch (error) {
      setDiagramError(errorMessage(error));
    }
  }

  async function copyDiagramSvg() {
    try {
      const { markup } = currentDiagramSvgMarkup();
      await writeTextToClipboard(markup);
      setDiagramError(null);
    } catch (error) {
      setDiagramError(errorMessage(error));
    }
  }

  async function copyDiagramPng() {
    try {
      const { markup, width, height } = currentDiagramSvgMarkup();
      const blob = await svgMarkupToPngBlob(markup, width, height);
      await writePngBlobToClipboard(blob);
      setDiagramError(null);
    } catch (error) {
      setDiagramError(errorMessage(error));
    }
  }

  function fitDiagramToViewport() {
    if (!diagramLayout || !diagramCanvasRef.current) {
      return;
    }
    const bounds = diagramCanvasRef.current.getBoundingClientRect();
    const nextZoom = clampNumber(
      Math.min(bounds.width / diagramLayout.width, bounds.height / diagramLayout.height),
      0.25,
      1.25,
    );
    setDiagramZoom(nextZoom);
    window.requestAnimationFrame(() => {
      if (diagramCanvasRef.current) {
        diagramCanvasRef.current.scrollTop = 0;
        diagramCanvasRef.current.scrollLeft = 0;
      }
    });
  }

  async function handleImportFile(file: File) {
    const kind = detectImportFileKind(file.name);
    setImportPreview(null);
    setImportError(null);
    if (!kind) {
      setImportError("Unsupported import file type");
      return;
    }
    const text = await file.text();
    if (kind === "sql") {
      setQuery(text);
      return;
    }
    if (kind === "excel") {
      setImportError("Excel import is not available in the desktop UI yet");
      return;
    }
    try {
      const parsed = parseImportText(text, kind);
      setImportPreview({
        ...parsed,
        fileName: file.name,
        format: kind,
        tableName: inferImportTableName(file.name),
      });
    } catch (error) {
      setImportError(errorMessage(error));
    }
  }

  function putImportSqlInEditor() {
    if (!importPreview) {
      return;
    }
    setQuery(
      generateImportSql(
        importPreview.tableName,
        importPreview.columns,
        importPreview.rows,
      ),
    );
    setImportPreview(null);
    setImportError(null);
  }

  function openBlankSchemaDesigner() {
    setSchemaDraft(blankSchemaDraft());
    setSchemaDesignerOpen(true);
  }

  function openObjectSchemaDesigner(object: DbObjectMetadata) {
    setSchemaDraft(schemaDraftFromObject(object));
    setSchemaDesignerOpen(true);
  }

  function putSchemaSqlInEditor() {
    setQuery(buildSchemaSql(schemaDraft));
    setSchemaDesignerOpen(false);
  }

  function insertCompletionHint(hint: CompletionHint) {
    editorApiRef.current?.insertText(hint.insertText);
    editorApiRef.current?.focus();
  }

  function updateSchemaColumn(
    id: string,
    patch: Partial<SchemaColumnDraft>,
  ) {
    setSchemaDraft((current) => ({
      ...current,
      columns: current.columns.map((column) =>
        column.id === id ? { ...column, ...patch } : column,
      ),
    }));
  }

  function updateSchemaIndex(
    id: string,
    patch: Partial<SchemaIndexDraft>,
  ) {
    setSchemaDraft((current) => ({
      ...current,
      indexes: current.indexes.map((index) =>
        index.id === id ? { ...index, ...patch } : index,
      ),
    }));
  }

  function updateSchemaForeignKey(
    id: string,
    patch: Partial<SchemaForeignKeyDraft>,
  ) {
    setSchemaDraft((current) => ({
      ...current,
      foreignKeys: current.foreignKeys.map((foreignKey) =>
        foreignKey.id === id ? { ...foreignKey, ...patch } : foreignKey,
      ),
    }));
  }

  function formatQuery() {
    const error = editorApiRef.current?.format();
    setQueryError(error ?? null);
  }

  async function runQuery() {
    if (!activeConnectionOpen) {
      setQueryError(`not connected: ${activeConnectionId}`);
      return;
    }
    const selection = editorApiRef.current?.getSelection() ?? { from: 0, to: 0 };
    const sqlToRun = selectedOrCurrentStatement(selection.from, selection.to, query);
    if (!sqlToRun) {
      setQueryError("query is empty");
      return;
    }
    try {
      const promptSet = await dbQueryParameters(sqlToRun);
      if (promptSet.prompts.length > 0) {
        const remembered = queryParameterMemory[promptSet.signature] ?? {};
        setParameterDraftValues(
          Object.fromEntries(
            promptSet.prompts.map((prompt) => [prompt.id, remembered[prompt.id] ?? ""]),
          ),
        );
        setPendingQueryParameters({ sql: sqlToRun, promptSet });
        setQueryError(null);
        return;
      }
    } catch (error) {
      setQueryError(errorMessage(error));
      return;
    }
    await executeQuery(sqlToRun);
  }

  async function executeQuery(sqlToRun: string, params?: QueryParameterInput[]) {
    if (!activeConnectionOpen) {
      setQueryError(`not connected: ${activeConnectionId}`);
      return;
    }
    if (!sqlToRun.trim()) {
      setQueryError("query is empty");
      return;
    }
    setRunning(true);
    setQueryError(null);
    setLastRunSql(sqlToRun);
    setActiveResultIndex(0);
    // A new run invalidates any staged edits and resets the scroll/filter/sort view.
    resetEdits();
    resetGridView();
    if (gridRef.current) {
      gridRef.current.scrollTop = 0;
      gridRef.current.scrollLeft = 0;
    }
    setGridScrollTop(0);
    setGridScrollLeft(0);
    setSelectedRowKey(null);
    const started = performance.now();
    const ranAt = new Date().toISOString();
    const queryId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    runningQueryIdRef.current = queryId;
    try {
      // Stream the run so the grid fills as batches arrive instead of waiting for
      // the whole result. Query errors surface as an "error" event (the command
      // itself resolves); the catch below only handles invoke-level failures.
      const streamResultSets: QueryResultSet[] = [];
      const ensureResultSet = (index: number) => {
        while (streamResultSets.length <= index) {
          const statementIndex = streamResultSets.length;
          streamResultSets.push({
            statementIndex,
            statement: `statement ${statementIndex + 1}`,
            columns: [],
            rows: [],
            rowCount: 0n,
            elapsedMs: 0n,
            truncated: false,
          });
        }
        return streamResultSets[index];
      };
      const publishStreamResult = () => {
        const first = ensureResultSet(0);
        setResult({
          columns: first.columns,
          rows: [...first.rows],
          rowCount: first.rowCount,
          elapsedMs: first.elapsedMs,
          truncated: first.truncated,
          message: first.message,
          resultSets:
            streamResultSets.length > 1
              ? streamResultSets.map((set) => ({
                  ...set,
                  rows: [...set.rows],
                }))
              : undefined,
        });
      };
      await runQueryStream(
        {
          connectionId: activeConnectionId,
          sql: sqlToRun,
          maxRows: 10_000,
          queryId,
          params,
        },
        (event) => {
          switch (event.type) {
            case "columns":
              ensureResultSet(event.resultSetIndex).columns = event.columns;
              publishStreamResult();
              break;
            case "rows":
              {
                const set = ensureResultSet(event.resultSetIndex);
                set.rows.push(...event.rows);
                set.rowCount = BigInt(set.rows.length);
                set.elapsedMs = BigInt(Math.round(performance.now() - started));
              }
              publishStreamResult();
              break;
            case "done":
              for (const summary of event.resultSets) {
                const set = ensureResultSet(summary.resultSetIndex);
                set.rowCount = BigInt(summary.rowCount);
                set.elapsedMs = BigInt(summary.elapsedMs || event.elapsedMs);
                set.truncated = summary.truncated;
                set.message = summary.truncated ? "result capped at 10000 rows" : undefined;
              }
              publishStreamResult();
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
      const message = errorMessage(error);
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

  async function submitQueryParameters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending = pendingQueryParameters;
    if (!pending) {
      return;
    }
    const values = { ...parameterDraftValues };
    const params = buildParameterInputs(pending.promptSet, values);
    setQueryParameterMemory((current) => ({
      ...current,
      [pending.promptSet.signature]: values,
    }));
    setPendingQueryParameters(null);
    setParameterDraftValues({});
    await executeQuery(pending.sql, params);
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
    <main
      className="app-shell"
      style={
        {
          ...cssVariables(theme),
          "--sidebar-width": `${sidebarWidth}px`,
          "--inspector-width": `${inspectorWidth}px`,
          "--results-height": `${resultsHeight}px`,
        } as CSSProperties
      }
      data-theme={theme.kind}
      data-key-scope={activeKeyScope}
      onFocusCapture={(event) => {
        const scope = keyScopeFromTarget(event.target, "global");
        activeKeyScopeRef.current = scope;
        setActiveKeyScope(scope);
      }}
      onMouseDownCapture={(event) => {
        const scope = keyScopeFromTarget(event.target, activeKeyScope);
        activeKeyScopeRef.current = scope;
        setActiveKeyScope(scope);
      }}
    >
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
        <button
          className={vimMode ? "keymap-chip active" : "keymap-chip"}
          type="button"
          title={vimMode ? "Disable Vim mode" : "Enable Vim mode"}
          aria-pressed={vimMode}
          onClick={() => setVimMode((enabled) => !enabled)}
        >
          <Keyboard size={14} />
          <span>{vimMode ? "Vim" : "Keymap"}</span>
        </button>
        <button
          className="theme-toggle"
          type="button"
          title={
            themeKind === "dark"
              ? "Switch to light theme"
              : "Switch to dark theme"
          }
          aria-label="Toggle color theme"
          onClick={() =>
            setThemeKind((kind) => (kind === "dark" ? "light" : "dark"))
          }
        >
          {themeKind === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </header>

      <section className="toolbar" aria-label="Workspace toolbar">
        <button
          className="icon-button sidebar-toggle"
          type="button"
          title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          aria-pressed={!sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>
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
          title={`Format SQL (${formatter})`}
          aria-label="Format SQL"
          onClick={() => runCommand("editor.format")}
        >
          <AlignLeft size={15} />
        </button>
        <select
          className="formatter-select"
          aria-label="SQL formatter"
          value={formatter}
          onChange={(event) => {
            const next = event.target.value;
            if (isSqlFormatterId(next)) {
              setFormatter(next);
            }
          }}
        >
          {formatterOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          type="button"
          title="Toggle SQL comment"
          aria-label="Toggle SQL comment"
          onClick={() => runCommand("editor.comment.toggle")}
        >
          <TerminalSquare size={15} />
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

      <div className={sidebarOpen ? "workspace" : "workspace sidebar-collapsed"}>
        {sidebarOpen ? (
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
                title="Schema designer"
                aria-label="Schema designer"
                onClick={openBlankSchemaDesigner}
              >
                <Plus size={14} />
              </button>
              <button
                className="mini-button"
                type="button"
                title="ER diagram"
                aria-label="ER diagram"
                disabled={!hasDiagram(activeMetadata)}
                onClick={() => setDiagramOpen(true)}
              >
                <Share2 size={14} />
              </button>
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
                <div className="empty-browser loading" role="status">
                  Loading objects...
                </div>
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
                            {object.kind === "table" ? (
                              <button
                                className="metadata-row"
                                type="button"
                                title={`Design ${object.name}`}
                                onClick={() => openObjectSchemaDesigner(object)}
                              >
                                <KeyRound size={14} />
                                <span>Design table</span>
                                <small>alter / index / FK</small>
                              </button>
                            ) : null}
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
          <div
            className="panel-resizer sidebar-resizer"
            role="separator"
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={(event) => beginPanelResize("sidebar", event)}
            onKeyDown={(event) => onPanelResizeKey("sidebar", event)}
          />
        </aside>
        ) : null}

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
                <SqlEditor
                  ref={editorApiRef}
                  value={query}
                  onChange={setQuery}
                  engine={editorEngine}
                  metadata={activeMetadata}
                  theme={theme}
                  vimMode={vimMode}
                  formatter={formatter}
                />
              </div>
            </section>

            <div
              className="panel-resizer inspector-resizer"
              role="separator"
              aria-label="Resize inspector"
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={(event) => beginPanelResize("inspector", event)}
              onKeyDown={(event) => onPanelResizeKey("inspector", event)}
            />
            <aside className="inspector">
              <section>
                <div className="section-heading">
                  <span>Completion</span>
                  <Columns3 size={14} />
                </div>
                <div className="completion-list">
                  {activeMetadataLoading ? (
                    <div className="empty-browser loading">Loading metadata</div>
                  ) : activeMetadataError ? (
                    <div className="empty-browser">
                      <AlertTriangle size={14} />
                      <span>{activeMetadataError}</span>
                    </div>
                  ) : completionHints.length > 0 ? (
                    completionHints.map((item) => (
                      <button
                        className="completion-item"
                        key={`${item.detail}:${item.label}`}
                        onClick={() => insertCompletionHint(item)}
                      >
                        <strong>{item.label}</strong>
                        <small>{item.detail}</small>
                      </button>
                    ))
                  ) : (
                    <div className="empty-browser">Connect to load completion metadata</div>
                  )}
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
                  <span>Keybindings</span>
                  <Layers3 size={14} />
                </div>
                <div className="command-list">
                  {appCommandCatalog.map((command) => {
                    const chord = keymap[command.id];
                    const conflicted = commandHasConflict(
                      keymapConflicts,
                      command.id,
                    );
                    const recording = recordingCommand === command.id;
                    const recordingLabel =
                      recordingSequence.length > 0
                        ? `${formatKeySequence(recordingSequence.join(" "))} ...`
                        : "Press keys...";
                    return (
                      <div className="command-item" key={command.id}>
                        <button
                          className="command-run"
                          type="button"
                          onClick={() => runCommand(command.id)}
                          title={`Run: ${command.title}`}
                        >
                          {command.title}
                        </button>
                        <small className={`command-scope ${command.scope}`}>
                          {command.scope}
                        </small>
                        <button
                          className={`command-chord${conflicted ? " conflict" : ""}`}
                          type="button"
                          title={
                            recording
                              ? "Press one or two chords for the new shortcut"
                              : conflicted
                                ? "Shortcut conflict — click to rebind"
                                : "Click to rebind"
                          }
                          onClick={() => beginRecording(command.id)}
                        >
                          {recording
                            ? recordingLabel
                            : chord
                              ? formatKeySequence(chord)
                              : "unset"}
                        </button>
                        {keymapOverrides[command.id] ? (
                          <button
                            className="command-reset"
                            type="button"
                            title="Reset to default"
                            onClick={() => resetKeybinding(command.id)}
                          >
                            ↺
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            </aside>
          </div>

          <section className={running ? "results-pane is-running" : "results-pane"}>
            <div
              className="panel-resizer results-resizer"
              role="separator"
              aria-label="Resize results"
              aria-orientation="horizontal"
              tabIndex={0}
              onPointerDown={(event) => beginPanelResize("results", event)}
              onKeyDown={(event) => onPanelResizeKey("results", event)}
            />
            <div className="results-header">
              <div className="results-title">
                {resultSets.length > 1 ? (
                  <div className="result-tabs" role="tablist" aria-label="Result sets">
                    {resultSets.map((set, index) => (
                      <button
                        key={set.statementIndex}
                        type="button"
                        role="tab"
                        aria-selected={index === activeResultIndex}
                        className={index === activeResultIndex ? "active" : undefined}
                        title={set.statement}
                        onClick={() => {
                          setActiveResultIndex(index);
                          resetEdits();
                          resetGridView();
                          if (gridRef.current) {
                            gridRef.current.scrollTop = 0;
                            gridRef.current.scrollLeft = 0;
                          }
                          setGridScrollTop(0);
                          setGridScrollLeft(0);
                          setSelectedRowKey(null);
                          setSelectedCell(null);
                        }}
                      >
                        Result {index + 1}
                      </button>
                    ))}
                  </div>
                ) : (
                  <strong>Result 1</strong>
                )}
                <span>
                  {queryError
                    ? "failed"
                    : pendingCount > 0
                      ? `${displayedResultSummary} · ${pendingCount} pending`
                      : displayedResultSummary}
                </span>
              </div>
              <div className="results-actions">
                <label className="result-quick-filter">
                  <Search size={13} />
                  <input
                    aria-label="Quick result filter"
                    value={quickFilter}
                    disabled={!activeResult}
                    placeholder="Filter rows"
                    onChange={(event) => {
                      setQuickFilter(event.currentTarget.value);
                      resetGridScrollPosition(true);
                    }}
                  />
                  {quickFilter ? (
                    <button
                      type="button"
                      aria-label="Clear quick filter"
                      title="Clear quick filter"
                      onClick={() => {
                        setQuickFilter("");
                        resetGridScrollPosition(true);
                      }}
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </label>
                <button
                  className={`text-button${filtersOpen || filtersActive ? " active" : ""}`}
                  type="button"
                  disabled={!activeResult}
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <ListFilter size={13} />
                  <span>
                    {activeFilters.length > 0 ? `Filter ${activeFilters.length}` : "Filter"}
                  </span>
                </button>
                <div className="action-split">
                  <button
                    className="text-button"
                    type="button"
                    disabled={!activeResult}
                    onClick={() => exportActiveResult("csv")}
                  >
                    <Download size={13} />
                    <span>CSV</span>
                  </button>
                  <button
                    className="mini-button"
                    type="button"
                    title="Export formats"
                    aria-label="Export formats"
                    disabled={!activeResult}
                    onClick={() => setExportMenuOpen((open) => !open)}
                  >
                    <ChevronDown size={13} />
                  </button>
                  {exportMenuOpen ? (
                    <div className="action-menu" role="menu">
                      {resultExportFormats.map((format) => (
                        <button
                          key={format.id}
                          type="button"
                          role="menuitem"
                          title={format.title}
                          onClick={() => exportActiveResult(format.id)}
                        >
                          <span>{format.label}</span>
                          <small>.{buildResultExport({ columns: [], rows: [] }, format.id).extension}</small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  className="text-button"
                  type="button"
                  disabled={!activeResult}
                  onClick={() => void copyVisibleResult()}
                >
                  <Copy size={13} />
                  <span>Copy TSV</span>
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => importFileRef.current?.click()}
                >
                  <Upload size={13} />
                  <span>Import</span>
                </button>
                <input
                  ref={importFileRef}
                  className="hidden-file-input"
                  type="file"
                  accept=".csv,.tsv,.tab,.json,.jsonl,.ndjson,.sql,.xls,.xlsx"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) {
                      void handleImportFile(file);
                    }
                  }}
                />
                {editMode ? (
                  <>
                    <button
                      className="text-button"
                      type="button"
                      disabled={!result}
                      onClick={addNewRow}
                    >
                      + Row
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      disabled={pendingCount === 0 || committing}
                      onClick={() => void commitEdits()}
                    >
                      {committing ? "Committing…" : `Commit${pendingCount ? ` (${pendingCount})` : ""}`}
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        resetEdits();
                        setEditMode(false);
                      }}
                    >
                      Discard
                    </button>
                  </>
                ) : (
                  <button
                    className="text-button"
                    type="button"
                    disabled={!result}
                    onClick={() => setEditMode(true)}
                  >
                    Edit Data
                  </button>
                )}
              </div>
            </div>
            {commitError ? (
              <div className="result-error" role="alert">
                <AlertTriangle size={16} />
                <span>{commitError}</span>
              </div>
            ) : null}
            {queryError ? (
              <div className="result-error" role="alert">
                <AlertTriangle size={16} />
                <span>{queryError}</span>
              </div>
            ) : null}
            {filtersOpen || filterRules.length > 0 ? (
              <div className="result-filter-panel">
                <div className="result-filter-toolbar">
                  <span>
                    {filtersActive
                      ? `${toCount(filteredOutCount)} hidden`
                      : "No active filters"}
                  </span>
                  <div className="segmented-control" role="group" aria-label="Filter join">
                    <button
                      type="button"
                      className={filterJoin === "and" ? "active" : undefined}
                      onClick={() => setFilterJoin("and")}
                    >
                      AND
                    </button>
                    <button
                      type="button"
                      className={filterJoin === "or" ? "active" : undefined}
                      onClick={() => setFilterJoin("or")}
                    >
                      OR
                    </button>
                  </div>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => addFilterRule("any")}
                  >
                    <Plus size={13} />
                    <span>Rule</span>
                  </button>
                  {filtersActive ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={clearResultFilters}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                {filterRules.length > 0 ? (
                  <div className="result-filter-rules">
                    {filterRules.map((rule) => {
                      const needsValue = resultFilterNeedsValue(rule.operator);
                      return (
                        <div className="result-filter-rule" key={rule.id}>
                          <label className="check-cell compact">
                            <input
                              type="checkbox"
                              checked={rule.enabled}
                              aria-label="Filter enabled"
                              onChange={(event) =>
                                updateFilterRule(rule.id, {
                                  enabled: event.currentTarget.checked,
                                })
                              }
                            />
                          </label>
                          <select
                            aria-label="Filter column"
                            value={
                              rule.columnIndex === "any"
                                ? "any"
                                : String(rule.columnIndex)
                            }
                            onChange={(event) =>
                              updateFilterRule(rule.id, {
                                columnIndex:
                                  event.currentTarget.value === "any"
                                    ? "any"
                                    : Number(event.currentTarget.value),
                              })
                            }
                          >
                            <option value="any">Any column</option>
                            {resultColumns.map((column, index) => (
                              <option value={index} key={`${column}-${index}`}>
                                {column}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label="Filter operator"
                            value={rule.operator}
                            onChange={(event) =>
                              updateFilterRule(rule.id, {
                                operator: event.currentTarget
                                  .value as ResultFilterOperator,
                              })
                            }
                          >
                            {resultFilterOperators.map((operator) => (
                              <option key={operator.value} value={operator.value}>
                                {operator.label}
                              </option>
                            ))}
                          </select>
                          {needsValue ? (
                            <input
                              aria-label="Filter value"
                              value={rule.value}
                              onChange={(event) =>
                                updateFilterRule(rule.id, {
                                  value: event.currentTarget.value,
                                })
                              }
                            />
                          ) : (
                            <span className="filter-value-placeholder">--</span>
                          )}
                          <button
                            className="mini-button"
                            type="button"
                            title="Remove filter"
                            aria-label="Remove filter"
                            onClick={() => removeFilterRule(rule.id)}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="result-body">
            <div
              className="result-grid"
              role="table"
              aria-label="Query result"
              aria-rowcount={totalRows + 1}
              aria-colcount={resultColumns.length + (editMode ? 1 : 0)}
              ref={gridRef}
              tabIndex={0}
              onScroll={onGridScroll}
              onKeyDown={onGridKeyDown}
              onPaste={onGridPaste}
              onCopy={onGridCopy}
            >
              <div
                className="grid-row header"
                role="row"
                style={gridRowStyle}
              >
                {editMode ? <span className="grid-gutter" aria-hidden="true" /> : null}
                {leftColumnPad > 0 ? (
                  <span className="grid-col-pad" aria-hidden="true" />
                ) : null}
                {visibleColumnIndexes.map((colIndex) => {
                  const column = resultColumns[colIndex];
                  const sortRule = sortRuleByColumn.get(colIndex);
                  return (
                    <span
                      role="columnheader"
                      aria-colindex={editMode ? colIndex + 2 : colIndex + 1}
                      key={`${column}-${colIndex}`}
                      className={`sortable${sortRule ? " sorted" : ""}`}
                      title="Click to sort. Shift-click to add a sort key."
                      onClick={(event) => toggleSort(colIndex, event.shiftKey)}
                    >
                      <b className="column-label">{column}</b>
                      {sortRule ? (
                        <em className="sort-indicator">
                          {sortRule.direction === "asc" ? "▲" : "▼"}
                          {sortRules.length > 1 ? (
                            <small>{sortRule.priority}</small>
                          ) : null}
                        </em>
                      ) : null}
                    </span>
                  );
                })}
                {rightColumnPad > 0 ? (
                  <span className="grid-col-pad" aria-hidden="true" />
                ) : null}
              </div>
              {topPad > 0 ? (
                <div
                  className="grid-pad"
                  style={{ height: topPad, minWidth: gridTotalWidth, width: gridTotalWidth }}
                  aria-hidden="true"
                />
              ) : null}
              {running && totalRows === 0 ? (
                <div
                  className="grid-state loading"
                  role="status"
                  style={{ minWidth: gridTotalWidth, width: gridTotalWidth }}
                >
                  Running query...
                </div>
              ) : null}
              {!running && totalRows === 0 ? (
                <div
                  className="grid-state"
                  role="row"
                  style={{ minWidth: gridTotalWidth, width: gridTotalWidth }}
                >
                  {filtersActive && unfilteredRows.length > 0
                    ? "No rows match filters"
                    : "No rows returned"}
                </div>
              ) : null}
              {visibleRows.map((row, visibleRowIndex) => (
                <div
                  className={`grid-row${row.state === "new" ? " row-new" : row.state === "edited" ? " row-edited" : ""}${selectedRowKey === row.key ? " row-selected" : ""}`}
                  role="row"
                  aria-selected={selectedRowKey === row.key}
                  aria-rowindex={firstVisible + visibleRowIndex + 2}
                  key={row.key}
                  tabIndex={0}
                  style={gridRowStyle}
                  onClick={() => selectGridRow(row.key, true)}
                  onFocus={() => selectGridRow(row.key)}
                >
                  {editMode ? (
                    <button
                      className="grid-gutter delete-row"
                      type="button"
                      title="Delete row"
                      aria-label="Delete row"
                      onClick={() => deleteRow(row.origin)}
                    >
                      ×
                    </button>
                  ) : null}
                  {leftColumnPad > 0 ? (
                    <span className="grid-col-pad" aria-hidden="true" />
                  ) : null}
                  {visibleColumnIndexes.map((cellIndex) => {
                    const cell = row.cells[cellIndex] ?? "";
                    const isEditing =
                      editingCell?.key === row.key && editingCell.col === cellIndex;
                    const isEdited =
                      row.origin.kind === "orig" &&
                      cellEdits.has(`o${row.origin.index}:${cellIndex}`);
                    const isSelected =
                      selectedCell?.key === row.key && selectedCell.col === cellIndex;
                    const cellClass = [
                      isEdited ? "cell-edited" : "",
                      isSelected ? "cell-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <span
                        role="cell"
                        key={cellIndex}
                        aria-colindex={editMode ? cellIndex + 2 : cellIndex + 1}
                        aria-selected={isSelected}
                        className={cellClass || undefined}
                        title={cell}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectGridCell(row.key, cellIndex);
                        }}
                        onDoubleClick={() => {
                          beginCellEdit(row.key, cellIndex);
                        }}
                        onPaste={(event) => {
                          if (!editMode) {
                            return;
                          }
                          event.preventDefault();
                          pasteTableAt(
                            row.origin,
                            cellIndex,
                            event.clipboardData.getData("text"),
                          );
                        }}
                      >
                        {isEditing ? (
                          <div className="cell-editor">
                            <input
                              className="cell-input"
                              autoFocus
                              defaultValue={editingCell?.seed ?? cell}
                              onBlur={(event) => {
                                setCellValue(row.origin, cellIndex, event.target.value);
                                setEditingCell(null);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  setCellValue(
                                    row.origin,
                                    cellIndex,
                                    event.currentTarget.value,
                                  );
                                  setEditingCell(null);
                                } else if (event.key === "Escape") {
                                  setEditingCell(null);
                                } else if (
                                  event.key === "Backspace" &&
                                  (event.ctrlKey || event.metaKey)
                                ) {
                                  event.preventDefault();
                                  setCellValue(row.origin, cellIndex, null);
                                  setEditingCell(null);
                                }
                              }}
                            />
                            <button
                              type="button"
                              title="Set NULL"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setCellValue(row.origin, cellIndex, null);
                                setEditingCell(null);
                              }}
                            >
                              NULL
                            </button>
                          </div>
                        ) : (
                          cell
                        )}
                      </span>
                    );
                  })}
                  {rightColumnPad > 0 ? (
                    <span className="grid-col-pad" aria-hidden="true" />
                  ) : null}
                </div>
              ))}
              {bottomPad > 0 ? (
                <div
                  className="grid-pad"
                  style={{
                    height: bottomPad,
                    minWidth: gridTotalWidth,
                    width: gridTotalWidth,
                  }}
                  aria-hidden="true"
                />
              ) : null}
            </div>
            {selectedRowValues ? (
              <RowDetailSidebar
                columns={resultColumns}
                values={selectedRowValues}
                table={rowDetailTable}
                metadata={activeMetadata}
                engine={editorEngine}
                connectionId={activeConnectionId}
                onClose={() => setSelectedRowKey(null)}
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

      {pendingQueryParameters ? (
        <div
          className="palette-overlay"
          onClick={() => setPendingQueryParameters(null)}
          role="presentation"
        >
          <form
            className="parameter-dialog"
            role="dialog"
            aria-label="Query parameters"
            onSubmit={submitQueryParameters}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="parameter-header">
              <KeyRound size={16} />
              <strong>Query Parameters</strong>
              <span>{compactSql(pendingQueryParameters.sql, 68)}</span>
            </div>
            <div className="parameter-list">
              {pendingQueryParameters.promptSet.prompts.map((prompt, index) => (
                <label className="parameter-row" key={prompt.id}>
                  <span>
                    <strong>{prompt.label}</strong>
                    <small>{prompt.placeholder}</small>
                  </span>
                  <input
                    autoFocus={index === 0}
                    value={parameterDraftValues[prompt.id] ?? ""}
                    onChange={(event) =>
                      setParameterDraftValues((current) => ({
                        ...current,
                        [prompt.id]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="parameter-actions">
              <button
                className="text-button"
                type="button"
                onClick={() => setPendingQueryParameters(null)}
              >
                Cancel
              </button>
              <button className="primary-button" type="submit">
                <Play size={14} />
                Run
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {paletteOpen ? (
        <div
          className="palette-overlay"
          onClick={() => setPaletteOpen(false)}
          role="presentation"
        >
          <div
            className="palette"
            role="dialog"
            aria-label="Command palette"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              className="palette-input"
              autoFocus
              placeholder="Type a command…"
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setPaletteOpen(false);
                } else if (event.key === "Enter") {
                  const first = paletteResults[0];
                  if (first) {
                    setPaletteOpen(false);
                    runCommand(first.id);
                  }
                }
              }}
            />
            <div className="palette-list">
              {paletteResults.length > 0 ? (
                paletteResults.map((command) => (
                  <button
                    key={command.id}
                    className="palette-item"
                    type="button"
                    onClick={() => {
                      setPaletteOpen(false);
                      runCommand(command.id);
                    }}
                  >
                    <span>{command.title}</span>
                    <small>{command.category}</small>
                    {keymap[command.id] ? (
                      <kbd>{formatKeySequence(keymap[command.id])}</kbd>
                    ) : null}
                  </button>
                ))
              ) : (
                <div className="palette-empty">No matching commands</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {importPreview || importError ? (
        <div
          className="palette-overlay"
          onClick={() => {
            setImportPreview(null);
            setImportError(null);
          }}
          role="presentation"
        >
          <div
            className="data-dialog import-dialog"
            role="dialog"
            aria-label="Import preview"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <strong>Import</strong>
              <span>
                {importPreview
                  ? `${importPreview.fileName} · ${importPreview.format.toUpperCase()}`
                  : "File"}
              </span>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setImportPreview(null);
                  setImportError(null);
                }}
              >
                Close
              </button>
            </div>
            {importError ? (
              <div className="dialog-body">
                <div className="result-error" role="alert">
                  <AlertTriangle size={16} />
                  <span>{importError}</span>
                </div>
              </div>
            ) : null}
            {importPreview ? (
              <>
                <div className="dialog-body">
                  <div className="dialog-form-row">
                    <label>
                      <span>Table</span>
                      <input
                        value={importPreview.tableName}
                        onChange={(event) =>
                          setImportPreview((current) =>
                            current
                              ? { ...current, tableName: event.currentTarget.value }
                              : current,
                          )
                        }
                      />
                    </label>
                    <span className="dialog-stat">
                      {toCount(importPreview.rows.length)} / {toCount(importPreview.totalRows)} rows
                      {importPreview.truncated ? " capped" : ""}
                    </span>
                  </div>
                  <div className="preview-table-wrap">
                    <table className="preview-table">
                      <thead>
                        <tr>
                          {importPreview.columns.map((column, index) => (
                            <th key={`${column}-${index}`}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.rows.slice(0, 8).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {importPreview.columns.map((_, columnIndex) => (
                              <td key={columnIndex}>{formatCell(row[columnIndex])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <pre className="sql-preview">{importSqlPreview}</pre>
                </div>
                <div className="dialog-footer">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(importSqlPreview)}
                  >
                    Copy SQL
                  </button>
                  <button
                    className="primary-action"
                    type="button"
                    onClick={putImportSqlInEditor}
                  >
                    Put SQL in editor
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {schemaDesignerOpen ? (
        <div
          className="palette-overlay"
          onClick={() => setSchemaDesignerOpen(false)}
          role="presentation"
        >
          <div
            className="data-dialog schema-dialog"
            role="dialog"
            aria-label="Schema designer"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <strong>Schema Designer</strong>
              <span>
                {schemaDraft.mode === "create" ? "CREATE TABLE" : "ALTER TABLE"}
              </span>
              <button
                className="text-button"
                type="button"
                onClick={() => setSchemaDesignerOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="dialog-body schema-body">
              <div className="dialog-form-row schema-target">
                <label>
                  <span>Mode</span>
                  <select
                    value={schemaDraft.mode}
                    onChange={(event) =>
                      setSchemaDraft((current) => ({
                        ...current,
                        mode: event.currentTarget.value as SchemaDesignerMode,
                      }))
                    }
                  >
                    <option value="create">Create</option>
                    <option value="alter">Alter</option>
                  </select>
                </label>
                <label>
                  <span>Schema</span>
                  <input
                    value={schemaDraft.schema}
                    onChange={(event) =>
                      setSchemaDraft((current) => ({
                        ...current,
                        schema: event.currentTarget.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>Table</span>
                  <input
                    value={schemaDraft.table}
                    onChange={(event) =>
                      setSchemaDraft((current) => ({
                        ...current,
                        table: event.currentTarget.value,
                      }))
                    }
                  />
                </label>
              </div>

              <section className="designer-section">
                <header>
                  <strong>Columns</strong>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setSchemaDraft((current) => ({
                        ...current,
                        columns: [
                          ...current.columns,
                          {
                            id: schemaDraftId("column"),
                            name: "",
                            dataType: "TEXT",
                            nullable: true,
                            primaryKey: false,
                            defaultValue: "",
                          },
                        ],
                      }))
                    }
                  >
                    + Column
                  </button>
                </header>
                <div className="designer-grid column-grid">
                  {schemaDraft.columns.map((column) => {
                    const locked = schemaDraft.mode === "alter" && column.existing;
                    return (
                      <div
                        className={`designer-row${column.existing ? " is-existing" : ""}`}
                        key={column.id}
                      >
                        <input
                          aria-label="Column name"
                          value={column.name}
                          disabled={locked}
                          onChange={(event) =>
                            updateSchemaColumn(column.id, {
                              name: event.currentTarget.value,
                            })
                          }
                        />
                        <input
                          aria-label="Column type"
                          value={column.dataType}
                          disabled={locked}
                          onChange={(event) =>
                            updateSchemaColumn(column.id, {
                              dataType: event.currentTarget.value,
                            })
                          }
                        />
                        <label className="check-cell">
                          <input
                            type="checkbox"
                            checked={!column.nullable}
                            disabled={locked}
                            onChange={(event) =>
                              updateSchemaColumn(column.id, {
                                nullable: !event.currentTarget.checked,
                              })
                            }
                          />
                          <span>NN</span>
                        </label>
                        <label className="check-cell">
                          <input
                            type="checkbox"
                            checked={column.primaryKey}
                            disabled={locked}
                            onChange={(event) =>
                              updateSchemaColumn(column.id, {
                                primaryKey: event.currentTarget.checked,
                              })
                            }
                          />
                          <span>PK</span>
                        </label>
                        <input
                          aria-label="Default value"
                          value={column.defaultValue}
                          disabled={locked}
                          placeholder="default"
                          onChange={(event) =>
                            updateSchemaColumn(column.id, {
                              defaultValue: event.currentTarget.value,
                            })
                          }
                        />
                        <button
                          className="mini-button"
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            setSchemaDraft((current) => ({
                              ...current,
                              columns: current.columns.filter(
                                (item) => item.id !== column.id,
                              ),
                            }))
                          }
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="designer-section">
                <header>
                  <strong>Indexes</strong>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setSchemaDraft((current) => ({
                        ...current,
                        indexes: [
                          ...current.indexes,
                          {
                            id: schemaDraftId("index"),
                            name: "",
                            columns: "",
                            unique: false,
                          },
                        ],
                      }))
                    }
                  >
                    + Index
                  </button>
                </header>
                <div className="designer-grid index-grid">
                  {schemaDraft.indexes.map((index) => {
                    const locked = schemaDraft.mode === "alter" && index.existing;
                    return (
                      <div
                        className={`designer-row${index.existing ? " is-existing" : ""}`}
                        key={index.id}
                      >
                        <input
                          aria-label="Index name"
                          value={index.name}
                          disabled={locked}
                          placeholder="auto name"
                          onChange={(event) =>
                            updateSchemaIndex(index.id, {
                              name: event.currentTarget.value,
                            })
                          }
                        />
                        <input
                          aria-label="Index columns"
                          value={index.columns}
                          disabled={locked}
                          placeholder="col_a, col_b"
                          onChange={(event) =>
                            updateSchemaIndex(index.id, {
                              columns: event.currentTarget.value,
                            })
                          }
                        />
                        <label className="check-cell">
                          <input
                            type="checkbox"
                            checked={index.unique}
                            disabled={locked}
                            onChange={(event) =>
                              updateSchemaIndex(index.id, {
                                unique: event.currentTarget.checked,
                              })
                            }
                          />
                          <span>Unique</span>
                        </label>
                        <button
                          className="mini-button"
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            setSchemaDraft((current) => ({
                              ...current,
                              indexes: current.indexes.filter(
                                (item) => item.id !== index.id,
                              ),
                            }))
                          }
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="designer-section">
                <header>
                  <strong>Foreign Keys</strong>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setSchemaDraft((current) => ({
                        ...current,
                        foreignKeys: [
                          ...current.foreignKeys,
                          {
                            id: schemaDraftId("fk"),
                            name: "",
                            columns: "",
                            referencesSchema: "",
                            referencesTable: "",
                            referencesColumns: "",
                            onDelete: "",
                          },
                        ],
                      }))
                    }
                  >
                    + FK
                  </button>
                </header>
                <div className="designer-grid fk-grid">
                  {schemaDraft.foreignKeys.map((foreignKey) => {
                    const locked = schemaDraft.mode === "alter" && foreignKey.existing;
                    return (
                      <div
                        className={`designer-row${foreignKey.existing ? " is-existing" : ""}`}
                        key={foreignKey.id}
                      >
                        <input
                          aria-label="Foreign key name"
                          value={foreignKey.name}
                          disabled={locked}
                          placeholder="auto name"
                          onChange={(event) =>
                            updateSchemaForeignKey(foreignKey.id, {
                              name: event.currentTarget.value,
                            })
                          }
                        />
                        <input
                          aria-label="Foreign key columns"
                          value={foreignKey.columns}
                          disabled={locked}
                          placeholder="local cols"
                          onChange={(event) =>
                            updateSchemaForeignKey(foreignKey.id, {
                              columns: event.currentTarget.value,
                            })
                          }
                        />
                        <input
                          aria-label="Referenced schema"
                          value={foreignKey.referencesSchema}
                          disabled={locked}
                          placeholder="schema"
                          onChange={(event) =>
                            updateSchemaForeignKey(foreignKey.id, {
                              referencesSchema: event.currentTarget.value,
                            })
                          }
                        />
                        <input
                          aria-label="Referenced table"
                          value={foreignKey.referencesTable}
                          disabled={locked}
                          placeholder="table"
                          onChange={(event) =>
                            updateSchemaForeignKey(foreignKey.id, {
                              referencesTable: event.currentTarget.value,
                            })
                          }
                        />
                        <input
                          aria-label="Referenced columns"
                          value={foreignKey.referencesColumns}
                          disabled={locked}
                          placeholder="ref cols"
                          onChange={(event) =>
                            updateSchemaForeignKey(foreignKey.id, {
                              referencesColumns: event.currentTarget.value,
                            })
                          }
                        />
                        <select
                          aria-label="On delete"
                          value={foreignKey.onDelete}
                          disabled={locked}
                          onChange={(event) =>
                            updateSchemaForeignKey(foreignKey.id, {
                              onDelete: event.currentTarget.value,
                            })
                          }
                        >
                          <option value="">ON DELETE</option>
                          <option value="CASCADE">CASCADE</option>
                          <option value="SET NULL">SET NULL</option>
                          <option value="RESTRICT">RESTRICT</option>
                          <option value="NO ACTION">NO ACTION</option>
                        </select>
                        <button
                          className="mini-button"
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            setSchemaDraft((current) => ({
                              ...current,
                              foreignKeys: current.foreignKeys.filter(
                                (item) => item.id !== foreignKey.id,
                              ),
                            }))
                          }
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <pre className="sql-preview schema-sql">{schemaSqlPreview}</pre>
            </div>
            <div className="dialog-footer">
              <button
                className="text-button"
                type="button"
                onClick={() => void navigator.clipboard?.writeText(schemaSqlPreview)}
              >
                Copy SQL
              </button>
              <button
                className="primary-action"
                type="button"
                onClick={putSchemaSqlInEditor}
              >
                Put SQL in editor
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {diagramOpen ? (
        <div
          className="palette-overlay"
          onClick={() => setDiagramOpen(false)}
          role="presentation"
        >
          <div
            className="diagram"
            role="dialog"
            aria-label="ER diagram"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="diagram-header">
              <strong>ER Diagram</strong>
              <span>
                {activeConnection.name}
                {diagramModel
                  ? ` · ${diagramModel.tables.length}/${diagramModel.totalTables} tables · ${diagramModel.edges.length} edges`
                  : ""}
              </span>
              <button
                className="text-button"
                type="button"
                title="Fit diagram"
                onClick={fitDiagramToViewport}
                disabled={!diagramLayout}
              >
                <Maximize2 size={13} />
                <span>Fit</span>
              </button>
              <button
                className="mini-button"
                type="button"
                title="Zoom out"
                aria-label="Zoom out"
                disabled={!diagramLayout}
                onClick={() => setDiagramZoom((zoom) => clampNumber(zoom - 0.1, 0.25, 2))}
              >
                <ZoomOut size={13} />
              </button>
              <span className="diagram-zoom">{Math.round(diagramZoom * 100)}%</span>
              <button
                className="mini-button"
                type="button"
                title="Zoom in"
                aria-label="Zoom in"
                disabled={!diagramLayout}
                onClick={() => setDiagramZoom((zoom) => clampNumber(zoom + 0.1, 0.25, 2))}
              >
                <ZoomIn size={13} />
              </button>
              <button
                className="text-button"
                type="button"
                onClick={copyDiagramSvg}
                disabled={!diagramLayout}
              >
                <Copy size={13} />
                <span>SVG</span>
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => void copyDiagramPng()}
                disabled={!diagramLayout}
              >
                <Copy size={13} />
                <span>PNG</span>
              </button>
              <button
                className="text-button"
                type="button"
                onClick={downloadDiagramSvg}
                disabled={!diagramLayout}
              >
                <Download size={13} />
                <span>SVG</span>
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => void downloadDiagramPng()}
                disabled={!diagramLayout}
              >
                <ImageDown size={13} />
                <span>PNG</span>
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  if (activeMetadata) {
                    void navigator.clipboard?.writeText(diagramMermaid);
                  }
                }}
                disabled={!activeMetadata}
              >
                Copy Mermaid
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => setDiagramOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="diagram-controls">
              <label className="diagram-search">
                <Search size={14} />
                <input
                  value={diagramSearch}
                  placeholder="Filter schemas, tables, columns"
                  onChange={(event) => setDiagramSearch(event.currentTarget.value)}
                />
              </label>
              <div className="diagram-schema-actions">
                <button
                  className="mini-button"
                  type="button"
                  onClick={() => setDiagramSchemaNames(availableDiagramSchemas)}
                >
                  All
                </button>
                <button
                  className="mini-button"
                  type="button"
                  onClick={() => setDiagramSchemaNames([])}
                >
                  None
                </button>
              </div>
              <div className="diagram-schema-list" role="group" aria-label="Schemas">
                {availableDiagramSchemas.map((schema) => {
                  const active = diagramSchemaNames.includes(schema);
                  return (
                    <button
                      key={schema}
                      className={active ? "schema-chip active" : "schema-chip"}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setDiagramSchemaNames((current) =>
                          current.includes(schema)
                            ? current.filter((item) => item !== schema)
                            : [...current, schema],
                        )
                      }
                    >
                      {schema}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="diagram-canvas" ref={diagramCanvasRef}>
              {diagramError ? (
                <div className="result-error" role="alert">
                  <AlertTriangle size={16} />
                  <span>{diagramError}</span>
                </div>
              ) : null}
              {!diagramError && (!diagramLayout || diagramLayout.tables.length === 0) ? (
                <div className="grid-state">No tables match the current diagram filters</div>
              ) : null}
              {!diagramError && diagramLayout && diagramLayout.tables.length > 0 ? (
                <div
                  className="diagram-stage"
                  style={{
                    width: diagramLayout.width * diagramZoom,
                    height: diagramLayout.height * diagramZoom,
                  }}
                >
                  <div
                    className="diagram-scale"
                    style={{
                      transform: `scale(${diagramZoom})`,
                      width: diagramLayout.width,
                      height: diagramLayout.height,
                    }}
                  >
                    <ErdSvg
                      layout={diagramLayout}
                      svgRef={diagramSvgRef}
                      svgStyle={diagramSvgStyle}
                    />
                  </div>
                </div>
              ) : (
                null
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;
