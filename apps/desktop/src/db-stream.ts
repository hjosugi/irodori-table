// Hand-written wrapper for the streaming query command.
//
// `db_run_query_stream` takes a Tauri `Channel`, which is outside the generated
// command surface (`generated/irodori-api.ts`), so this small glue is written by
// hand. Keep `QueryStreamEvent` in sync with the Rust `QueryStreamEvent` enum in
// `src-tauri/src/db.rs` (a `type`-tagged union: columns → rows → done | error).

import { Channel, invoke } from "@tauri-apps/api/core";

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
    onEvent: channel,
  });
}
