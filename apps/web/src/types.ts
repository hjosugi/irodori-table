export type LocalEngine = "sqlite" | "duckdb";

export type OnlineEngine =
  | "postgres"
  | "mysql"
  | "mariadb"
  | "sqlite"
  | "duckdb"
  | "sqlserver"
  | "custom";

export type ConnectionMode = "local" | "online";

export type ConnectionProfile = {
  id: string;
  name: string;
  mode: ConnectionMode;
  engine: LocalEngine | OnlineEngine;
  databaseId?: string;
  endpoint?: string;
  token?: string;
};

export type JsonCell = string | number | boolean | null;

export type QueryResultSet = {
  columns: string[];
  rows: JsonCell[][];
  rowCount: number;
  truncated: boolean;
};

export type QueryResult = QueryResultSet & {
  elapsedMs: number;
  message?: string;
  resultSets?: QueryResultSet[];
};

export type RuntimeStatus = {
  maxWorkers: number;
  workers: Array<{
    connectionId: string;
    engine: LocalEngine;
    busy: boolean;
    lastUsedAt: number;
  }>;
};

export type QueryHistoryItem = {
  id: string;
  connectionName: string;
  engine: string;
  mode: ConnectionMode;
  sql: string;
  elapsedMs: number;
  rowCount: number;
  status: "ok" | "error";
  ranAt: string;
  error?: string;
};
