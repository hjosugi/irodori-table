import type {
  ConnectionInfo,
  ConnectionProfile,
  DbEngine,
} from "../../generated/irodori-api";
import connectionDefaults from "./connection-defaults.json";
import {
  defaultPort,
  engineConnectionSettings,
} from "./engine-connection-settings";
import type {
  ConnectionDraft,
  ConnectionInputMode,
  WorkspaceConnection,
} from "@/lib/workspace-connection";
export {
  defaultPort,
  engineConnectionSettings,
  type EngineConnectionSettings,
} from "./engine-connection-settings";
export type {
  ConnectionDraft,
  ConnectionInputMode,
  ConnectionTransportMode,
  WorkspaceConnection,
} from "@/lib/workspace-connection";

type EngineOption = { value: DbEngine; label: string };
type SampleConnectionColors = Record<
  "postgres" | "mysql" | "sqlite" | "duckdb",
  string
>;
type ConnectionDefaultsConfig = {
  colors: {
    legacyDefault: string;
    default: string;
    samples: SampleConnectionColors;
    palette: string[];
    customPalette: string[];
  };
  engineOptions: EngineOption[];
  localPostgresSampleUrl: string;
  starterProfiles: ConnectionDraft[];
};

const connectionDefaultsConfig =
  connectionDefaults as unknown as ConnectionDefaultsConfig;

export const profilesStorageKey = "irodori.connectionProfiles.v1";
const legacyDefaultConnectionColor =
  connectionDefaultsConfig.colors.legacyDefault;
