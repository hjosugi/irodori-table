// Query execution lifecycle as an explicit XState machine.
//
// Replaces the ad-hoc booleans + manual `cancelled` ref + derived-state effects
// that the architecture review flagged in AppWorkbench. The host drives the
// machine from the Tauri stream events (columns/rows/done/error) and a cancel
// action; the UI derives "running/streaming/done/error/cancelled" from the
// machine state instead of recomputing it imperatively. Pure and effect-free:
// timing is supplied via events, not read from a clock here.

import { assign, setup } from "xstate";

export type QueryLifecycleContext = {
  /** SQL of the in-flight or last run. */
  sql: string;
  /** Rows seen so far (streaming) or final count (done). */
  rowCount: number;
  /** Elapsed time reported by the host on completion, if any. */
  elapsedMs: number | null;
  /** Error message when the run failed. */
  error: string | null;
};

export type QueryLifecycleEvent =
  | { type: "SUBMIT"; sql: string }
  | { type: "COLUMNS" }
  | { type: "ROWS"; count: number }
  | { type: "DONE"; rowCount: number; elapsedMs?: number }
  | { type: "ERROR"; message: string }
  | { type: "CANCEL" }
  | { type: "RESET" };

export const queryLifecycleMachine = setup({
  types: {
    context: {} as QueryLifecycleContext,
    events: {} as QueryLifecycleEvent,
  },
  actions: {
    startRun: assign(({ event }) => ({
      sql: event.type === "SUBMIT" ? event.sql : "",
      rowCount: 0,
      elapsedMs: null,
      error: null,
    })),
    trackRows: assign(({ event }) => ({
      rowCount: event.type === "ROWS" ? event.count : 0,
    })),
    finish: assign(({ event }) => ({
      rowCount: event.type === "DONE" ? event.rowCount : 0,
      elapsedMs: event.type === "DONE" ? (event.elapsedMs ?? null) : null,
    })),
    fail: assign(({ event }) => ({
      error: event.type === "ERROR" ? event.message : "query failed",
    })),
  },
}).createMachine({
  id: "queryLifecycle",
  initial: "idle",
  context: { sql: "", rowCount: 0, elapsedMs: null, error: null },
  states: {
    idle: {
      on: { SUBMIT: { target: "running", actions: "startRun" } },
    },
    running: {
      on: {
        COLUMNS: { target: "streaming" },
        // DDL / zero-row statements can finish without a column header.
        DONE: { target: "done", actions: "finish" },
        ERROR: { target: "error", actions: "fail" },
        CANCEL: { target: "cancelled" },
      },
    },
    streaming: {
      on: {
        ROWS: { actions: "trackRows" },
        DONE: { target: "done", actions: "finish" },
        ERROR: { target: "error", actions: "fail" },
        CANCEL: { target: "cancelled" },
      },
    },
    done: {
      on: {
        SUBMIT: { target: "running", actions: "startRun" },
        RESET: { target: "idle" },
      },
    },
    error: {
      on: {
        SUBMIT: { target: "running", actions: "startRun" },
        RESET: { target: "idle" },
      },
    },
    cancelled: {
      on: {
        SUBMIT: { target: "running", actions: "startRun" },
        RESET: { target: "idle" },
      },
    },
  },
});

export type QueryLifecycleState =
  | "idle"
  | "running"
  | "streaming"
  | "done"
  | "error"
  | "cancelled";

/** Whether a run is in flight (covers both pre- and during-streaming). */
export function isQueryBusy(state: string): boolean {
  return state === "running" || state === "streaming";
}
