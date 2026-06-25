import type { ConnectionProfile, QueryHistoryItem } from "./types";

const profilesKey = "irodori.web.profiles.v1";
const activeProfileKey = "irodori.web.activeProfile.v1";
const queryKey = "irodori.web.query.v1";
const historyKey = "irodori.web.history.v1";

export const defaultProfiles: ConnectionProfile[] = [
  {
    id: "mobile-sqlite",
    name: "Mobile SQLite",
    mode: "local",
    engine: "sqlite",
    databaseId: "mobile-sqlite",
  },
  {
    id: "duckdb-scratch",
    name: "DuckDB Scratch",
    mode: "local",
    engine: "duckdb",
    databaseId: "duckdb-scratch",
  },
  {
    id: "online-api",
    name: "Online API",
    mode: "online",
    engine: "postgres",
    endpoint: "/api/query",
  },
];

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function loadProfiles(): ConnectionProfile[] {
  const stored = parseJson<ConnectionProfile[]>(localStorage.getItem(profilesKey));
  if (!stored?.length) {
    return defaultProfiles;
  }
  const existing = new Set(stored.map((profile) => profile.id));
  return [
    ...stored,
    ...defaultProfiles.filter((profile) => !existing.has(profile.id)),
  ];
}

export function saveProfiles(profiles: ConnectionProfile[]) {
  localStorage.setItem(profilesKey, JSON.stringify(profiles));
}

export function loadActiveProfileId() {
  return localStorage.getItem(activeProfileKey) ?? defaultProfiles[0].id;
}

export function saveActiveProfileId(id: string) {
  localStorage.setItem(activeProfileKey, id);
}

export function loadQuery(defaultSql: string) {
  return localStorage.getItem(queryKey) ?? defaultSql;
}

export function saveQuery(sql: string) {
  localStorage.setItem(queryKey, sql);
}

export function loadHistory(): QueryHistoryItem[] {
  return parseJson<QueryHistoryItem[]>(localStorage.getItem(historyKey)) ?? [];
}

export function saveHistory(history: QueryHistoryItem[]) {
  localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 30)));
}
