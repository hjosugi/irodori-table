import type {
  ConnectionInfo,
  ConnectionProfile,
  DbEngine,
  WorkspaceSnapshot,
} from "../../generated/irodori-api";

export type WorkspaceConnection = WorkspaceSnapshot["connections"][number];
export type ConnectionInputMode = "url" | "fields";

export type ConnectionDraft = {
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

export const profilesStorageKey = "irodori.connectionProfiles.v1";
export const defaultConnectionColor = "#6b7280";
export const connectionColorOptions = [
  defaultConnectionColor,
  "#2563eb",
  "#16a34a",
  "#ca8a04",
  "#dc2626",
  "#9333ea",
  "#0891b2",
  "#ea580c",
];

export function normalizeConnectionColor(
  value: unknown,
  fallback = defaultConnectionColor,
) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toLowerCase();
  }
  const short = /^#([0-9a-fA-F]{3})$/.exec(raw);
  if (short) {
    return `#${short[1]
      .split("")
      .map((char) => char + char)
      .join("")}`.toLowerCase();
  }
  return fallback;
}

export const engineOptions: Array<{ value: DbEngine; label: string }> = [
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

const localPostgresSampleUrl =
  "postgres://irodori:irodori@127.0.0.1:55432/samples";

export const starterProfiles: ConnectionDraft[] = [
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

export function engineLabel(engine: DbEngine) {
  return engineOptions.find((item) => item.value === engine)?.label ?? engine;
}

export function describeConnection(
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

export function defaultPort(engine: DbEngine) {
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

export function memoryDefaults(engine: DbEngine): Partial<ConnectionDraft> {
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

export function newDraft(seed: number): ConnectionDraft {
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

export function withStarterProfiles(profiles: ConnectionDraft[]) {
  const existing = new Set(profiles.map((profile) => profile.id));
  return [
    ...profiles,
    ...starterProfiles.filter((profile) => !existing.has(profile.id)),
  ].map(repairBuiltinSampleProfile);
}

export function loadProfiles() {
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
        color: normalizeConnectionColor(profile.color),
        password: "",
        port: profile.port ?? defaultPort(profile.engine),
      })),
    );
  } catch {
    return starterProfiles;
  }
}

export function sanitizedProfile(profile: ConnectionDraft): ConnectionDraft {
  return {
    ...profile,
    color: normalizeConnectionColor(profile.color),
    password: "",
  };
}

export function repairBuiltinSampleProfile(profile: ConnectionDraft): ConnectionDraft {
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
    color: normalizeConnectionColor(profile.color, "#16a34a"),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function settingsProfileFromJson(
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
      color: normalizeConnectionColor(value.color),
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

export function withUniqueProfileIds(profiles: ConnectionDraft[]) {
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

export function validateDraft(draft: ConnectionDraft): string | null {
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

export function profileFromDraft(draft: ConnectionDraft): ConnectionProfile {
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