const sampleConnectionColors = connectionDefaultsConfig.colors.samples;
export const defaultConnectionColor = connectionDefaultsConfig.colors.default;
export const connectionColorOptions = [
  ...connectionDefaultsConfig.colors.palette,
];
export const connectionCustomColorOptions = [
  ...connectionDefaultsConfig.colors.customPalette,
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

function normalizeBuiltinConnectionColor(
  value: unknown,
  fallback: string,
  legacyColors: readonly string[],
) {
  const normalized = normalizeConnectionColor(value, fallback);
  return legacyColors.includes(normalized) ? fallback : normalized;
}

export const engineOptions: EngineOption[] =
  connectionDefaultsConfig.engineOptions;

const localPostgresSampleUrl = connectionDefaultsConfig.localPostgresSampleUrl;

export const starterProfiles: ConnectionDraft[] =
  connectionDefaultsConfig.starterProfiles.map((profile) => ({ ...profile }));
const starterProfileById = new Map(
  starterProfiles.map((profile) => [profile.id, profile]),
);

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

export function memoryDefaults(engine: DbEngine): Partial<ConnectionDraft> {
  const settings = engineConnectionSettings(engine);
  if (engine === "sqlite") {
    return {
      mode: settings.preferredMode,
      url: "",
      connectionTransport: "tcp",
      host: "",
      port: "",
      user: "",
      password: "",
      database: ":memory:",
      socketPath: "",
    };
  }
  if (engine === "duckdb") {
    return {
      mode: settings.preferredMode,
      url: "",
      connectionTransport: "tcp",
      host: "",
      port: "",
      user: "",
      password: "",
      database: ":memory:",
      socketPath: "",
    };
  }
  return {
    mode: settings.preferredMode,
    connectionTransport: "tcp",
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
    connectionTransport: "tcp",
    host: "127.0.0.1",
    port: "5432",
    user: "",
    password: "",
    database: "",
    socketPath: "",
    readOnly: false,
  };
}

// In-memory SQLite is the one connection that needs no external service, so
// it can be offered from an empty workspace without ever looking broken.
// Deliberately NOT part of starterProfiles: samples are created on demand
// from the empty-state CTA, never pre-seeded (see commit 2d42fb79).
export function sqliteSampleProfile(): ConnectionDraft {
  return {
    id: "sqlite-memory",
    name: "SQLite Sample",
    color: sampleConnectionColors.sqlite,
    engine: "sqlite",
    mode: "fields",
    url: "",
    connectionTransport: "tcp",
    host: "",
    port: "",
    user: "",
    password: "",
    database: ":memory:",
    socketPath: "",
    readOnly: false,
  };
}

// Idempotent demo schema for the SQLite sample (PK conflicts make re-runs
// no-ops). Two related tables so joins, aggregates, and the ER diagram all
// have something to show.
export const sqliteSampleSeedSql: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  ordered_at TEXT NOT NULL
)`,
  `INSERT OR IGNORE INTO products (id, name, category, price) VALUES
  (1, 'Gouda', 'cheese', 12.5),
  (2, 'Comte', 'cheese', 18.0),
  (3, 'Oolong', 'tea', 6.5),
  (4, 'Sencha', 'tea', 7.2),
  (5, 'Baguette', 'bakery', 3.1),
  (6, 'Croissant', 'bakery', 2.4),
  (7, 'Brie', 'cheese', 9.8),
  (8, 'Matcha', 'tea', 11.0)`,
  `INSERT OR IGNORE INTO orders (id, product_id, quantity, ordered_at) VALUES
  (1, 1, 2, '2026-06-01'),
  (2, 3, 1, '2026-06-03'),
  (3, 2, 1, '2026-06-05'),
  (4, 5, 4, '2026-06-08'),
  (5, 1, 1, '2026-06-11'),
  (6, 8, 2, '2026-06-14'),
  (7, 6, 6, '2026-06-17'),
  (8, 4, 3, '2026-06-20'),
  (9, 7, 1, '2026-06-22'),
  (10, 2, 2, '2026-06-25'),
  (11, 5, 2, '2026-06-27'),
  (12, 3, 5, '2026-06-30')`,
];

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
      return [];
    }
    const parsed = JSON.parse(raw) as ConnectionDraft[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [];
    }
    return withStarterProfiles(
      parsed.map((profile) =>
        sanitizedProfile({
          ...newDraft(1),
          ...profile,
          color: normalizeConnectionColor(profile.color),
          password: "",
          port: profile.port ?? defaultPort(profile.engine),
          connectionTransport: profile.connectionTransport ?? "tcp",
          socketPath: profile.socketPath ?? "",
        }),
      ),
    );
  } catch {
    return [];
  }
}

export function sanitizedProfile(profile: ConnectionDraft): ConnectionDraft {
  return {
    ...profile,
    color: normalizeConnectionColor(profile.color),
    url: redactPasswordFromConnectionUrl(profile.url),
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

export function repairBuiltinSampleProfile(
  profile: ConnectionDraft,
): ConnectionDraft {
  if (profile.id === "sqlite-memory" || profile.id === "duckdb-memory") {
    const engine = profile.id === "sqlite-memory" ? "sqlite" : "duckdb";
    const label =
      profile.id === "sqlite-memory" ? "SQLite Sample" : "DuckDB Sample";
    const database = profile.database.trim() || ":memory:";
    if (
      (profile.engine === engine || !profile.engine) &&
      (database === ":memory:" ||
        profile.name === "SQLite Memory" ||
        profile.name === "DuckDB Memory" ||
        profile.name === label)
    ) {
      return {
        ...profile,
        name:
          profile.name === "SQLite Memory" ||
          profile.name === "DuckDB Memory" ||
          !profile.name.trim()
            ? label
            : profile.name,
        color:
          engine === "sqlite"
            ? normalizeBuiltinConnectionColor(
                profile.color,
                sampleConnectionColors.sqlite,
                [legacyDefaultConnectionColor, "#ca8a04"],
              )
            : normalizeBuiltinConnectionColor(
                profile.color,
                sampleConnectionColors.duckdb,
                [legacyDefaultConnectionColor, "#9333ea"],
              ),
        engine,
        mode: "fields",
        url: "",
        host: "",
        port: "",
        user: "",
        password: "",
        database: ":memory:",
        connectionTransport: "tcp",
        socketPath: "",
      };
    }
  }
  if (profile.id === "local-mysql") {
    const sample = starterProfileById.get("local-mysql");
    const url = profile.url.trim();
    const looksLikeBundledSample =
      profile.connectionTransport !== "socket" &&
      (!url ||
        /(?:localhost|127\.0\.0\.1):55306(?:\/samples)?(?:[?#].*)?$/.test(
          url,
        ) ||
        profile.host === "localhost" ||
        profile.host === "127.0.0.1" ||
        profile.database === "samples" ||
        profile.name === "Local MySQL");
    if (sample && looksLikeBundledSample) {
      return {
        ...profile,
        name: profile.name.trim() ? profile.name : sample.name,
        color: normalizeBuiltinConnectionColor(
          profile.color,
          sampleConnectionColors.mysql,
          [legacyDefaultConnectionColor, "#2563eb"],
        ),
        engine: "mysql",
        mode: "url",
        url: sample.url,
        host: sample.host,
        port: sample.port,
        user: sample.user,
        password: "",
        database: sample.database,
        connectionTransport: "tcp",
        socketPath: "",
      };
    }
    return {
      ...profile,
      color: normalizeBuiltinConnectionColor(
        profile.color,
        sampleConnectionColors.mysql,
        [legacyDefaultConnectionColor, "#2563eb"],
      ),
    };
  }
  if (profile.id !== "local-pg") {
    return profile;
  }
  const url = profile.url.trim();
  const looksLikeBundledSample =
    profile.connectionTransport !== "socket" &&
    (!url ||
      /(?:localhost|127\.0\.0\.1):55432(?:\/samples)?(?:[?#].*)?$/.test(url) ||
      profile.host === "localhost" ||
      profile.host === "127.0.0.1" ||
      profile.database === "samples" ||
      profile.name === "Local Warehouse" ||
      profile.name === "Local Postgres");
  if (!looksLikeBundledSample) {
    return profile;
  }
  return {
    ...profile,
    name:
      profile.name === "Local Warehouse" || !profile.name.trim()
        ? "Local Postgres"
        : profile.name,
    color: normalizeBuiltinConnectionColor(
      profile.color,
      sampleConnectionColors.postgres,
      [legacyDefaultConnectionColor, "#16a34a"],
    ),
    engine: "postgres",
    mode: "url",
    url: localPostgresSampleUrl,
    host: "127.0.0.1",
    port: "55432",
    user: "irodori",
    password: "",
    database: "samples",
    connectionTransport: "tcp",
    socketPath: "",
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
    value.mode === "fields" || value.mode === "url"
      ? value.mode
      : defaults.mode;
  return portableProfile(
    repairBuiltinSampleProfile({
      ...defaults,
      id: nonEmptyJsonString(value.id, defaults.id),
      name: nonEmptyJsonString(value.name, defaults.name),
      color: normalizeConnectionColor(value.color),
      engine,
      mode,
      url: jsonString(value.url, defaults.url),
      connectionTransport:
        value.connectionTransport === "socket" ? "socket" : "tcp",
      host: jsonString(value.host, defaults.host),
      port: jsonString(value.port, defaults.port || defaultPort(engine)),
      user: jsonString(value.user, defaults.user),
      password: "",
      database: jsonString(value.database, defaults.database),
      socketPath: jsonString(value.socketPath, defaults.socketPath),
      readOnly: value.readOnly === true,
    }),
  );
}

export function supportsSocketTransport(engine: DbEngine) {
  return (
    engine === "postgres" ||
    engine === "timescaledb" ||
    engine === "neon" ||
    engine === "cockroachdb" ||
    engine === "yugabytedb" ||
    engine === "redshift" ||
    engine === "questdb" ||
    engine === "mysql" ||
    engine === "mariadb" ||
    engine === "tidb"
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
    const useSocket =
      supportsSocketTransport(resolvedDraft.engine) &&
      resolvedDraft.connectionTransport === "socket";
    if (useSocket && !resolvedDraft.socketPath.trim()) {
      return "socket path is required";
    }
    if (settings.showHost && !useSocket && !resolvedDraft.host.trim()) {
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

export function profileFromDraft(
  draft: ConnectionDraft,
): ConnectionProfile<DbEngine> {
  const resolvedDraft = repairBuiltinSampleProfile(draft);
  const readOnly = resolvedDraft.readOnly ? { readOnly: true } : {};
  const socketPath =
    supportsSocketTransport(resolvedDraft.engine) &&
    resolvedDraft.connectionTransport === "socket"
      ? resolvedDraft.socketPath.trim() || undefined
      : undefined;
  if (resolvedDraft.mode === "url") {
    return {
      id: resolvedDraft.id.trim(),
      engine: resolvedDraft.engine,
      url: resolvedDraft.url.trim(),
      ...readOnly,
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
    socketPath,
    transport: socketPath ? { kind: "localFile", path: socketPath } : undefined,
    ...readOnly,
  };
}
