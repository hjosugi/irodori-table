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
  { value: "trinoPresto", label: "Trino / Presto" },
  { value: "firebird", label: "Firebird" },
  { value: "databricks", label: "Databricks / Spark SQL" },
  { value: "elasticsearch", label: "Elasticsearch / OpenSearch" },
  { value: "couchbase", label: "Couchbase" },
  { value: "dynamodb", label: "DynamoDB" },
  { value: "scylladb", label: "ScyllaDB" },
  { value: "arangodb", label: "ArangoDB" },
  { value: "questdb", label: "QuestDB" },
  { value: "iotdb", label: "Apache IoTDB" },
  { value: "hive", label: "Apache Hive" },
  { value: "iceberg", label: "Apache Iceberg" },
  { value: "s3Tables", label: "AWS S3 Tables" },
  { value: "objectStore", label: "Object Store (S3/GCS/Azure Blob)" },
  { value: "deltaLake", label: "Delta Lake" },
  { value: "hudi", label: "Apache Hudi" },
];

export type EngineConnectionSettings = {
  preferredMode: ConnectionInputMode;
  urlLabel: string;
  urlPlaceholder: string;
  fieldsLabel: string;
  hostLabel: string;
  hostPlaceholder: string;
  portLabel: string;
  userLabel: string;
  userPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  databaseLabel: string;
  databasePlaceholder: string;
  showHost: boolean;
  showPort: boolean;
  showUser: boolean;
  showPassword: boolean;
  transportLabel: string;
};

const tcpDatabaseSettings: EngineConnectionSettings = {
  preferredMode: "fields",
  urlLabel: "URL / DSN",
  urlPlaceholder: "driver://user:password@host:port/database",
  fieldsLabel: "Fields",
  hostLabel: "Host",
  hostPlaceholder: "localhost",
  portLabel: "Port",
  userLabel: "User",
  userPlaceholder: "username",
  passwordLabel: "Password",
  passwordPlaceholder: "Session only",
  databaseLabel: "Database",
  databasePlaceholder: "database name",
  showHost: true,
  showPort: true,
  showUser: true,
  showPassword: true,
  transportLabel: "Direct TCP",
};

