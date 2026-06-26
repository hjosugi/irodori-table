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
  ChevronDown,
  Columns3,
  Copy,
  Database,
  Download,
  HelpCircle,
  ImageDown,
  Info,
  KeyRound,
  Folder,
  ListFilter,
  Menu,
  Maximize2,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Power,
  RefreshCw,
  Share2,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Table2,
  TerminalSquare,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { runQuerySpill, runQueryStream } from "./lib/tauri/db-stream";
import {
  QueryHistoryDialog,
  QueryHistorySidebar,
  useQueryHistoryStore,
  type QueryHistoryItem,
} from "./features/query-history";
import {
  QueryEditorPane,
  type EditorGroup,
  type EditorSelection,
} from "./features/query-editor";
import { SettingsDialog, type SettingsTab } from "./features/settings";
import { usePreferencesStore } from "./features/preferences";
import {
  WindowedRows,
  createWindowedRowsProxy,
} from "./result-window";
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
  deriveResultEditTarget,
  type ResultEditTarget,
} from "./result-edit-target";
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
  dbReleaseResult,
  dbResultWindow,
  jobsCancel,
  jobsList,
  type CellValue,
  type ConnectionInfo,
  type ConnectionProfile,
  type DatabaseMetadata,
  type DbEngine,
  type DbObjectMetadata,
  type JobList,
  type QueryResult,
  type QueryResultSet,
  type QueryParameterInput,
  type QueryParameterPromptSet,
  type RowDelete,
  type RowInsert,
  type RowUpdate,
  type SpillRunResult,
  type TableEdits,
  workspaceSnapshot,
  type WorkspaceSnapshot,
} from "./generated/irodori-api";
import { type SqlEditorHandle } from "./SqlEditor";
import { isSqlFormatterId } from "./sql/formatter";
import { isSqlLinterId } from "./sql/linter";
import { selectedOrCurrentStatement } from "./sql/statements";
import { cssVariables, darkTheme, lightTheme } from "./theme";
import { RowDetailSidebar } from "./RowDetailSidebar";
import { findTableMetadata, parseSourceTable } from "./row-detail";
import { parseQueryMagic, type QueryMagicAction } from "./query-magics";
import "./App.css";

const APP_NAME = "Irodori Table";
const APP_VERSION = "0.2.7";
const APP_IDENTIFIER = "dev.irodori.table";

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

const shellCommands: CommandMeta[] = [
  {
    id: "connection.manager",
    title: "Open Connection Manager",
    category: "Workspace",
    scope: "global",
  },
  {
    id: "settings.open",
    title: "Open Settings",
    category: "Workspace",
    scope: "global",
  },
  {
    id: "history.open",
    title: "Open Query History",
    category: "Workspace",
    scope: "global",
  },
  {
    id: "help.open",
    title: "Open Help",
    category: "Help",
    scope: "global",
  },
  {
    id: "about.open",
    title: "About Irodori Table",
    category: "Help",
    scope: "global",
  },
];

