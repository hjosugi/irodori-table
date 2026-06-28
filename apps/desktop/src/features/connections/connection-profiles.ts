import type {
  ConnectionInfo,
  ConnectionProfile,
  DbEngine,
  WorkspaceSnapshot,
} from "../../generated/irodori-api";
import connectionDefaults from "./connection-defaults.json";
import {
  defaultPort,
  engineConnectionSettings,
} from "./engine-connection-settings";
export {
  defaultPort,
  engineConnectionSettings,
  type EngineConnectionSettings,
} from "./engine-connection-settings";

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
  readOnly: boolean;
};

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
    readOnly: false,
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
      };
    }
  }
  if (profile.id === "local-mysql") {
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
      host: jsonString(value.host, defaults.host),
      port: jsonString(value.port, defaults.port || defaultPort(engine)),
      user: jsonString(value.user, defaults.user),
      password: "",
      database: jsonString(value.database, defaults.database),
      readOnly: value.readOnly === true,
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
  const readOnly = resolvedDraft.readOnly ? { readOnly: true } : {};
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
    ...readOnly,
  };
}