export function engineConnectionSettings(engine: DbEngine): EngineConnectionSettings {
  switch (engine) {
    case "postgres":
    case "timescaledb":
    case "neon":
    case "cockroachdb":
    case "yugabytedb":
    case "redshift":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "postgres://user:password@host:5432/database",
        databaseLabel: "Database",
        databasePlaceholder: "database name",
      };
    case "mysql":
    case "mariadb":
    case "tidb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "mysql://user:password@host:3306/database",
      };
    case "sqlite":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "fields",
        urlPlaceholder: "sqlite:///absolute/path/to/database.sqlite",
        fieldsLabel: "File",
        hostLabel: "File",
        hostPlaceholder: "",
        databaseLabel: "SQLite file / :memory:",
        databasePlaceholder: "/path/to/database.sqlite or :memory:",
        showHost: false,
        showPort: false,
        showUser: false,
        showPassword: false,
        transportLabel: "Local file",
      };
    case "duckdb":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "fields",
        urlPlaceholder: ":memory: or /absolute/path/to/database.duckdb",
        fieldsLabel: "File",
        databaseLabel: "DuckDB file / :memory:",
        databasePlaceholder: "/path/to/database.duckdb or :memory:",
        showHost: false,
        showPort: false,
        showUser: false,
        showPassword: false,
        transportLabel: "Local file",
      };
    case "oracle":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "oracle://user:password@host:1521/service",
        databaseLabel: "Service name / SID",
        databasePlaceholder: "ORCLPDB1",
      };
    case "sqlserver":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "sqlserver://user:password@host:1433;databaseName=database",
        hostLabel: "Server",
      };
    case "h2":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "jdbc:h2:tcp://host:5435/~/database or jdbc:h2:file:./database",
        databaseLabel: "Database path / name",
        databasePlaceholder: "~/database",
        transportLabel: "JDBC / TCP",
      };
    case "mongodb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "mongodb://user:password@host:27017/database",
        databaseLabel: "Database / auth source",
      };
    case "redis":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "redis://:password@host:6379/0",
        userLabel: "Username",
        userPlaceholder: "default",
        databaseLabel: "Database index",
        databasePlaceholder: "0",
      };
    case "snowflake":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "snowflake://user:password@account/db/schema?warehouse=...",
        hostLabel: "Account",
        hostPlaceholder: "org-account",
        databaseLabel: "Database / schema",
        databasePlaceholder: "database/schema",
        transportLabel: "HTTPS",
      };
    case "bigquery":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "url",
        urlLabel: "Project / credentials JSON / DSN",
        urlPlaceholder: "bigquery://project/dataset or credentials JSON path",
        hostLabel: "Project",
        hostPlaceholder: "project-id",
        portLabel: "API port",
        userLabel: "Service account",
        passwordLabel: "Token / key",
        databaseLabel: "Dataset",
        showPort: false,
        transportLabel: "Google API",
      };
    case "bigtable":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "url",
        urlLabel: "Project / instance / credentials",
        urlPlaceholder: "bigtable://project/instance or credentials JSON path",
        hostLabel: "Project / instance",
        hostPlaceholder: "project/instance",
        userLabel: "Service account",
        passwordLabel: "Token / key",
        databaseLabel: "Table / app profile",
        showPort: false,
        transportLabel: "Google API",
      };
    case "databricks":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "databricks://token@workspace-host/sql/warehouse",
        hostLabel: "Workspace host",
        userLabel: "Token user",
        passwordLabel: "Access token",
        databaseLabel: "Catalog / schema",
        transportLabel: "HTTPS",
      };
    case "clickhouse":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "clickhouse://user:password@host:8123/database",
        transportLabel: "HTTP / Native",
      };
    case "questdb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "postgres://user:password@host:8812/qdb",
        databaseLabel: "Database",
        transportLabel: "PostgreSQL wire / HTTP",
      };
    case "iotdb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "iotdb://user:password@host:6667/root",
        databaseLabel: "Storage group / database",
        databasePlaceholder: "root",
        transportLabel: "IoTDB native",
      };
    case "neo4j":
    case "memgraph":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "bolt://user:password@host:7687",
        databaseLabel: "Graph database",
        databasePlaceholder: "neo4j",
        transportLabel: "Bolt",
      };
    case "influxdb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "http://host:8086?org=...&bucket=...",
        userLabel: "Org",
        passwordLabel: "Token",
        databaseLabel: "Bucket / database",
        transportLabel: "HTTP API",
      };
    case "qdrant":
    case "milvus":
    case "pinecone":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "url",
        urlPlaceholder: `${engine}://host`,
        userLabel: "Project / user",
        passwordLabel: "API key / token",
        databaseLabel: "Collection / namespace",
        transportLabel: "Vector API",
      };
    case "elasticsearch":
    case "couchbase":
    case "arangodb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "https://user:password@host:port",
        databaseLabel: "Index / bucket / database",
        transportLabel: "HTTP API",
      };
    case "dynamodb":
    case "s3Tables":
    case "objectStore":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "url",
        urlPlaceholder: "aws://profile/region/resource",
        hostLabel: "Region",
        hostPlaceholder: "us-east-1",
        userLabel: "Access key",
        passwordLabel: "Secret / token",
        databaseLabel: "Table / bucket",
        showPort: false,
        transportLabel: "Cloud API",
      };
    case "trinoPresto":
    case "hive":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "trino://user@host:8080/catalog/schema",
        databaseLabel: "Catalog / schema",
      };
    case "cassandra":
    case "scylladb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "cassandra://user:password@host:9042/keyspace",
        databaseLabel: "Keyspace",
      };
    case "firebird":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "firebird://user:password@host:3050/path/to/database.fdb",
        databaseLabel: "Database path",
      };
    case "deltaLake":
    case "hudi":
    case "iceberg":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "url",
        urlPlaceholder: "file:///lake/table or s3://bucket/table",
        databaseLabel: "Catalog / table path",
        showHost: false,
        showPort: false,
        showUser: false,
        showPassword: false,
        transportLabel: "Lakehouse catalog",
      };
    default:
      return {
        ...tcpDatabaseSettings,
        portLabel: defaultPort(engine) ? "Port" : "Port (optional)",
      };
  }
}

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
    mode: "fields",
    url: "",
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
    case "scylladb":
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
    case "trinoPresto":
      return "8080";
    case "firebird":
      return "3050";
    case "databricks":
    case "dynamodb":
    case "iceberg":
    case "s3Tables":
    case "objectStore":
    case "deltaLake":
    case "hudi":
      return "443";
    case "elasticsearch":
      return "9200";
    case "couchbase":
      return "8091";
    case "arangodb":
      return "8529";
    case "questdb":
      return "8812";
    case "iotdb":
      return "6667";
    case "hive":
      return "10000";
    case "oracle":
      return "1521";
    default:
      return "";
  }
}