const appCommandCatalog: CommandMeta[] = [
  ...commandCatalog,
  ...shellCommands,
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
      name: "Local Postgres",
      engine: "PostgreSQL 16",
      status: "idle",
      latencyMs: 0,
      proxy: "direct",
      objects: [
        { name: "cheeses", kind: "table", rows: "5" },
        { name: "countries", kind: "table", rows: "5" },
        { name: "orders", kind: "table", rows: "1.2M" },
        { name: "customers", kind: "table", rows: "83K" },
        { name: "invoice_lines", kind: "table", rows: "4.8M" },
        { name: "cheese_summary", kind: "view" },
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
  color: string;
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
const savedQueryStorageKey = "irodori.savedScratchQuery.v1";
const queryParameterMemoryStorageKey = "irodori.queryParameters.v1";
const defaultConnectionColor = "#6b7280";
const connectionColorOptions = [
  defaultConnectionColor,
  "#2563eb",
  "#16a34a",
  "#ca8a04",
  "#dc2626",
  "#9333ea",
  "#0891b2",
  "#ea580c",
];

function loadSavedQuery(): string {
  return window.localStorage.getItem(savedQueryStorageKey) ?? initialQuery;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

type QueryParameterMemory = Record<string, Record<string, string>>;

type PendingQueryParameters = {
  sql: string;
  promptSet: QueryParameterPromptSet;
};

type ResultMode = "data" | "structure";
type ActionNotice = {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  detail?: string;
};

type ImportPreview = ParsedImport & {
  fileName: string;
  format: ImportTextFormat;
  tableName: string;
};

const localPostgresSampleUrl =
  "postgres://irodori:irodori@127.0.0.1:55432/samples";

const starterProfiles: ConnectionDraft[] = [
  {
    id: "local-pg",
    name: "Local Postgres",
    color: "#16a34a",
    engine: "postgres",
    mode: "url",
    url: localPostgresSampleUrl,
    host: "127.0.0.1",
    port: "55432",
    user: "irodori",
    password: "",
    database: "samples",
  },
  {
    id: "local-mysql",
    name: "Local MySQL",
    color: "#2563eb",
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
    color: "#ca8a04",
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
    color: "#9333ea",
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

const emptyJobList: JobList = { active: [], history: [] };

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

function quoteSqlIdentifier(engine: DbEngine, name: string) {
  const quote = engine === "mysql" || engine === "mariadb" || engine === "tidb" ? "`" : '"';
  return `${quote}${name.split(quote).join(quote + quote)}${quote}`;
}

function qualifiedObjectName(engine: DbEngine, object: DbObjectMetadata) {
  const parts = [object.schema, object.name].filter(Boolean);
  return parts.map((part) => quoteSqlIdentifier(engine, part)).join(".");
}

function tablePreviewSql(engine: DbEngine, object: DbObjectMetadata) {
  const table = qualifiedObjectName(engine, object);
  if (engine === "sqlserver") {
    return `select top (200) * from ${table};`;
  }
  return `select * from ${table} limit 200;`;
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
    color: defaultConnectionColor,
    engine: "postgres",
    mode: "url",
    url: "",
    host: "127.0.0.1",
    port: "5432",
    user: "",
    password: "",
    database: "",
  };
}

function withStarterProfiles(profiles: ConnectionDraft[]) {
  const existing = new Set(profiles.map((profile) => profile.id));
  return [
    ...profiles,
    ...starterProfiles.filter((profile) => !existing.has(profile.id)),
  ].map(repairBuiltinSampleProfile);
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
        color: profile.color || defaultConnectionColor,
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

function sanitizedProfile(profile: ConnectionDraft): ConnectionDraft {
  return {
    ...profile,
    color: profile.color || defaultConnectionColor,
    password: "",
  };
}

function repairBuiltinSampleProfile(profile: ConnectionDraft): ConnectionDraft {
  if (profile.id !== "local-pg") {
    return profile;
  }
  const url = profile.url.trim();
  const looksLikeBundledSample =
    !url ||
    /(?:localhost|127\.0\.0\.1):55432(?:\/samples)?(?:[?#].*)?$/.test(url) ||
    profile.host === "localhost" ||
    profile.host === "127.0.0.1" ||
    profile.database === "samples" ||
    profile.name === "Local Warehouse" ||
    profile.name === "Local Postgres";
  if (!looksLikeBundledSample) {
    return profile;
  }
  return {
    ...profile,
    name:
      profile.name === "Local Warehouse" || !profile.name.trim()
        ? "Local Postgres"
        : profile.name,
    color: profile.color || "#16a34a",
    engine: "postgres",
    mode: "url",
    url: localPostgresSampleUrl,
    host: "127.0.0.1",
    port: "55432",
    user: "irodori",
    password: "",
    database: "samples",
  };
}

function isDbEngine(value: unknown): value is DbEngine {
  return (
    typeof value === "string" &&
    engineOptions.some((option) => option.value === value)
  );
}

function jsonString(value: unknown, fallback: string) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function nonEmptyJsonString(value: unknown, fallback: string) {
  return jsonString(value, fallback).trim() || fallback;
}

function settingsProfileFromJson(
  value: unknown,
  index: number,
): ConnectionDraft {
  if (!isRecord(value)) {
    throw new Error(`connections[${index}] must be an object`);
  }
  const engine = isDbEngine(value.engine) ? value.engine : "postgres";
  const defaults = {
    ...newDraft(index + 1),
    ...memoryDefaults(engine),
  };
  const mode: ConnectionInputMode =
    value.mode === "fields" || value.mode === "url" ? value.mode : "url";
  return repairBuiltinSampleProfile(
    sanitizedProfile({
      ...defaults,
      id: nonEmptyJsonString(value.id, defaults.id),
      name: nonEmptyJsonString(value.name, defaults.name),
      color: nonEmptyJsonString(value.color, defaultConnectionColor),
      engine,
      mode,
      url: jsonString(value.url, defaults.url),
      host: jsonString(value.host, defaults.host),
      port: jsonString(value.port, defaults.port || defaultPort(engine)),
      user: jsonString(value.user, defaults.user),
      password: "",
      database: jsonString(value.database, defaults.database),
    }),
  );
}

function withUniqueProfileIds(profiles: ConnectionDraft[]) {
  const used = new Set<string>();
  return profiles.map((profile, index) => {
    const base = profile.id.trim() || `connection-${index + 1}`;
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return { ...profile, id };
  });
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

function tauriRuntimeError() {
  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }
  ).__TAURI_INTERNALS__;
  if (typeof internals?.invoke === "function") {
    return null;
  }
  return "Tauri desktop runtime is not available. Open the Tauri app window, not the Vite browser URL.";
}

function validateDraft(draft: ConnectionDraft): string | null {
  const resolvedDraft = repairBuiltinSampleProfile(draft);
  if (!resolvedDraft.id.trim()) {
    return "connection id is required";
  }
  if (!resolvedDraft.name.trim()) {
    return "name is required";
  }
  if (resolvedDraft.mode === "url" && !resolvedDraft.url.trim()) {
    return "URL/DSN is required";
  }
  if (
    resolvedDraft.mode === "fields" &&
    resolvedDraft.engine === "sqlite" &&
    !resolvedDraft.database.trim()
  ) {
    return "SQLite needs a file path or :memory:";
  }
  if (
    resolvedDraft.mode === "fields" &&
    resolvedDraft.engine !== "sqlite" &&
    resolvedDraft.engine !== "duckdb"
  ) {
    if (!resolvedDraft.host.trim()) {
      return "host is required";
    }
    if (resolvedDraft.engine === "pinecone") {
      return "Pinecone is selectable as a placeholder; a driver is not implemented yet";
    }
  }
  if (
    resolvedDraft.port.trim() &&
    !Number.isInteger(Number(resolvedDraft.port))
  ) {
    return "port must be a number";
  }
  return null;
}

function profileFromDraft(draft: ConnectionDraft): ConnectionProfile {
  const resolvedDraft = repairBuiltinSampleProfile(draft);
  if (resolvedDraft.mode === "url") {
    return {
      id: resolvedDraft.id.trim(),
      engine: resolvedDraft.engine,
      url: resolvedDraft.url.trim(),
    };
  }
  return {
    id: resolvedDraft.id.trim(),
    engine: resolvedDraft.engine,
    host: resolvedDraft.host.trim() || undefined,
    port: resolvedDraft.port.trim() ? Number(resolvedDraft.port) : undefined,
    user: resolvedDraft.user.trim() || undefined,
    password: resolvedDraft.password || undefined,
    database: resolvedDraft.database.trim() || undefined,
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
const GRID_WINDOWED_ROW_THRESHOLD = 50_000;
const GRID_WINDOWED_CELL_THRESHOLD = 250_000;

// EXEC-010 disk-offload paging: rows per `db_result_window` fetch and how many
// pages stay resident before LRU eviction. `24 * 1000 = 24k` rows is the flat-
// memory ceiling on the client regardless of total result size.
const RESULT_WINDOW_PAGE_SIZE = 1_000;
const RESULT_WINDOW_MAX_RESIDENT_PAGES = 24;
// Stable empty collections so a disk-offloaded result forces the windowed grid
// path (no client-side edits/filters/sort over a result that lives on disk).
const EMPTY_CELL_EDITS: ReadonlyMap<string, GridCellDraft> = new Map();
const EMPTY_NEW_ROWS: readonly (readonly GridCellDraft[])[] = [];
const EMPTY_DELETED_ROWS: ReadonlySet<number> = new Set();
const EMPTY_FILTER_RULES: readonly ResultFilterRule[] = [];
const EMPTY_SORT_RULES: readonly ResultSortRule[] = [];
const GRID_COPY_ROW_LIMIT = 50_000;
const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 420;
const INSPECTOR_WIDTH_MIN = 220;
const INSPECTOR_WIDTH_MAX = 420;
const RESULTS_HEIGHT_MIN = 150;
const RESULTS_HEIGHT_MAX = 520;
const EDITOR_SPLIT_MIN = 28;
const EDITOR_SPLIT_MAX = 72;

function App() {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const diagramSvgRef = useRef<SVGSVGElement | null>(null);
  const diagramCanvasRef = useRef<HTMLDivElement | null>(null);
  const pendingDiagramSearchRef = useRef<string | null>(null);
  const actionNoticeTimerRef = useRef<number | null>(null);
  const gridScrollRaf = useRef<number | null>(null);
  const pendingGridScroll = useRef({ top: 0, left: 0 });
  const [gridScrollTop, setGridScrollTop] = useState(0);
  const [gridScrollLeft, setGridScrollLeft] = useState(0);
  const [gridViewportHeight, setGridViewportHeight] = useState(480);
  const [gridViewportWidth, setGridViewportWidth] = useState(900);
  const editorApiRef = useRef<SqlEditorHandle>(null);
  const secondaryEditorApiRef = useRef<SqlEditorHandle>(null);
  const editorSplitRef = useRef<HTMLDivElement | null>(null);
  const [editorSelection, setEditorSelection] = useState<EditorSelection>({
    from: 0,
    to: 0,
  });
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(fallbackSnapshot);
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [activeConnectionId, setActiveConnectionId] = useState(
    fallbackSnapshot.activeConnectionId,
  );
  const [query, setQuery] = useState(loadSavedQuery);
  const themeKind = usePreferencesStore((state) => state.themeKind);
  const setThemeKind = usePreferencesStore((state) => state.setThemeKind);
  const theme = themeKind === "dark" ? darkTheme : lightTheme;
  const vimMode = usePreferencesStore((state) => state.vimMode);
  const setVimMode = usePreferencesStore((state) => state.setVimMode);
  const formatter = usePreferencesStore((state) => state.formatter);
  const setFormatter = usePreferencesStore((state) => state.setFormatter);
  const sqlLinter = usePreferencesStore((state) => state.sqlLinter);
  const setSqlLinter = usePreferencesStore((state) => state.setSqlLinter);
  const sidebarOpen = usePreferencesStore((state) => state.sidebarOpen);
  const setSidebarOpen = usePreferencesStore((state) => state.setSidebarOpen);
  const sidebarWidth = usePreferencesStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePreferencesStore((state) => state.setSidebarWidth);
  const inspectorWidth = usePreferencesStore((state) => state.inspectorWidth);
  const setInspectorWidth = usePreferencesStore(
    (state) => state.setInspectorWidth,
  );
  const resultsHeight = usePreferencesStore((state) => state.resultsHeight);
  const setResultsHeight = usePreferencesStore(
    (state) => state.setResultsHeight,
  );
  const editorSplitMode = usePreferencesStore(
    (state) => state.editorSplitMode,
  );
  const setEditorSplitMode = usePreferencesStore(
    (state) => state.setEditorSplitMode,
  );
  const editorSplitPercent = usePreferencesStore(
    (state) => state.editorSplitPercent,
  );
  const setEditorSplitPercent = usePreferencesStore(
    (state) => state.setEditorSplitPercent,
  );
  const [activeEditorGroup, setActiveEditorGroup] =
    useState<EditorGroup>("primary");
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
  const [connectionManagerOpen, setConnectionManagerOpen] = useState(false);
  const [connectionSearch, setConnectionSearch] = useState("");
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [liveConnections, setLiveConnections] = useState<
    Record<string, WorkspaceConnection>
  >({});
  const [connecting, setConnecting] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  // EXEC-010: when a run spills past the in-memory budget, the grid pages rows from
  // disk through this handle instead of holding them all in JS. `spillInfo` drives
  // the windowed grid path; `spillRef` holds the live LRU page source; the version
  // counter forces the grid view model to recompute as pages arrive.
  const resultOffloadEnabled = usePreferencesStore(
    (state) => state.resultOffloadEnabled,
  );
  const setResultOffloadEnabled = usePreferencesStore(
    (state) => state.setResultOffloadEnabled,
  );
  const resultMemoryBudget = usePreferencesStore(
    (state) => state.resultMemoryBudget,
  );
  const setResultMemoryBudget = usePreferencesStore(
    (state) => state.setResultMemoryBudget,
  );
  const [spillInfo, setSpillInfo] = useState<{ handle: string; total: number } | null>(
    null,
  );
  const [gridWindowVersion, setGridWindowVersion] = useState(0);
  const spillRef = useRef<{ handle: string; source: WindowedRows } | null>(null);
  const pendingPagesRef = useRef<Set<number>>(new Set());
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [resultMode, setResultMode] = useState<ResultMode>("data");
  const [tableViewObject, setTableViewObject] = useState<DbObjectMetadata | null>(
    null,
  );
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
  const keymap = {
    ...resultCopyDefaultKeymap,
    ...effectiveKeymap(keymapOverrides),
  };
  const [activeKeyScope, setActiveKeyScope] =
    useState<KeybindingScope>("global");
  const [recordingCommand, setRecordingCommand] = useState<string | null>(null);
  const [recordingSequence, setRecordingSequence] = useState<string[]>([]);
  // Command palette (Ctrl/Cmd+Shift+P).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [settingsJsonDraft, setSettingsJsonDraft] = useState("");
  const [settingsJsonError, setSettingsJsonError] = useState<string | null>(
    null,
  );
  const [jobs, setJobs] = useState<JobList>(emptyJobList);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [objectActionMenu, setObjectActionMenu] = useState<string | null>(null);
  // ER diagram modal (rendered from metadata through our SVG layout).
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [diagramError, setDiagramError] = useState<string | null>(null);
  const [diagramSearch, setDiagramSearch] = useState("");
  const [diagramSchemaNames, setDiagramSchemaNames] = useState<string[]>([]);
  const [diagramZoom, setDiagramZoom] = useState(1);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);
  const [schemaDesignerOpen, setSchemaDesignerOpen] = useState(false);
  const [schemaDraft, setSchemaDraft] =
    useState<SchemaDesignerDraft>(blankSchemaDraft);
  const diagramInitializedFor = useRef<string | null>(null);
  const appendHistory = useQueryHistoryStore((state) => state.append);
  const openQueryHistoryDialog = useQueryHistoryStore(
    (state) => state.openDialog,
  );
  const closeQueryHistoryDialog = useQueryHistoryStore(
    (state) => state.closeDialog,
  );
  const [queryParameterMemory, setQueryParameterMemory] =
    useState<QueryParameterMemory>(loadQueryParameterMemory);
  const [pendingQueryParameters, setPendingQueryParameters] =
    useState<PendingQueryParameters | null>(null);
  const [parameterDraftValues, setParameterDraftValues] = useState<
    Record<string, string>
  >({});
  const [metadataByConnection, setMetadataByConnection] = useState<
    Record<string, DatabaseMetadata>
  >({});
  const [metadataLoading, setMetadataLoading] = useState<Set<string>>(
    new Set(),
  );
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
    if (settingsOpen && settingsTab === "jobs") {
      void refreshJobs();
    }
  }, [settingsOpen, settingsTab]);

  useEffect(() => {
    window.localStorage.setItem(
      profilesStorageKey,
      JSON.stringify(profiles.map(sanitizedProfile)),
    );
  }, [profiles]);

  useEffect(() => {
    window.localStorage.setItem(
      queryParameterMemoryStorageKey,
      JSON.stringify(queryParameterMemory),
    );
  }, [queryParameterMemory]);

  useEffect(() => {
    if (editorSplitMode === "single") {
      setActiveEditorGroup("primary");
    }
  }, [editorSplitMode]);

  useEffect(() => {
    return () => {
      if (actionNoticeTimerRef.current !== null) {
        window.clearTimeout(actionNoticeTimerRef.current);
      }
    };
  }, []);

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
  const connectionById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  );
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );
  const filteredProfiles = useMemo(() => {
    const needle = connectionSearch.trim().toLowerCase();
    if (!needle) {
      return profiles;
    }
    return profiles.filter((profile) =>
      `${profile.name} ${profile.id} ${engineLabel(profile.engine)} ${profile.host} ${profile.database} ${profile.url}`
        .toLowerCase()
        .includes(needle),
    );
  }, [connectionSearch, profiles]);

  const activeConnection = useMemo(
    () =>
      connections.find((item) => item.id === activeConnectionId) ??
      connections[0],
    [activeConnectionId, connections],
  );
  const activeProfile = profiles.find(
    (profile) => profile.id === activeConnectionId,
  );
  const activeEngine = activeProfile?.engine ?? draft.engine;
  const editorSplitOpen = editorSplitMode !== "single";
  const activeConnectionOpen = connectedIds.has(activeConnectionId);
  const activeConnectionColor =
    activeProfile?.color || profileById.get(activeConnectionId)?.color || defaultConnectionColor;
  const activeConnectionStatus = activeConnectionOpen
    ? `Connected · ${activeConnection.latencyMs} ms`
    : "Disconnected";
  const activeTransportLabel =
    activeConnection.proxy === "direct"
      ? "Direct connection"
      : activeConnection.proxy || "Transport not configured";

  const activeMetadata = metadataByConnection[activeConnectionId];
  const activeMetadataLoading = metadataLoading.has(activeConnectionId);
  const activeMetadataError = metadataErrors[activeConnectionId];
  const completionHints = useMemo(
    () => completionHintsFromMetadata(activeMetadata),
    [activeMetadata],
  );

  function activeEditorApi() {
    if (editorSplitOpen && activeEditorGroup === "secondary") {
      return secondaryEditorApiRef.current ?? editorApiRef.current;
    }
    return editorApiRef.current;
  }
  const availableDiagramSchemas = useMemo(
    () =>
      activeMetadata?.schemas
        .filter((schema) =>
          schema.objects.some((object) => object.kind === "table"),
        )
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

  const activeTabLabel =
    tabs.find((tab) => tab.id === activeTab)?.label ?? "Scratch";
  const selectedEditorSql = query
    .slice(editorSelection.from, editorSelection.to)
    .trim();
  const hasSelectedEditorSql = selectedEditorSql.length > 0;
  const runPrimaryLabel = hasSelectedEditorSql ? "Run Selection" : "Run Current";
  const runShortcutLabel = formatKeySequence(keymap["query.run"] ?? "");
  const runCurrentShortcutLabel = formatKeySequence(
    keymap["query.runCurrent"] ?? "",
  );
  const runFromStartShortcutLabel = formatKeySequence(
    keymap["query.runFromStart"] ?? "",
  );
  const runAllShortcutLabel = formatKeySequence(keymap["query.runAll"] ?? "");

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
    resultSets[
      Math.min(activeResultIndex, Math.max(0, resultSets.length - 1))
    ] ?? null;

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
  // A disk-offloaded result (EXEC-010) forces the windowed path with empty
  // edits/filters/sort: its rows live on disk, so it is browse-only here and reads
  // through the `db_result_window` proxy. `gridWindowVersion` re-runs this as pages
  // arrive. Client-side sort/filter/edit over a spilled result need server-side
  // EXEC-005A / run-to-file EXEC-008 and are intentionally disabled.
  const spilled = spillInfo !== null;
  const resultGridView = useMemo(
    () =>
      buildResultGridViewModel(
        {
          rows: activeResult?.rows ?? resultRows,
          cellEdits: spilled ? EMPTY_CELL_EDITS : cellEdits,
          newRows: spilled ? EMPTY_NEW_ROWS : newRows,
          deletedRows: spilled ? EMPTY_DELETED_ROWS : deletedRows,
          filterRules: spilled ? EMPTY_FILTER_RULES : filterRules,
          quickFilter: spilled ? "" : quickFilter,
          filterJoin,
          sortRules: spilled ? EMPTY_SORT_RULES : sortRules,
        },
        {
          windowedRowThreshold: spilled ? 0 : GRID_WINDOWED_ROW_THRESHOLD,
          windowedCellThreshold: spilled ? 0 : GRID_WINDOWED_CELL_THRESHOLD,
        },
      ),
    [
      activeResult?.rows,
      cellEdits,
      newRows,
      deletedRows,
      filterRules,
      quickFilter,
      filterJoin,
      sortRules,
      spilled,
      gridWindowVersion,
    ],
  );
  const {
    activeFilters,
    filteredOutCount,
    filtersActive,
    pendingCount,
    sortRuleByColumn,
    totalRowCount,
    unfilteredRowCount,
  } = resultGridView;

  // Virtualize the result grid: render only the rows in (and just around) the
  // viewport, with top/bottom spacers preserving the scrollbar. A 10k-row page is
  // ~30 DOM rows instead of 10k, so streaming stays smooth.
  const totalRows = totalRowCount;
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
  const visibleRows = resultGridView.rowsInRange(firstVisible, lastVisible);
  const structureObject = resultMode === "structure" ? tableViewObject : null;
  const showingStructure = Boolean(structureObject);

  // EXEC-010: fetch the disk pages the visible range needs, ingest them into the
  // LRU source, and bump the version so the grid repaints with real cells. The LRU
  // budget keeps resident rows flat no matter how far the user scrolls.
  useEffect(() => {
    const spill = spillRef.current;
    if (!spill || !spillInfo || spillInfo.handle !== spill.handle) {
      return;
    }
    const requests = spill.source.missingPages(firstVisible, lastVisible);
    if (requests.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const request of requests) {
        if (cancelled || pendingPagesRef.current.has(request.pageIndex)) {
          continue;
        }
        pendingPagesRef.current.add(request.pageIndex);
        try {
          const page = await dbResultWindow(
            spill.handle,
            request.offset,
            request.limit,
          );
          if (cancelled) {
            return;
          }
          spill.source.ingest(Number(page.offset), page.rows);
          setGridWindowVersion((version) => version + 1);
        } catch {
          // Leave the rows as placeholders; a later scroll retries the page.
        } finally {
          pendingPagesRef.current.delete(request.pageIndex);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spillInfo, firstVisible, lastVisible, gridWindowVersion]);

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

  type PanelResizeKind = "sidebar" | "inspector" | "results" | "editorSplit";

  function resizePanel(kind: PanelResizeKind, delta: number) {
    switch (kind) {
      case "sidebar":
        setSidebarWidth((current) =>
          clampNumber(current + delta, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX),
        );
        break;
      case "inspector":
        setInspectorWidth((current) =>
          clampNumber(
            current + delta,
            INSPECTOR_WIDTH_MIN,
            INSPECTOR_WIDTH_MAX,
          ),
        );
        break;
      case "results":
        setResultsHeight((current) =>
          clampNumber(current + delta, RESULTS_HEIGHT_MIN, RESULTS_HEIGHT_MAX),
        );
        break;
      case "editorSplit":
        setEditorSplitPercent((current) =>
          clampNumber(current + delta, EDITOR_SPLIT_MIN, EDITOR_SPLIT_MAX),
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
    const editorSplitBounds = editorSplitRef.current?.getBoundingClientRect();
    document.body.classList.add("panel-resizing");

    const onMove = (moveEvent: PointerEvent) => {
      if (kind === "editorSplit") {
        if (!editorSplitBounds) {
          return;
        }
        const next =
          editorSplitMode === "down"
            ? ((moveEvent.clientY - editorSplitBounds.top) /
                Math.max(1, editorSplitBounds.height)) *
              100
            : ((moveEvent.clientX - editorSplitBounds.left) /
                Math.max(1, editorSplitBounds.width)) *
              100;
        setEditorSplitPercent(
          clampNumber(next, EDITOR_SPLIT_MIN, EDITOR_SPLIT_MAX),
        );
        return;
      }
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
    if (kind === "editorSplit") {
      if (editorSplitMode === "down") {
        resizePanel(kind, event.key === "ArrowDown" ? 4 : -4);
      } else {
        resizePanel(kind, event.key === "ArrowRight" ? 4 : -4);
      }
      return;
    }
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

  // EXEC-010: drop the active disk-offloaded result and ask the backend to remove
  // its temp file. Safe to call when nothing is spilled.
  function releaseActiveSpill() {
    const previous = spillRef.current;
    spillRef.current = null;
    pendingPagesRef.current.clear();
    if (previous) {
      void dbReleaseResult(previous.handle).catch(() => {});
    }
    setSpillInfo(null);
    setGridWindowVersion(0);
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
          value === null
            ? originalRaw === null
            : value === formatCell(originalRaw);
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
    if (!canEditActiveResult()) {
      setCommitError("result editing needs a single table query with a visible key");
      return;
    }
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
      setNewRows((current) =>
        current.filter((_, index) => index !== origin.index),
      );
    }
    setEditingCell(null);
    setSelectedRowKey((current) => (current === rowKey ? null : current));
  }

  // Paste a TSV/CSV block starting at `origin`/`startCol`, spilling across columns
  // and into staged new rows as needed.
  function pasteTableAt(
    origin: ResultGridRowOrigin,
    startCol: number,
    text: string,
  ) {
    const block = parseClipboardTable(text);
    if (block.length === 0) {
      return;
    }
    const startPos = resultGridView.displayIndexForKey(
      resultGridRowKey(origin),
    );
    if (startPos < 0) {
      return;
    }
    block.forEach((cells, rowOffset) => {
      const target = resultGridView.rowAt(startPos + rowOffset)?.origin;
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
          return colOffset >= 0 && colOffset < cells.length
            ? cells[colOffset]
            : "";
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
    if (totalRows === 0 || resultColumns.length === 0) {
      return;
    }
    const firstRow = resultGridView.rowAt(0);
    const currentKey = selectedCell?.key ?? selectedRowKey ?? firstRow?.key;
    const currentRowIndex = currentKey
      ? Math.max(0, resultGridView.displayIndexForKey(currentKey))
      : 0;
    const currentCol = selectedCell?.col ?? 0;
    const nextRowIndex = clampNumber(
      currentRowIndex + rowDelta,
      0,
      totalRows - 1,
    );
    const nextCol = clampNumber(
      currentCol + colDelta,
      0,
      Math.max(0, resultColumns.length - 1),
    );
    const nextRow = resultGridView.rowAt(nextRowIndex);
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
    if (!key) {
      return null;
    }
    const index = resultGridView.displayIndexForKey(key);
    return index >= 0 ? resultGridView.rowAt(index) : null;
  }

  function selectedRowForCopy() {
    const key = selectedRowKey ?? selectedCell?.key;
    if (!key) {
      return null;
    }
    const index = resultGridView.displayIndexForKey(key);
    return index >= 0 ? resultGridView.rowAt(index) : null;
  }

  function copyCellsForRow(row: ResultGridRowLike): string[] {
    return resultColumns.map((_, index) => row.cells[index] ?? "");
  }

  function selectedGridCopyText(): string | null {
    if (selectedCell) {
      const row = selectedDisplayRow();
      if (row) {
        return row.cells[selectedCell.col] ?? "";
      }
    }
    const row = selectedRowForCopy();
    return row ? formatResultGridTsvRow(copyCellsForRow(row)) : null;
  }

  async function copyGridText(text: string | null) {
    if (text === null) {
      showActionNotice("info", "Nothing to copy");
      return;
    }
    try {
      await writeTextToClipboard(text);
      showActionNotice("success", "Copied", "Selection copied to clipboard");
    } catch (error) {
      const message = errorMessage(error);
      setQueryError(message);
      showActionNotice("error", "Copy failed", message);
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
    await copyGridText(
      row ? formatResultGridTsvRow(copyCellsForRow(row)) : null,
    );
  }

  async function copyVisibleResult() {
    if (editingCell || resultColumns.length === 0) {
      return;
    }
    if (totalRows > GRID_COPY_ROW_LIMIT) {
      setQueryError(
        `Copy is capped at ${toCount(GRID_COPY_ROW_LIMIT)} displayed rows; use Export for larger results.`,
      );
      return;
    }
    await copyGridText(
      formatResultGridTsv(
        resultColumns,
        resultGridView.rowsInRange(0, totalRows),
      ),
    );
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
    const row = selectedDisplayRow() ?? resultGridView.rowAt(0);
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
    pasteTableAt(
      row.origin,
      selectedCell.col,
      event.clipboardData.getData("text"),
    );
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

  function inferEditTarget(): ResultEditTarget | null {
    return deriveResultEditTarget({
      sql: lastRunSql,
      metadata: metadataByConnection[activeConnectionId],
      resultColumns,
    });
  }

  function canEditActiveResult(): boolean {
    return Boolean(result && inferEditTarget());
  }

  function originalCell(rowIndex: number, column: string): CellValue {
    const col = resultColumns.indexOf(column);
    return { column, value: activeResult?.rows[rowIndex]?.[col] ?? null };
  }

  async function commitEdits() {
    const target = inferEditTarget();
    if (!target) {
      const message = "could not detect an editable target table from the query";
      setCommitError(message);
      showActionNotice("error", "Commit failed", message);
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
      showActionNotice(
        "success",
        "Edits committed",
        `${toCount(updates.length)} updates, ${toCount(inserts.length)} inserts, ${toCount(deletes.length)} deletes`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setCommitError(message);
      showActionNotice("error", "Commit failed", message);
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
      case "settings.open":
        openSettingsSection("general");
        break;
      case "history.open":
        openQueryHistoryDialog();
        break;
      case "help.open":
      case "about.open":
        setAboutOpen(true);
        break;
      case "connection.manager":
        setConnectionManagerOpen(true);
        break;
      case "diagram.show":
        setDiagramOpen(true);
        break;
      case "query.run":
        void runQuery();
        break;
      case "query.runCurrent":
        void runCurrentQuery();
        break;
      case "query.runFromStart":
        void runFromStartQuery();
        break;
      case "query.runAll":
        void runAllQuery();
        break;
      case "query.cancel":
        void cancelQuery();
        break;
      case "editor.focus":
        activeEditorApi()?.focus();
        break;
      case "editor.format":
        formatQuery();
        break;
      case "editor.comment.toggle":
        activeEditorApi()?.toggleComment();
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
        if (editMode) {
          setEditMode(false);
        } else if (canEditActiveResult()) {
          setEditMode(true);
          setCommitError(null);
        } else {
          setCommitError("result editing needs a single table query with a visible key");
        }
        break;
      case "edit.addRow":
        addNewRow();
        break;
      case "edit.commit":
        void commitEdits();
        break;
    }
  }

  const keymapConflicts = findConflicts(keymap, appCommandCatalog);
  const paletteResults = appCommandCatalog.filter((command) =>
    `${command.title} ${command.category}`
      .toLowerCase()
      .includes(paletteQuery.trim().toLowerCase()),
  );

  function buildSettingsJson() {
    return JSON.stringify(
      {
        version: 1,
        theme: themeKind,
        editor: {
          vimMode,
          formatter,
          linter: sqlLinter,
        },
        layout: {
          sidebarOpen,
          sidebarWidth,
          inspectorWidth,
          resultsHeight,
        },
        activeConnectionId,
        keymapOverrides,
        connections: profiles.map(sanitizedProfile),
      },
      null,
      2,
    );
  }

  function openSettingsSection(tab: SettingsTab) {
    setSettingsTab(tab);
    setSettingsOpen(true);
    if (tab === "json") {
      setSettingsJsonDraft(buildSettingsJson());
      setSettingsJsonError(null);
    }
  }

  async function refreshJobs() {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const next = await jobsList();
      setJobs(next);
    } catch (error) {
      const message = errorMessage(error);
      setJobsError(message);
      setJobs(emptyJobList);
    } finally {
      setJobsLoading(false);
    }
  }

  async function cancelJob(jobId: string) {
    setJobsError(null);
    try {
      await jobsCancel(jobId);
      await refreshJobs();
      showActionNotice("info", "Job cancellation requested", jobId);
    } catch (error) {
      const message = errorMessage(error);
      setJobsError(message);
      showActionNotice("error", "Job cancellation failed", message);
    }
  }

  function resetSettingsJsonDraft() {
    setSettingsJsonDraft(buildSettingsJson());
    setSettingsJsonError(null);
    showActionNotice("info", "Settings JSON reset", "Loaded current settings");
  }

  function applySettingsJson() {
    try {
      const parsed = JSON.parse(settingsJsonDraft) as unknown;
      if (!isRecord(parsed)) {
        throw new Error("settings JSON root must be an object");
      }
      if (parsed.theme === "dark" || parsed.theme === "light") {
        setThemeKind(parsed.theme);
      }
      if (isRecord(parsed.editor)) {
        if (typeof parsed.editor.vimMode === "boolean") {
          setVimMode(parsed.editor.vimMode);
        }
        if (
          typeof parsed.editor.formatter === "string" &&
          isSqlFormatterId(parsed.editor.formatter)
        ) {
          setFormatter(parsed.editor.formatter);
        }
        if (
          typeof parsed.editor.linter === "string" &&
          isSqlLinterId(parsed.editor.linter)
        ) {
          setSqlLinter(parsed.editor.linter);
        }
      }
      if (isRecord(parsed.layout)) {
        if (typeof parsed.layout.sidebarOpen === "boolean") {
          setSidebarOpen(parsed.layout.sidebarOpen);
        }
        const nextSidebarWidth = Number(parsed.layout.sidebarWidth);
        if (Number.isFinite(nextSidebarWidth)) {
          setSidebarWidth(
            clampNumber(
              nextSidebarWidth,
              SIDEBAR_WIDTH_MIN,
              SIDEBAR_WIDTH_MAX,
            ),
          );
        }
        const nextInspectorWidth = Number(parsed.layout.inspectorWidth);
        if (Number.isFinite(nextInspectorWidth)) {
          setInspectorWidth(
            clampNumber(
              nextInspectorWidth,
              INSPECTOR_WIDTH_MIN,
              INSPECTOR_WIDTH_MAX,
            ),
          );
        }
        const nextResultsHeight = Number(parsed.layout.resultsHeight);
        if (Number.isFinite(nextResultsHeight)) {
          setResultsHeight(
            clampNumber(
              nextResultsHeight,
              RESULTS_HEIGHT_MIN,
              RESULTS_HEIGHT_MAX,
            ),
          );
        }
      }
      if (isRecord(parsed.keymapOverrides)) {
        const nextKeymap: Keymap = {};
        for (const [commandId, chord] of Object.entries(parsed.keymapOverrides)) {
          if (typeof chord === "string") {
            nextKeymap[commandId] = chord;
          }
        }
        setKeymapOverrides(nextKeymap);
        saveOverrides(nextKeymap);
      }
      if (Array.isArray(parsed.connections)) {
        const nextProfiles = withStarterProfiles(
          withUniqueProfileIds(
            parsed.connections.map((profile, index) =>
              settingsProfileFromJson(profile, index),
            ),
          ),
        );
        if (nextProfiles.length > 0) {
          const selectedId =
            typeof parsed.activeConnectionId === "string" &&
            nextProfiles.some((profile) => profile.id === parsed.activeConnectionId)
              ? parsed.activeConnectionId
              : nextProfiles[0].id;
          const selectedProfile =
            nextProfiles.find((profile) => profile.id === selectedId) ??
            nextProfiles[0];
          setProfiles(nextProfiles);
          setSelectedProfileId(selectedProfile.id);
          setActiveConnectionId(selectedProfile.id);
          setDraft(selectedProfile);
        }
      }
      setSettingsJsonDraft(JSON.stringify(parsed, null, 2));
      setSettingsJsonError(null);
      showActionNotice("success", "Settings applied", "JSON settings were loaded");
    } catch (error) {
      const message = errorMessage(error);
      setSettingsJsonError(message);
      showActionNotice("error", "Settings JSON failed", message);
    }
  }

  function showActionNotice(
    kind: ActionNotice["kind"],
    title: string,
    detail?: string,
  ) {
    if (actionNoticeTimerRef.current !== null) {
      window.clearTimeout(actionNoticeTimerRef.current);
    }
    setActionNotice({
      id: Date.now(),
      kind,
      title,
      detail,
    });
    actionNoticeTimerRef.current = window.setTimeout(() => {
      setActionNotice(null);
      actionNoticeTimerRef.current = null;
    }, kind === "error" ? 5200 : 3200);
  }

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

  function commitRecordedKeybinding(
    commandId: string,
    sequence: readonly string[],
  ) {
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
      setDiagramError(
        "No tables to diagram yet — connect and load metadata first.",
      );
      return;
    }
    setDiagramError(null);
    const initKey = `${activeConnectionId}:${activeMetadata.schemas
      .map((schema) => schema.name)
      .join("|")}`;
    if (diagramInitializedFor.current !== initKey) {
      setDiagramSchemaNames(
        activeMetadata.schemas
          .filter((schema) =>
            schema.objects.some((object) => object.kind === "table"),
          )
          .map((schema) => schema.name),
      );
      setDiagramSearch(pendingDiagramSearchRef.current ?? "");
      pendingDiagramSearchRef.current = null;
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
      ? `${toCount(totalRows)} / ${toCount(unfilteredRowCount)} shown · ${resultSummary}`
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
    const repaired = repairBuiltinSampleProfile(profile);
    setSelectedProfileId(repaired.id);
    setDraft(repaired);
    setConnectionError(null);
  }

  function saveDraft(showSaved = true) {
    const validationError = validateDraft(draft);
    if (validationError) {
      setConnectionError(validationError);
      showActionNotice("error", "Connection was not saved", validationError);
      return false;
    }
    const cleanDraft = repairBuiltinSampleProfile(sanitizedProfile(draft));
    setProfiles((current) => {
      const existing = current.findIndex(
        (profile) => profile.id === cleanDraft.id,
      );
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
      showActionNotice("success", "Connection saved", cleanDraft.name);
    }
    return true;
  }

  function addProfile() {
    const next = newDraft(profiles.length + 1);
    setProfiles((current) => [...current, sanitizedProfile(next)]);
    setSelectedProfileId(next.id);
    setDraft(next);
    setConnectionError(null);
    showActionNotice("info", "New connection draft created", next.name);
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
    showActionNotice("success", "Connection deleted", id);
  }

  async function testActiveProfile() {
    const validationError = validateDraft(draft);
    if (validationError) {
      setConnectionError(validationError);
      showActionNotice("error", "Connection test failed", validationError);
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setConnectionError(runtimeError);
      showActionNotice("error", "Connection test failed", runtimeError);
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
      setConnectionError(null);
      showActionNotice(
        "success",
        "Connection test succeeded",
        `${draft.name.trim()} (${engineLabel(draft.engine)})`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", "Connection test failed", message);
    } finally {
      setTestingConnection(false);
    }
  }

  async function connectActiveProfile(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!saveDraft(false)) {
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setConnectionError(runtimeError);
      showActionNotice("error", "Connect failed", runtimeError);
      return;
    }
    setConnecting(true);
    setConnectionError(null);
    try {
      const started = performance.now();
      const info = await dbConnect(profileFromDraft(draft));
      const elapsedMs = Math.max(1, Math.round(performance.now() - started));
      const nextConnection = describeConnection(
        info,
        elapsedMs,
        draft.name.trim(),
      );
      setLiveConnections((current) => ({
        ...current,
        [nextConnection.id]: nextConnection,
      }));
      setConnectedIds((current) => new Set(current).add(nextConnection.id));
      setActiveConnectionId(nextConnection.id);
      void refreshObjects(nextConnection.id, true);
      setConnectionManagerOpen(false);
      showActionNotice(
        "success",
        "Connected",
        `${draft.name.trim()} · ${elapsedMs} ms`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", "Connect failed", message);
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
    showActionNotice("success", "Disconnected", id);
  }

  async function refreshObjects(
    connectionId = activeConnectionId,
    force = false,
    notify = false,
  ) {
    if (!force && !connectedIds.has(connectionId)) {
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setMetadataErrors((current) => ({
        ...current,
        [connectionId]: runtimeError,
      }));
      if (notify) {
        showActionNotice("error", "Refresh failed", runtimeError);
      }
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
      if (notify) {
        const objectCount = metadata.schemas.reduce(
          (count, schema) => count + schema.objects.length,
          0,
        );
        showActionNotice(
          "success",
          "Objects refreshed",
          `${toCount(objectCount)} objects loaded`,
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      setMetadataErrors((current) => ({
        ...current,
        [connectionId]: message,
      }));
      if (notify) {
        showActionNotice("error", "Refresh failed", message);
      }
    } finally {
      setMetadataLoading((current) => {
        const next = new Set(current);
        next.delete(connectionId);
        return next;
      });
    }
  }

  function loadHistoryItem(item: QueryHistoryItem) {
    if (item.connectionId !== activeConnectionId) {
      setActiveConnectionId(item.connectionId);
    }
    setQuery(item.sql);
    closeQueryHistoryDialog();
    window.setTimeout(() => activeEditorApi()?.focus(), 0);
    showActionNotice("success", "SQL loaded", item.connectionName);
  }

  async function runHistoryItem(item: QueryHistoryItem) {
    if (item.connectionId !== activeConnectionId) {
      loadHistoryItem(item);
      showActionNotice(
        "info",
        "SQL loaded",
        "Switched connection; run after it is connected",
      );
      return;
    }
    setQuery(item.sql);
    closeQueryHistoryDialog();
    await runEditorSql(item.sql, { allowMagic: false });
  }

  function exportActiveResult(format: ResultExportFormat) {
    if (!activeResult) {
      showActionNotice("info", "No result to export");
      return;
    }
    const target = inferEditTarget();
    const exported = buildResultExport(
      activeResult,
      format,
      target?.table ?? "query_result",
    );
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
    showActionNotice(
      "success",
      "Export started",
      resultExportFileName(activeConnectionId, format),
    );
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
      showActionNotice("success", "ERD SVG exported", erdFileName(activeConnectionId, "svg"));
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", "ERD export failed", message);
    }
  }

  async function downloadDiagramPng() {
    try {
      const { markup, width, height } = currentDiagramSvgMarkup();
      const blob = await svgMarkupToPngBlob(markup, width, height);
      downloadBlob(blob, erdFileName(activeConnectionId, "png"));
      setDiagramError(null);
      showActionNotice("success", "ERD PNG exported", erdFileName(activeConnectionId, "png"));
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", "ERD export failed", message);
    }
  }

  async function copyDiagramSvg() {
    try {
      const { markup } = currentDiagramSvgMarkup();
      await writeTextToClipboard(markup);
      setDiagramError(null);
      showActionNotice("success", "ERD SVG copied");
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", "Copy failed", message);
    }
  }

  async function copyDiagramPng() {
    try {
      const { markup, width, height } = currentDiagramSvgMarkup();
      const blob = await svgMarkupToPngBlob(markup, width, height);
      await writePngBlobToClipboard(blob);
      setDiagramError(null);
      showActionNotice("success", "ERD PNG copied");
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", "Copy failed", message);
    }
  }

  function fitDiagramToViewport() {
    if (!diagramLayout || !diagramCanvasRef.current) {
      return;
    }
    const bounds = diagramCanvasRef.current.getBoundingClientRect();
    const nextZoom = clampNumber(
      Math.min(
        bounds.width / diagramLayout.width,
        bounds.height / diagramLayout.height,
      ),
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
      const message = "Unsupported import file type";
      setImportError(message);
      showActionNotice("error", "Import failed", message);
      return;
    }
    const text = await file.text();
    if (kind === "sql") {
      setQuery(text);
      showActionNotice("success", "SQL loaded", file.name);
      return;
    }
    if (kind === "excel") {
      const message = "Excel import is not available in the desktop UI yet";
      setImportError(message);
      showActionNotice("error", "Import failed", message);
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
      showActionNotice(
        "success",
        "Import preview ready",
        `${file.name} · ${toCount(parsed.totalRows)} rows`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setImportError(message);
      showActionNotice("error", "Import failed", message);
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
    showActionNotice("success", "Import SQL generated", importPreview.tableName);
  }

  function openBlankSchemaDesigner() {
    setSchemaDraft(blankSchemaDraft());
    setSchemaDesignerOpen(true);
  }

  function openObjectSchemaDesigner(object: DbObjectMetadata) {
    setSchemaDraft(schemaDraftFromObject(object));
    setSchemaDesignerOpen(true);
  }

  async function openTableData(object: DbObjectMetadata) {
    if (object.kind !== "table" && object.kind !== "view") {
      return;
    }
    const sql = tablePreviewSql(editorEngine, object);
    setQuery(sql);
    setObjectActionMenu(null);
    setTableViewObject(object);
    setResultMode("data");
    if (activeConnectionOpen) {
      await executeQuery(sql, undefined, { sourceObject: object });
    }
  }

  function putSchemaSqlInEditor() {
    setQuery(buildSchemaSql(schemaDraft));
    setSchemaDesignerOpen(false);
    showActionNotice("success", "Schema SQL generated", schemaDraft.table);
  }

  async function copySchemaSql() {
    try {
      await writeTextToClipboard(schemaSqlPreview);
      showActionNotice("success", "Schema SQL copied");
    } catch (error) {
      showActionNotice("error", "Copy failed", errorMessage(error));
    }
  }

  function insertCompletionHint(hint: CompletionHint) {
    activeEditorApi()?.insertText(hint.insertText);
    activeEditorApi()?.focus();
  }

  function updateSchemaColumn(id: string, patch: Partial<SchemaColumnDraft>) {
    setSchemaDraft((current) => ({
      ...current,
      columns: current.columns.map((column) =>
        column.id === id ? { ...column, ...patch } : column,
      ),
    }));
  }

  function updateSchemaIndex(id: string, patch: Partial<SchemaIndexDraft>) {
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

  function saveCurrentQuery() {
    try {
      window.localStorage.setItem(savedQueryStorageKey, query);
      showActionNotice("success", "Query saved", activeTabLabel ?? "scratch");
    } catch (error) {
      showActionNotice("error", "Query save failed", errorMessage(error));
    }
  }

  async function copyAppDiagnostics() {
    const diagnostics = [
      `${APP_NAME} ${APP_VERSION}`,
      `Identifier: ${APP_IDENTIFIER}`,
      `Runtime: ${tauriRuntimeError() ? "browser preview" : "Tauri desktop"}`,
      `Theme: ${theme.kind}`,
      `Active connection: ${activeConnectionId}`,
      `Connection status: ${activeConnectionOpen ? "connected" : "closed"}`,
      `Engine: ${activeEngine}`,
      `User agent: ${navigator.userAgent}`,
    ].join("\n");
    try {
      await navigator.clipboard?.writeText(diagnostics);
      showActionNotice("success", "Diagnostics copied");
    } catch (error) {
      showActionNotice("error", "Copy failed", errorMessage(error));
    }
  }

  function formatQuery() {
    const error = activeEditorApi()?.format();
    setQueryError(error ?? null);
    if (error) {
      showActionNotice("error", "Format failed", error);
    } else {
      showActionNotice("success", "SQL formatted", formatter);
    }
  }

  async function runQuery() {
    setRunMenuOpen(false);
    const selection = activeEditorApi()?.getSelection() ?? editorSelection;
    const sqlToRun = selectedOrCurrentStatement(
      selection.from,
      selection.to,
      query,
    );
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  async function runSelectionQuery() {
    setRunMenuOpen(false);
    const selection = activeEditorApi()?.getSelection() ?? editorSelection;
    const sqlToRun = query.slice(selection.from, selection.to).trim();
    if (!sqlToRun) {
      showActionNotice("info", "No selection to run");
      return;
    }
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  async function runCurrentQuery() {
    setRunMenuOpen(false);
    const selection = activeEditorApi()?.getSelection() ?? editorSelection;
    const cursor = selection.to;
    const sqlToRun = selectedOrCurrentStatement(cursor, cursor, query);
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  async function runFromStartQuery() {
    setRunMenuOpen(false);
    const selection = activeEditorApi()?.getSelection() ?? editorSelection;
    const cursor = Math.max(selection.from, selection.to);
    const sqlToRun = query.slice(0, cursor).trim();
    await runEditorSql(sqlToRun, { allowMagic: false });
  }

  async function runAllQuery() {
    setRunMenuOpen(false);
    await runEditorSql(query.trim(), { allowMagic: false });
  }

  async function runEditorSql(
    sqlToRun: string,
    options: { allowMagic: boolean },
  ) {
    if (!activeConnectionOpen) {
      const message = `not connected: ${activeConnectionId}`;
      setQueryError(message);
      showActionNotice("error", "Run failed", message);
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setQueryError(runtimeError);
      showActionNotice("error", "Run failed", runtimeError);
      return;
    }
    if (!sqlToRun) {
      setQueryError("query is empty");
      showActionNotice("info", "Nothing to run");
      return;
    }
    const magic = options.allowMagic ? parseQueryMagic(sqlToRun, activeEngine) : null;
    if (magic) {
      await runQueryMagic(magic);
      return;
    }
    await runSqlWithParameterPrompt(sqlToRun);
  }

  async function runQueryMagic(magic: QueryMagicAction) {
    switch (magic.kind) {
      case "error":
        setQueryError(magic.message);
        return;
      case "sql":
        setQuery(magic.sql);
        await runSqlWithParameterPrompt(magic.sql);
        return;
      case "erd":
        if (!activeConnectionOpen) {
          setQueryError(`not connected: ${activeConnectionId}`);
          return;
        }
        if (!activeMetadata && !activeMetadataLoading) {
          await refreshObjects(activeConnectionId, true);
        }
        pendingDiagramSearchRef.current = magic.search;
        setDiagramSearch(magic.search);
        setDiagramOpen(true);
        setQueryError(null);
        return;
      case "export":
        if (!activeResult) {
          setQueryError("No result to export yet.");
          return;
        }
        exportActiveResult(magic.format);
        setQueryError(null);
        return;
      case "params":
        setQuery(magic.sql);
        await openQueryParameterPrompt(magic.sql, true);
        return;
    }
  }

  async function runSqlWithParameterPrompt(sqlToRun: string) {
    const openedPrompt = await openQueryParameterPrompt(sqlToRun, false);
    if (openedPrompt) {
      return;
    }
    await executeQuery(sqlToRun);
  }

  async function openQueryParameterPrompt(
    sqlToRun: string,
    requirePrompt: boolean,
  ) {
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setQueryError(runtimeError);
      showActionNotice("error", "Parameter scan failed", runtimeError);
      return true;
    }
    try {
      const promptSet = await dbQueryParameters(sqlToRun);
      if (promptSet.prompts.length > 0) {
        const remembered = queryParameterMemory[promptSet.signature] ?? {};
        setParameterDraftValues(
          Object.fromEntries(
            promptSet.prompts.map((prompt) => [
              prompt.id,
              remembered[prompt.id] ?? "",
            ]),
          ),
        );
        setPendingQueryParameters({ sql: sqlToRun, promptSet });
        setQueryError(null);
        return true;
      }
      if (requirePrompt) {
        setQueryError("No query parameters found in this SQL.");
        showActionNotice("info", "No parameters found");
        return true;
      }
    } catch (error) {
      const message = errorMessage(error);
      setQueryError(message);
      showActionNotice("error", "Parameter scan failed", message);
      return true;
    }
    return false;
  }

  async function executeQuery(
    sqlToRun: string,
    params?: QueryParameterInput[],
    options: { sourceObject?: DbObjectMetadata } = {},
  ) {
    if (!activeConnectionOpen) {
      const message = `not connected: ${activeConnectionId}`;
      setQueryError(message);
      showActionNotice("error", "Run failed", message);
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setQueryError(runtimeError);
      showActionNotice("error", "Run failed", runtimeError);
      return;
    }
    if (!sqlToRun.trim()) {
      setQueryError("query is empty");
      showActionNotice("info", "Nothing to run");
      return;
    }
    setRunning(true);
    setQueryError(null);
    setLastRunSql(sqlToRun);
    setResultMode("data");
    setTableViewObject(options.sourceObject ?? null);
    setActiveResultIndex(0);
    // A new run invalidates any staged edits and resets the scroll/filter/sort view.
    resetEdits();
    resetGridView();
    // Release the previous disk-offloaded result (EXEC-010) so its temp file is
    // freed before this run replaces it.
    releaseActiveSpill();
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
    let publishRaf: number | null = null;
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
      const publishStreamResultNow = () => {
        if (publishRaf !== null) {
          window.cancelAnimationFrame(publishRaf);
          publishRaf = null;
        }
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
      const scheduleStreamResultPublish = () => {
        if (publishRaf !== null) {
          return;
        }
        publishRaf = window.requestAnimationFrame(() => {
          publishRaf = null;
          publishStreamResultNow();
        });
      };
      const finalizeSpillRun = (spill: SpillRunResult) => {
        const first = ensureResultSet(0);
        const totalRows = Number(spill.totalRows);
        const source = new WindowedRows({
          total: totalRows,
          columnCount: spill.columns.length,
          pageSize: RESULT_WINDOW_PAGE_SIZE,
          maxResidentPages: RESULT_WINDOW_MAX_RESIDENT_PAGES,
        });
        source.ingest(0, first.rows);
        spillRef.current = { handle: spill.handle, source };
        pendingPagesRef.current.clear();
        setSpillInfo({ handle: spill.handle, total: totalRows });
        setGridWindowVersion((version) => version + 1);
        setResult({
          columns: spill.columns,
          rows: createWindowedRowsProxy(source) as QueryResult["rows"],
          rowCount: spill.totalRows,
          elapsedMs: spill.elapsedMs,
          truncated: spill.truncated,
          message: spill.spilled
            ? "result retained on disk; scrolling pages rows on demand"
            : spill.truncated
              ? "result capped at memory budget"
              : undefined,
        });
        appendHistory({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          connectionId: activeConnectionId,
          connectionName: activeConnection.name,
          engine: activeConnection.engine,
          sql: sqlToRun,
          status: "ok",
          rowCount: totalRows,
          elapsedMs: Number(spill.elapsedMs),
          truncated: spill.truncated,
          ranAt,
        });
        if (/^\s*(alter|create|drop|rename|truncate)\b/i.test(sqlToRun)) {
          void refreshObjects(activeConnectionId, true);
        }
        showActionNotice(
          "success",
          "Query finished",
          `${toCount(totalRows)} rows in ${toCount(spill.elapsedMs)} ms`,
        );
      };
      if (resultOffloadEnabled) {
        // EXEC-010 disk offload: stream the resident first page for an immediate
        // paint, then hand the grid a windowed source that pages the rest from disk.
        const spill = await runQuerySpill(
          {
            connectionId: activeConnectionId,
            sql: sqlToRun,
            memoryBudget: resultMemoryBudget,
            offloadEnabled: true,
            queryId,
            params,
          },
          (event) => {
            switch (event.type) {
              case "columns":
                ensureResultSet(event.resultSetIndex).columns = event.columns;
                publishStreamResultNow();
                break;
              case "rows": {
                const set = ensureResultSet(event.resultSetIndex);
                set.rows.push(...event.rows);
                set.rowCount = BigInt(set.rows.length);
                set.elapsedMs = BigInt(Math.round(performance.now() - started));
                scheduleStreamResultPublish();
                break;
              }
            }
          },
        );
        finalizeSpillRun(spill);
      } else {
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
                publishStreamResultNow();
                break;
              case "rows":
                {
                  const set = ensureResultSet(event.resultSetIndex);
                  set.rows.push(...event.rows);
                  set.rowCount = BigInt(set.rows.length);
                  set.elapsedMs = BigInt(
                    Math.round(performance.now() - started),
                  );
                }
                scheduleStreamResultPublish();
                break;
              case "done":
              for (const summary of event.resultSets) {
                const set = ensureResultSet(summary.resultSetIndex);
                set.rowCount = BigInt(summary.rowCount);
                set.elapsedMs = BigInt(summary.elapsedMs || event.elapsedMs);
                set.truncated = summary.truncated;
                set.message = summary.truncated
                  ? "result capped at 10000 rows"
                  : undefined;
              }
              publishStreamResultNow();
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
              showActionNotice(
                "success",
                "Query finished",
                `${toCount(event.rowCount)} rows in ${toCount(event.elapsedMs)} ms`,
              );
              break;
            case "error":
              setQueryError(event.message);
              showActionNotice("error", "Query failed", event.message);
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
      }
    } catch (error) {
      const message = errorMessage(error);
      setQueryError(message);
      showActionNotice("error", "Query failed", message);
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
      if (publishRaf !== null) {
        window.cancelAnimationFrame(publishRaf);
      }
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
      showActionNotice("info", "Cancel requested");
    } catch {
      // Best-effort: if the run already finished there is nothing to cancel.
      showActionNotice("info", "Query already finished");
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
          "--editor-split-primary": `${editorSplitPercent}%`,
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
        <div className="brand" title={APP_NAME} aria-label={APP_NAME}>
          <img className="brand-icon" src="/irodori-icon.svg" alt="" />
        </div>
        <div className="titlebar-actions">
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
          <button
            className="theme-toggle"
            type="button"
            title="Settings"
            aria-label="Settings"
            onClick={() => {
              openSettingsSection("general");
            }}
          >
            <Settings size={15} />
          </button>
          <button
            className="theme-toggle"
            type="button"
            title="Help"
            aria-label="Help"
            onClick={() => setAboutOpen(true)}
          >
            <HelpCircle size={15} />
          </button>
          <button
            className="theme-toggle"
            type="button"
            title="Workspace menu"
            aria-label="Workspace menu"
            aria-expanded={workspaceMenuOpen}
            onClick={() => setWorkspaceMenuOpen((open) => !open)}
          >
            <Menu size={15} />
          </button>
          {workspaceMenuOpen ? (
            <div className="app-menu-popover" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setWorkspaceMenuOpen(false);
                  setConnectionManagerOpen(true);
                }}
              >
                Connection Manager
                <kbd>Ctrl+Shift+D</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setWorkspaceMenuOpen(false);
                  openSettingsSection("keymap");
                }}
              >
                Keyboard Shortcuts
                <kbd>Ctrl+,</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setWorkspaceMenuOpen(false);
                  openSettingsSection("general");
                }}
              >
                Settings
              </button>
              <span className="menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setWorkspaceMenuOpen(false);
                  setAboutOpen(true);
                }}
              >
                Help
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setWorkspaceMenuOpen(false);
                  setAboutOpen(true);
                }}
              >
                About {APP_NAME}
                <kbd>v{APP_VERSION}</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setWorkspaceMenuOpen(false);
                  setThemeKind((kind) => (kind === "dark" ? "light" : "dark"));
                }}
              >
                {themeKind === "dark" ? "Light Theme" : "Dark Theme"}
              </button>
            </div>
          ) : null}
        </div>
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
          {sidebarOpen ? (
            <PanelLeftClose size={15} />
          ) : (
            <PanelLeftOpen size={15} />
          )}
        </button>
        <button
          className="connection-select"
          type="button"
          onClick={() => setConnectionManagerOpen(true)}
        >
          <span
            className="connection-color-dot"
            style={{ background: activeConnectionColor }}
            aria-hidden="true"
          />
          <span>{activeConnection.name}</span>
          <small>{activeConnection.engine}</small>
          <ChevronDown size={15} />
        </button>
        <div className="toolbar-spacer" />
      </section>

      <div
        className={sidebarOpen ? "workspace" : "workspace sidebar-collapsed"}
      >
        <nav className="connection-rail" aria-label="Connections">
          <button
            className="rail-action"
            type="button"
            title="New connection"
            aria-label="New connection"
            onClick={() => {
              addProfile();
              setConnectionManagerOpen(true);
            }}
          >
            <Plus size={16} />
          </button>
          <div className="rail-connection-list">
            {connections.map((connection) => {
              const profile = profileById.get(connection.id);
              const active = connection.id === activeConnectionId;
              const connected = connectedIds.has(connection.id);
              return (
                <button
                  className={`rail-connection${active ? " active" : ""}`}
                  key={connection.id}
                  type="button"
                  title={`${connection.name} · ${connection.engine}${
                    connected ? " · connected" : " · closed"
                  }`}
                  aria-label={`Switch to ${connection.name}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    setActiveConnectionId(connection.id);
                    if (profile) {
                      selectProfile(profile);
                    }
                  }}
                  onDoubleClick={() => setConnectionManagerOpen(true)}
                >
                  <Database size={17} />
                  <span
                    className="connection-color-dot"
                    style={{
                      background: profile?.color || defaultConnectionColor,
                    }}
                    aria-hidden="true"
                  />
                  <i className={connected ? "connected" : ""} aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <button
            className="rail-action"
            type="button"
            title="Connection manager"
            aria-label="Connection manager"
            onClick={() => setConnectionManagerOpen(true)}
          >
            <Settings size={16} />
          </button>
        </nav>
        {sidebarOpen ? (
          <aside className="sidebar">
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
                  onClick={() => refreshObjects(activeConnectionId, true, true)}
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
                        {schema.objects.map((object) => {
                          const objectKey = `${object.schema}.${object.name}`;
                          const canOpenData =
                            object.kind === "table" || object.kind === "view";
                          return (
                          <details
                            className="object-tree"
                            key={objectKey}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setObjectActionMenu(objectKey);
                            }}
                          >
                            <summary>
                              {object.kind === "procedure" || object.kind === "function" ? (
                                <TerminalSquare size={15} />
                              ) : (
                                <Table2 size={15} />
                              )}
                              <button
                                className="object-name-button"
                                type="button"
                                disabled={!canOpenData}
                                title={
                                  canOpenData
                                    ? `Open ${qualifiedObjectName(editorEngine, object)}`
                                    : objectKindLabel(object)
                                }
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void openTableData(object);
                                }}
                              >
                                {object.name}
                              </button>
                              <small>
                                {objectKindLabel(object)} ·{" "}
                                {object.columns.length}
                              </small>
                              <button
                                className="object-menu-button"
                                type="button"
                                title="Object actions"
                                aria-label={`Actions for ${object.name}`}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setObjectActionMenu((current) =>
                                    current === objectKey ? null : objectKey,
                                  );
                                }}
                              >
                                <MoreHorizontal size={14} />
                              </button>
                              {objectActionMenu === objectKey ? (
                                <div className="object-action-menu" role="menu">
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={!canOpenData}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      void openTableData(object);
                                    }}
                                  >
                                    Open Data
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={object.kind !== "table"}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      openObjectSchemaDesigner(object);
                                      setObjectActionMenu(null);
                                    }}
                                  >
                                    Structure
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    disabled={!hasDiagram(activeMetadata)}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      pendingDiagramSearchRef.current = object.name;
                                      setDiagramSearch(object.name);
                                      setDiagramOpen(true);
                                      setObjectActionMenu(null);
                                    }}
                                  >
                                    Show in ERD
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      void navigator.clipboard?.writeText(
                                        qualifiedObjectName(editorEngine, object),
                                      );
                                      setObjectActionMenu(null);
                                    }}
                                  >
                                    Copy Name
                                  </button>
                                </div>
                              ) : null}
                            </summary>
                            <div className="metadata-children">
                              {object.kind === "table" ? (
                                <button
                                  className="metadata-row"
                                  type="button"
                                  title={`Design ${object.name}`}
                                  onClick={() =>
                                    openObjectSchemaDesigner(object)
                                  }
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
                          );
                        })}
                      </details>
                    ))
                  ) : (
                    <div className="empty-browser">No objects found</div>
                  )
                ) : activeConnection.objects.length > 0 ? (
                  activeConnection.objects.map((object) => (
                    <button
                      className="object-row"
                      key={object.name}
                      type="button"
                      onClick={() => {
                        if (object.kind === "procedure") {
                          return;
                        }
                        const sql =
                          editorEngine === "sqlserver"
                            ? `select top (200) * from ${quoteSqlIdentifier(editorEngine, object.name)};`
                            : `select * from ${quoteSqlIdentifier(editorEngine, object.name)} limit 200;`;
                        setQuery(sql);
                        if (activeConnectionOpen) {
                          void executeQuery(sql);
                        }
                      }}
                    >
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
            <QueryEditorPane
              activeTabLabel={activeTabLabel}
              activeConnectionOpen={activeConnectionOpen}
              running={running}
              formatter={formatter}
              query={query}
              onQueryChange={setQuery}
              editorEngine={editorEngine}
              activeMetadata={activeMetadata}
              theme={theme}
              vimMode={vimMode}
              sqlLinter={sqlLinter}
              editorApiRef={editorApiRef}
              secondaryEditorApiRef={secondaryEditorApiRef}
              editorSplitRef={editorSplitRef}
              editorSplitOpen={editorSplitOpen}
              editorSplitMode={editorSplitMode}
              setEditorSplitMode={setEditorSplitMode}
              activeEditorGroup={activeEditorGroup}
              setActiveEditorGroup={setActiveEditorGroup}
              setEditorSelection={setEditorSelection}
              runPrimaryLabel={runPrimaryLabel}
              runShortcutLabel={runShortcutLabel}
              runCurrentShortcutLabel={runCurrentShortcutLabel}
              runFromStartShortcutLabel={runFromStartShortcutLabel}
              runAllShortcutLabel={runAllShortcutLabel}
              runMenuOpen={runMenuOpen}
              hasSelectedEditorSql={hasSelectedEditorSql}
              runCommand={runCommand}
              saveCurrentQuery={saveCurrentQuery}
              runQuery={runQuery}
              runSelectionQuery={runSelectionQuery}
              runCurrentQuery={runCurrentQuery}
              runFromStartQuery={runFromStartQuery}
              runAllQuery={runAllQuery}
              cancelQuery={cancelQuery}
              setRunMenuOpen={setRunMenuOpen}
              beginEditorSplitResize={(event) =>
                beginPanelResize("editorSplit", event)
              }
              onEditorSplitResizeKey={(event) =>
                onPanelResizeKey("editorSplit", event)
              }
            />

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
                    <div className="empty-browser loading">
                      Loading metadata
                    </div>
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
                    <div className="empty-browser">
                      Connect to load completion metadata
                    </div>
                  )}
                </div>
              </section>
              <QueryHistorySidebar
                activeConnectionId={activeConnectionId}
                connectionById={connectionById}
                onLoad={(item) => setQuery(item.sql)}
              />
            </aside>
          </div>

          <section
            className={running ? "results-pane is-running" : "results-pane"}
          >
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
                {tableViewObject ? (
                  <div className="segmented-control result-mode-toggle">
                    <button
                      type="button"
                      className={resultMode === "data" ? "active" : undefined}
                      onClick={() => setResultMode("data")}
                    >
                      Data
                    </button>
                    <button
                      type="button"
                      className={
                        resultMode === "structure" ? "active" : undefined
                      }
                      onClick={() => setResultMode("structure")}
                    >
                      Structure
                    </button>
                  </div>
                ) : null}
                {resultSets.length > 1 ? (
                  <div
                    className="result-tabs"
                    role="tablist"
                    aria-label="Result sets"
                  >
                    {resultSets.map((set, index) => (
                      <button
                        key={set.statementIndex}
                        type="button"
                        role="tab"
                        aria-selected={index === activeResultIndex}
                        className={
                          index === activeResultIndex ? "active" : undefined
                        }
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
                    disabled={!activeResult || Boolean(showingStructure)}
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
                  disabled={!activeResult || Boolean(showingStructure)}
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <ListFilter size={13} />
                  <span>
                    {activeFilters.length > 0
                      ? `Filter ${activeFilters.length}`
                      : "Filter"}
                  </span>
                </button>
                <div className="action-split">
                  <button
                    className="text-button"
                    type="button"
                    disabled={!activeResult || Boolean(showingStructure)}
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
                    disabled={!activeResult || Boolean(showingStructure)}
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
                          <small>
                            .
                            {
                              buildResultExport(
                                { columns: [], rows: [] },
                                format.id,
                              ).extension
                            }
                          </small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  className="text-button"
                  type="button"
                  disabled={!activeResult || Boolean(showingStructure)}
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
                      disabled={!canEditActiveResult() || Boolean(showingStructure)}
                      title="Requires a single-table result with a visible primary or unique key"
                      onClick={addNewRow}
                    >
                      + Row
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      disabled={pendingCount === 0 || committing || Boolean(showingStructure)}
                      onClick={() => void commitEdits()}
                    >
                      {committing
                        ? "Committing…"
                        : `Commit${pendingCount ? ` (${pendingCount})` : ""}`}
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
                    disabled={!canEditActiveResult() || Boolean(showingStructure)}
                    title="Requires a single-table result with a visible primary or unique key"
                    onClick={() => {
                      setCommitError(null);
                      setEditMode(true);
                    }}
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
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Filter join"
                  >
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
                              <option
                                key={operator.value}
                                value={operator.value}
                              >
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
            {structureObject ? (
              <div className="structure-view">
                <section className="structure-section">
                  <header>
                    <strong>{qualifiedObjectName(editorEngine, structureObject)}</strong>
                    <span>
                      {structureObject.columns.length} columns
                      {structureObject.rowEstimate
                        ? ` · ~${toCount(structureObject.rowEstimate)} rows`
                        : ""}
                    </span>
                  </header>
                  <div className="structure-table-wrap">
                    <table className="structure-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Null</th>
                          <th>Key</th>
                          <th>Default</th>
                          <th>Comment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {structureObject.columns.map((column) => (
                          <tr key={`${column.ordinal}:${column.name}`}>
                            <td>{column.name}</td>
                            <td>{column.dataType}</td>
                            <td>{column.nullable ? "YES" : "NO"}</td>
                            <td>
                              {structureObject.primaryKey.includes(column.name)
                                ? "PK"
                                : ""}
                            </td>
                            <td>{column.defaultValue || ""}</td>
                            <td>{column.comment || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="structure-side">
                  <div className="structure-card">
                    <strong>Primary Key</strong>
                    <span>
                      {structureObject.primaryKey.length > 0
                        ? structureObject.primaryKey.join(", ")
                        : "No primary key"}
                    </span>
                  </div>
                  <div className="structure-card">
                    <strong>Indexes</strong>
                    {structureObject.indexes.length > 0 ? (
                      structureObject.indexes.map((index) => (
                        <span key={index.name}>
                          {index.name || "(unnamed)"} ·{" "}
                          {index.unique ? "unique" : "index"} ·{" "}
                          {index.columns.join(", ")}
                        </span>
                      ))
                    ) : (
                      <span>No indexes loaded</span>
                    )}
                  </div>
                  <div className="structure-card">
                    <strong>Foreign Keys</strong>
                    {structureObject.foreignKeys.length > 0 ? (
                      structureObject.foreignKeys.map((fk, index) => (
                        <span key={`${fk.referencesTable}:${index}`}>
                          {fk.columns.join(", ")} -&gt;{" "}
                          {[fk.referencesSchema, fk.referencesTable]
                            .filter(Boolean)
                            .join(".")}
                          ({fk.referencesColumns.join(", ")})
                        </span>
                      ))
                    ) : (
                      <span>No outgoing foreign keys</span>
                    )}
                  </div>
                  {structureObject.ddl ? (
                    <pre className="sql-preview structure-ddl">
                      {structureObject.ddl}
                    </pre>
                  ) : null}
                </section>
              </div>
            ) : (
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
                  {editMode ? (
                    <span className="grid-gutter" aria-hidden="true" />
                  ) : null}
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
                        onClick={(event) =>
                          toggleSort(colIndex, event.shiftKey)
                        }
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
                    style={{
                      height: topPad,
                      minWidth: gridTotalWidth,
                      width: gridTotalWidth,
                    }}
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
                    {filtersActive && unfilteredRowCount > 0
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
                        editingCell?.key === row.key &&
                        editingCell.col === cellIndex;
                      const isEdited =
                        row.origin.kind === "orig" &&
                        cellEdits.has(`o${row.origin.index}:${cellIndex}`);
                      const isSelected =
                        selectedCell?.key === row.key &&
                        selectedCell.col === cellIndex;
                      const isNullCell = cell === "NULL";
                      const isEmptyCell = cell === "";
                      const cellClass = [
                        isEdited ? "cell-edited" : "",
                        isSelected ? "cell-selected" : "",
                        isNullCell ? "cell-null" : "",
                        isEmptyCell ? "cell-empty" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <span
                          role="cell"
                          key={cellIndex}
                          aria-colindex={
                            editMode ? cellIndex + 2 : cellIndex + 1
                          }
                          aria-selected={isSelected}
                          className={cellClass || undefined}
                          title={isEmptyCell ? "EMPTY string" : cell}
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
                                  setCellValue(
                                    row.origin,
                                    cellIndex,
                                    event.target.value,
                                  );
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
                            isEmptyCell ? (
                              <em className="cell-token">EMPTY</em>
                            ) : isNullCell ? (
                              <em className="cell-token">NULL</em>
                            ) : (
                              cell
                            )
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
            )}
          </section>
        </section>
      </div>

      <footer className="statusbar">
        <span>
          <span
            className="connection-color-dot"
            style={{ background: activeConnectionColor }}
            aria-hidden="true"
          />
          {activeConnectionStatus}
        </span>
        <span>{activeTransportLabel}</span>
        <span>
          {vimMode ? "Vim" : "Default"} · {query.split("\n").length} lines ·{" "}
          {sqlLinter === "gentle" ? "lint on" : "lint off"} ·{" "}
          {running ? "running" : "idle"}
        </span>
      </footer>

      {connectionManagerOpen ? (
        <div
          className="palette-overlay connection-overlay"
          onClick={() => setConnectionManagerOpen(false)}
          role="presentation"
        >
          <div
            className="connection-dialog"
            role="dialog"
            aria-label="Connection manager"
            onClick={(event) => event.stopPropagation()}
          >
            <aside className="connection-picker">
              <div className="connection-picker-header">
                <button
                  className="icon-button"
                  type="button"
                  title="New connection"
                  aria-label="New connection"
                  onClick={addProfile}
                >
                  <Plus size={16} />
                </button>
                <label className="connection-search">
                  <Search size={15} />
                  <input
                    autoFocus
                    value={connectionSearch}
                    placeholder="Search connections"
                    onChange={(event) =>
                      setConnectionSearch(event.currentTarget.value)
                    }
                  />
                </label>
              </div>
              <div className="connection-profile-list">
                {filteredProfiles.map((profile) => {
                  const connected = connectedIds.has(profile.id);
                  return (
                    <button
                      key={profile.id}
                      className={
                        profile.id === selectedProfileId
                          ? "connection-profile active"
                          : "connection-profile"
                      }
                      type="button"
                      onClick={() => selectProfile(profile)}
                    >
                      <span
                        className="connection-color-dot"
                        style={{ background: profile.color }}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{profile.name}</strong>
                        <small>
                          {engineLabel(profile.engine)}
                          {profile.database ? ` · ${profile.database}` : ""}
                        </small>
                      </span>
                      <i className={connected ? "connected" : ""} />
                    </button>
                  );
                })}
              </div>
              <div className="connection-picker-empty">
                {filteredProfiles.length === 0 ? "No matching connections" : null}
              </div>
            </aside>
            <form className="connection-form" onSubmit={connectActiveProfile}>
              <div className="dialog-header">
                <strong>{draft.name.trim() || "New Connection"}</strong>
                <span>{engineLabel(draft.engine)}</span>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setConnectionManagerOpen(false)}
                >
                  Close
                </button>
              </div>
              <div className="dialog-body connection-form-body">
                <label className="full-row">
                  <span>Connection name</span>
                  <input
                    value={draft.name}
                    placeholder="Connection's name"
                    onChange={(event) =>
                      updateDraft({ name: event.currentTarget.value })
                    }
                  />
                </label>
                <div className="connection-color-row full-row">
                  <span>Color tag</span>
                  <div className="connection-color-options">
                    {connectionColorOptions.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={
                          draft.color === color
                            ? "connection-color-swatch active"
                            : "connection-color-swatch"
                        }
                        style={{ background: color }}
                        aria-label={`Use color ${color}`}
                        onClick={() => updateDraft({ color })}
                      />
                    ))}
                  </div>
                </div>
                <div className="connection-form-grid">
                  <label>
                    <span>Engine</span>
                    <select
                      value={draft.engine}
                      onChange={(event) =>
                        updateDraft({
                          engine: event.currentTarget.value as DbEngine,
                        })
                      }
                    >
                      {engineOptions.map((engine) => (
                        <option key={engine.value} value={engine.value}>
                          {engine.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Profile ID</span>
                    <input
                      value={draft.id}
                      onChange={(event) =>
                        updateDraft({ id: event.currentTarget.value })
                      }
                    />
                  </label>
                  <div className="mode-toggle form-toggle" aria-label="Connection input mode">
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
                  <label className="full-row">
                    <span>URL / DSN</span>
                    <input
                      value={draft.url}
                      placeholder="postgres://user:password@host:5432/database"
                      onChange={(event) =>
                        updateDraft({ url: event.currentTarget.value })
                      }
                    />
                  </label>
                ) : (
                  <div className="connection-form-grid">
                    <label>
                      <span>Host / socket</span>
                      <input
                        value={draft.host}
                        placeholder="localhost"
                        onChange={(event) =>
                          updateDraft({ host: event.currentTarget.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Port</span>
                      <input
                        inputMode="numeric"
                        value={draft.port}
                        onChange={(event) =>
                          updateDraft({ port: event.currentTarget.value })
                        }
                      />
                    </label>
                    <label>
                      <span>User</span>
                      <input
                        value={draft.user}
                        onChange={(event) =>
                          updateDraft({ user: event.currentTarget.value })
                        }
                      />
                    </label>
                    <label>
                      <span>Password</span>
                      <input
                        type="password"
                        value={draft.password}
                        placeholder="Session only"
                        onChange={(event) =>
                          updateDraft({ password: event.currentTarget.value })
                        }
                      />
                    </label>
                    <label className="full-row">
                      <span>Database / service / path</span>
                      <input
                        value={draft.database}
                        onChange={(event) =>
                          updateDraft({ database: event.currentTarget.value })
                        }
                      />
                    </label>
                  </div>
                )}
                <div className="connection-transport full-row">
                  <ShieldCheck size={15} />
                  <span>Transport</span>
                  <strong>Direct TCP / local file</strong>
                </div>
                {connectionError ? (
                  <p className="inline-error full-row">
                    <AlertTriangle size={13} />
                    <span>{connectionError}</span>
                  </p>
                ) : null}
              </div>
              <div className="dialog-footer">
                <button
                  className="text-button danger"
                  type="button"
                  onClick={() => void deleteProfile()}
                >
                  Delete
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={!activeConnectionOpen}
                  onClick={() => void disconnectActiveProfile()}
                >
                  <Power size={13} />
                  Disconnect
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => saveDraft()}
                >
                  Save
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={testingConnection}
                  onClick={() => void testActiveProfile()}
                >
                  {testingConnection ? "Testing" : "Test"}
                </button>
                <button className="primary-action" type="submit" disabled={connecting}>
                  <Database size={14} />
                  {connecting ? "Connecting" : "Connect"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          settingsTab={settingsTab}
          onOpenSection={openSettingsSection}
          onClose={() => setSettingsOpen(false)}
          vimMode={vimMode}
          setVimMode={setVimMode}
          themeKind={themeKind}
          setThemeKind={setThemeKind}
          formatter={formatter}
          setFormatter={setFormatter}
          sqlLinter={sqlLinter}
          setSqlLinter={setSqlLinter}
          resultOffloadEnabled={resultOffloadEnabled}
          setResultOffloadEnabled={setResultOffloadEnabled}
          resultMemoryBudget={resultMemoryBudget}
          setResultMemoryBudget={setResultMemoryBudget}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          commandCatalog={appCommandCatalog}
          keymap={keymap}
          keymapOverrides={keymapOverrides}
          keymapConflicts={keymapConflicts}
          recordingCommand={recordingCommand}
          recordingSequence={recordingSequence}
          runCommand={runCommand}
          beginRecording={beginRecording}
          resetKeybinding={resetKeybinding}
          jobs={jobs}
          jobsLoading={jobsLoading}
          jobsError={jobsError}
          refreshJobs={refreshJobs}
          cancelJob={cancelJob}
          settingsJsonDraft={settingsJsonDraft}
          setSettingsJsonDraft={setSettingsJsonDraft}
          settingsJsonError={settingsJsonError}
          setSettingsJsonError={setSettingsJsonError}
          resetSettingsJsonDraft={resetSettingsJsonDraft}
          applySettingsJson={applySettingsJson}
        />
      ) : null}

      {aboutOpen ? (
        <div
          className="palette-overlay"
          onClick={() => setAboutOpen(false)}
          role="presentation"
        >
          <div
            className="data-dialog about-dialog"
            role="dialog"
            aria-label={`About ${APP_NAME}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <strong>About {APP_NAME}</strong>
              <span>Version and support information</span>
              <button
                className="text-button"
                type="button"
                onClick={() => setAboutOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="about-body">
              <div className="about-mark">
                <img className="about-icon" src="/irodori-icon.svg" alt="" />
                <span>
                  <strong>{APP_NAME}</strong>
                  <small>Database workbench</small>
                </span>
              </div>
              <dl className="about-grid">
                <div>
                  <dt>Version</dt>
                  <dd>{APP_VERSION}</dd>
                </div>
                <div>
                  <dt>Identifier</dt>
                  <dd>{APP_IDENTIFIER}</dd>
                </div>
                <div>
                  <dt>Runtime</dt>
                  <dd>{tauriRuntimeError() ? "Browser preview" : "Tauri desktop"}</dd>
                </div>
                <div>
                  <dt>Active connection</dt>
                  <dd>
                    {activeConnection.name} ·{" "}
                    {activeConnectionOpen ? "connected" : "closed"}
                  </dd>
                </div>
              </dl>
              <div className="about-help">
                <Info size={16} />
                <span>
                  Use Connection Manager for saved database profiles, Settings for
                  editor/keymap/JSON configuration, and the workspace menu for
                  support diagnostics.
                </span>
              </div>
            </div>
            <div className="dialog-footer">
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setAboutOpen(false);
                  openSettingsSection("general");
                }}
              >
                <Settings size={13} />
                Settings
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => void copyAppDiagnostics()}
              >
                <Copy size={13} />
                Copy diagnostics
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <QueryHistoryDialog
        activeConnectionId={activeConnectionId}
        activeConnectionOpen={activeConnectionOpen}
        running={running}
        connectionById={connectionById}
        onLoad={loadHistoryItem}
        onRun={(item) => void runHistoryItem(item)}
      />

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
                              ? {
                                  ...current,
                                  tableName: event.currentTarget.value,
                                }
                              : current,
                          )
                        }
                      />
                    </label>
                    <span className="dialog-stat">
                      {toCount(importPreview.rows.length)} /{" "}
                      {toCount(importPreview.totalRows)} rows
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
                              <td key={columnIndex}>
                                {formatCell(row[columnIndex])}
                              </td>
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
                    onClick={() =>
                      void navigator.clipboard?.writeText(importSqlPreview)
                    }
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
                    const locked =
                      schemaDraft.mode === "alter" && column.existing;
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
                    const locked =
                      schemaDraft.mode === "alter" && index.existing;
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
                    const locked =
                      schemaDraft.mode === "alter" && foreignKey.existing;
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
                onClick={() => void copySchemaSql()}
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
                onClick={() =>
                  setDiagramZoom((zoom) => clampNumber(zoom - 0.1, 0.25, 2))
                }
              >
                <ZoomOut size={13} />
              </button>
              <span className="diagram-zoom">
                {Math.round(diagramZoom * 100)}%
              </span>
              <button
                className="mini-button"
                type="button"
                title="Zoom in"
                aria-label="Zoom in"
                disabled={!diagramLayout}
                onClick={() =>
                  setDiagramZoom((zoom) => clampNumber(zoom + 0.1, 0.25, 2))
                }
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
                  onChange={(event) =>
                    setDiagramSearch(event.currentTarget.value)
                  }
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
              <div
                className="diagram-schema-list"
                role="group"
                aria-label="Schemas"
              >
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
              {!diagramError &&
              (!diagramLayout || diagramLayout.tables.length === 0) ? (
                <div className="grid-state">
                  No tables match the current diagram filters
                </div>
              ) : null}
              {!diagramError &&
              diagramLayout &&
              diagramLayout.tables.length > 0 ? (
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
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {actionNotice ? (
        <div
          className={`action-toast ${actionNotice.kind}`}
          role={actionNotice.kind === "error" ? "alert" : "status"}
          aria-live={actionNotice.kind === "error" ? "assertive" : "polite"}
        >
          <span className="action-toast-mark" aria-hidden="true" />
          <span>
            <strong>{actionNotice.title}</strong>
            {actionNotice.detail ? <small>{actionNotice.detail}</small> : null}
          </span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setActionNotice(null)}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
    </main>
  );
}

export default App;
