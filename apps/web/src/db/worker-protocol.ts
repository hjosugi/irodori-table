import type { LocalEngine, QueryResult } from "../types";

export type LocalWorkerInitRequest = {
  id: number;
  type: "init";
  connectionId: string;
  databaseId: string;
  engine: LocalEngine;
  seedSql?: string;
};

export type LocalWorkerQueryRequest = {
  id: number;
  type: "query";
  sql: string;
  maxRows: number;
};

export type LocalWorkerExportRequest = {
  id: number;
  type: "export";
};

export type LocalWorkerImportRequest = {
  id: number;
  type: "import";
  bytes: Uint8Array;
};

export type LocalWorkerResetRequest = {
  id: number;
  type: "reset";
  seedSql?: string;
};

export type LocalWorkerDeleteRequest = {
  id: number;
  type: "delete";
};

export type LocalWorkerRequest =
  | LocalWorkerInitRequest
  | LocalWorkerQueryRequest
  | LocalWorkerExportRequest
  | LocalWorkerImportRequest
  | LocalWorkerResetRequest
  | LocalWorkerDeleteRequest;

export type LocalWorkerResponse =
  | {
      id: number;
      ok: true;
      data?: QueryResult | { bytes: Uint8Array } | { message: string };
    }
  | {
      id: number;
      ok: false;
      error: string;
    };
