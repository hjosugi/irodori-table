import type { ConnectionProfile, JsonCell, QueryResult } from "../types";
import { normalizeCell } from "./result";

export type OnlineQueryRequest = {
  connectionId: string;
  engine: string;
  sql: string;
  maxRows: number;
};

export function buildOnlineQueryRequest(
  profile: ConnectionProfile,
  sql: string,
  maxRows: number,
): OnlineQueryRequest {
  return {
    connectionId: profile.id,
    engine: profile.engine,
    sql,
    maxRows,
  };
}

function normalizeRows(rows: unknown, columns: string[]): JsonCell[][] {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((row) => {
    if (Array.isArray(row)) {
      return row.map(normalizeCell);
    }
    if (row && typeof row === "object") {
      const record = row as Record<string, unknown>;
      return columns.map((column) => normalizeCell(record[column]));
    }
    return [normalizeCell(row)];
  });
}

export function normalizeOnlineResult(payload: unknown, elapsedMs: number): QueryResult {
  if (!payload || typeof payload !== "object") {
    throw new Error("Online endpoint returned an invalid result");
  }
  const record = payload as Record<string, unknown>;
  const columns = Array.isArray(record.columns)
    ? record.columns.map(String)
    : Array.isArray(record.rows) && record.rows[0] && typeof record.rows[0] === "object"
      ? Object.keys(record.rows[0] as Record<string, unknown>)
      : [];
  const rows = normalizeRows(record.rows, columns);
  const rowCount =
    typeof record.rowCount === "number" ? record.rowCount : Number(record.rowCount ?? rows.length);
  return {
    columns,
    rows,
    rowCount: Number.isFinite(rowCount) ? rowCount : rows.length,
    elapsedMs:
      typeof record.elapsedMs === "number" && Number.isFinite(record.elapsedMs)
        ? record.elapsedMs
        : elapsedMs,
    truncated: Boolean(record.truncated),
    message: typeof record.message === "string" ? record.message : undefined,
  };
}

export async function runOnlineQuery(
  profile: ConnectionProfile,
  sql: string,
  maxRows: number,
): Promise<QueryResult> {
  if (!profile.endpoint) {
    throw new Error("Online endpoint is not configured");
  }
  const start = performance.now();
  const response = await fetch(profile.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(profile.token ? { authorization: `Bearer ${profile.token}` } : {}),
    },
    body: JSON.stringify(buildOnlineQueryRequest(profile, sql, maxRows)),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Online endpoint failed with ${response.status}`;
    throw new Error(message);
  }
  return normalizeOnlineResult(payload, performance.now() - start);
}
