// Hand-written wrappers for streaming Tauri query commands.
//
// Channel-based commands sit outside the generated command surface in
// `generated/irodori-api.ts`, so this file is the narrow raw-IPC boundary.
// Keep `QueryStreamEvent` in sync with the Rust `QueryStreamEvent` enum in
// `src-tauri/src/db.rs` (a `type`-tagged union: columns -> rows -> done | error).

import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  QueryParameterInput,
  SpillRunResult,
} from "../../generated/irodori-api";

export type QueryStreamEvent =
  | { type: "columns"; resultSetIndex: number; columns: string[] }
  | { type: "rows"; resultSetIndex: number; rows: unknown[][] }
  | {
      type: "done";
      rowCount: number;
      truncated: boolean;
      elapsedMs: number;
      resultSets: Array<{
        resultSetIndex: number;
        rowCount: number;
        elapsedMs: number;
        truncated: boolean;
      }>;
    }
  | { type: "error"; message: string };

export interface RunQueryStreamArgs {
  connectionId: string;
  sql: string;
  maxRows?: number;
  timeoutMs?: number;
  /** Pass an id to make the run cancellable via `dbCancel(queryId)`. */
  queryId?: string;
  params?: QueryParameterInput[];
}

/// Start a streaming query; `onEvent` is called for each batch as it arrives. The
/// returned promise resolves once the backend has emitted the final done/error
/// event and the command returns.
export function runQueryStream(
  args: RunQueryStreamArgs,
  onEvent: (event: QueryStreamEvent) => void,
): Promise<void> {
  const channel = new Channel<QueryStreamEvent>();
  channel.onmessage = onEvent;
  return invoke("db_run_query_stream", {
    connectionId: args.connectionId,
    sql: args.sql,
    maxRows: args.maxRows,
    timeoutMs: args.timeoutMs,
    queryId: args.queryId,
    params: args.params,
    onEvent: channel,
  });
}

/** The only events a spill run streams: its resident first page (EXEC-010). */
export type SpillStreamEvent = Extract<
  QueryStreamEvent,
  { type: "columns" } | { type: "rows" }
>;

export interface RunQuerySpillArgs {
  connectionId: string;
  sql: string;
  /** Rows kept resident in RAM and streamed to the grid (the first page). */
  memoryBudget?: number;
  /** When false, the result caps at `memoryBudget` instead of spilling to disk. */
  offloadEnabled?: boolean;
  timeoutMs?: number;
  /** Pass an id to make the run cancellable via `dbCancel(queryId)`. */
  queryId?: string;
  params?: QueryParameterInput[];
}

/**
 * Run a query with bounded-memory disk offload (EXEC-010). The resident first page
 * streams through `onEvent` (columns -> rows) for an immediate paint exactly like
 * {@link runQueryStream}; the returned promise resolves with the
 * {@link SpillRunResult} once the full result has spilled, carrying the `handle`
 * the grid uses to page the rest from disk via `dbResultWindow`. Rejects on a query
 * error (no error event is streamed).
 */
export function runQuerySpill(
  args: RunQuerySpillArgs,
  onEvent: (event: SpillStreamEvent) => void,
): Promise<SpillRunResult> {
  const channel = new Channel<SpillStreamEvent>();
  channel.onmessage = onEvent;
  return invoke<SpillRunResult>("db_run_query_spill", {
    connectionId: args.connectionId,
    sql: args.sql,
    memoryBudget: args.memoryBudget,
    offloadEnabled: args.offloadEnabled,
    timeoutMs: args.timeoutMs,
    queryId: args.queryId,
    params: args.params,
    onEvent: channel,
  });
}
