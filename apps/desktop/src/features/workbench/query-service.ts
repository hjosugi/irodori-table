import {
  dbApplyEdits,
  dbCancel,
  dbConnect,
  dbDisconnect,
  dbExplainQuery,
  dbListObjects,
  dbQueryParameters,
  dbReleaseResult,
  dbResultWindow,
  dbRunQuery,
  type AppliedEdits,
  type ConnectionInfo,
  type ConnectionProfile,
  type DatabaseMetadata,
  type QueryParameterInput,
  type QueryParameterPromptSet,
  type QueryPlanAnalysis,
  type QueryPlanMode,
  type QueryResult,
  type ResultWindow,
  type SpillRunResult,
  type TableEdits,
} from "@/generated/irodori-api";
import {
  runQuerySpill,
  runQueryStream,
  type QueryStreamEvent,
  type SpillStreamEvent,
} from "@/lib/tauri/db-stream";

export type QueryExecuteArgs = {
  connectionId: string;
  sql: string;
  maxRows?: number;
  timeoutMs?: number;
  queryId?: string;
  params?: QueryParameterInput[];
};

export type QueryStreamArgs = QueryExecuteArgs;

export type QuerySpillArgs = {
  connectionId: string;
  sql: string;
  memoryBudget?: number;
  offloadEnabled?: boolean;
  timeoutMs?: number;
  queryId?: string;
  params?: QueryParameterInput[];
};

export interface QueryService {
  execute(args: QueryExecuteArgs): Promise<QueryResult>;
  stream(
    args: QueryStreamArgs,
    onEvent: (event: QueryStreamEvent) => void,
  ): Promise<void>;
  spill(
    args: QuerySpillArgs,
    onEvent: (event: SpillStreamEvent) => void,
  ): Promise<SpillRunResult>;
  cancel(queryId: string): Promise<boolean>;
  resultWindow(
    handle: string,
    offset: number,
    limit: number,
  ): Promise<ResultWindow>;
  releaseResult(handle: string): Promise<boolean>;
  queryParameters(sql: string): Promise<QueryParameterPromptSet>;
  explain(
    connectionId: string,
    sql: string,
    mode: QueryPlanMode,
  ): Promise<QueryPlanAnalysis>;
  applyEdits(connectionId: string, edits: TableEdits): Promise<AppliedEdits>;
  connect(profile: ConnectionProfile): Promise<ConnectionInfo>;
  disconnect(connectionId: string): Promise<void>;
  listObjects(connectionId: string): Promise<DatabaseMetadata>;
}

export const tauriQueryService: QueryService = {
  execute: (args) =>
    dbRunQuery(
      args.connectionId,
      args.sql,
      args.maxRows,
      args.timeoutMs,
      args.queryId,
      args.params,
    ),
  stream: runQueryStream,
  spill: runQuerySpill,
  cancel: dbCancel,
  resultWindow: dbResultWindow,
  releaseResult: dbReleaseResult,
  queryParameters: dbQueryParameters,
  explain: dbExplainQuery,
  applyEdits: dbApplyEdits,
  connect: dbConnect,
  disconnect: dbDisconnect,
  listObjects: dbListObjects,
};

export const queryService = tauriQueryService;