export function memoryDefaults(engine: DbEngine): Partial<ConnectionDraft> {
  const settings = engineConnectionSettings(engine);
  if (engine === "sqlite") {
    return {
      mode: settings.preferredMode,
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
      mode: settings.preferredMode,
      url: "",
      host: "",
      port: "",
      user: "",
      password: "",
      database: ":memory:",
    };
  }
  return {
    mode: settings.preferredMode,
    port: defaultPort(engine),
  };
}

export function newDraft(seed: number): ConnectionDraft {
  return {
    id: `connection-${seed}`,
    name: `Connection ${seed}`,
    color: defaultConnectionColor,
    engine: "postgres",
    mode: "fields",
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

export function portableProfile(profile: ConnectionDraft): ConnectionDraft {
  return {
    ...sanitizedProfile(profile),
    url: redactPasswordFromConnectionUrl(profile.url),
  };
}

export function redactPasswordFromConnectionUrl(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return "";
  }

  const jdbcPrefix = raw.toLowerCase().startsWith("jdbc:") ? "jdbc:" : "";
  const candidate = jdbcPrefix ? raw.slice(5) : raw;
  const parsed = redactUrlUserInfo(candidate);
  const withoutUserInfoSecret = parsed ? `${jdbcPrefix}${parsed}` : raw;

  return withoutUserInfoSecret
    .replace(/([?&;](?:password|pwd|pass|passphrase)=)[^;&\s]*/gi, "$1")
    .replace(
      /(^|[;\s])((?:password|pwd|pass|passphrase)=)[^;\s]*/gi,
      (_match, prefix: string, key: string) => `${prefix}${key}`,
    );
}

function redactUrlUserInfo(value: string) {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = "";
    }
    return url.toString();
  } catch {
    return null;
  }
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
    value.mode === "fields" || value.mode === "url" ? value.mode : defaults.mode;
  return portableProfile(
    repairBuiltinSampleProfile({
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
  const settings = engineConnectionSettings(resolvedDraft.engine);
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
    resolvedDraft.engine === "duckdb" &&
    !resolvedDraft.database.trim()
  ) {
    return "DuckDB needs a file path or :memory:";
  }
  if (
    resolvedDraft.mode === "fields" &&
    resolvedDraft.engine !== "sqlite" &&
    resolvedDraft.engine !== "duckdb"
  ) {
    if (resolvedDraft.engine === "pinecone") {
      return "Pinecone is selectable as a placeholder; a driver is not implemented yet";
    }
    if (settings.showHost && !resolvedDraft.host.trim()) {
      return `${settings.hostLabel.toLowerCase()} is required`;
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
