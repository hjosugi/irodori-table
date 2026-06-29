import { createActor } from "xstate";
import { describe, expect, it } from "vitest";
import {
  isQueryBusy,
  queryLifecycleMachine,
} from "@/lib/query/query-lifecycle-machine";

function startedActor() {
  const actor = createActor(queryLifecycleMachine);
  actor.start();
  return actor;
}

describe("queryLifecycleMachine", () => {
  it("runs idle -> running -> streaming -> done and tracks rows + elapsed", () => {
    const actor = startedActor();
    expect(actor.getSnapshot().value).toBe("idle");

    actor.send({ type: "SUBMIT", sql: "select 1" });
    expect(actor.getSnapshot().value).toBe("running");
    expect(actor.getSnapshot().context.sql).toBe("select 1");

    actor.send({ type: "COLUMNS" });
    expect(actor.getSnapshot().value).toBe("streaming");

    actor.send({ type: "ROWS", count: 10 });
    actor.send({ type: "ROWS", count: 25 });
    expect(actor.getSnapshot().context.rowCount).toBe(25);

    actor.send({ type: "DONE", rowCount: 25, elapsedMs: 42 });
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("done");
    expect(snapshot.context.rowCount).toBe(25);
    expect(snapshot.context.elapsedMs).toBe(42);
    expect(snapshot.context.error).toBeNull();
  });

  it("finishes a zero-row / DDL statement without a column header", () => {
    const actor = startedActor();
    actor.send({ type: "SUBMIT", sql: "create table t (id int)" });
    actor.send({ type: "DONE", rowCount: 0 });
    expect(actor.getSnapshot().value).toBe("done");
    expect(actor.getSnapshot().context.rowCount).toBe(0);
  });

  it("cancels from streaming", () => {
    const actor = startedActor();
    actor.send({ type: "SUBMIT", sql: "select * from big" });
    actor.send({ type: "COLUMNS" });
    actor.send({ type: "ROWS", count: 1000 });
    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().value).toBe("cancelled");
  });

  it("captures the error message on failure", () => {
    const actor = startedActor();
    actor.send({ type: "SUBMIT", sql: "select boom" });
    actor.send({ type: "ERROR", message: "column \"boom\" does not exist" });
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("error");
    expect(snapshot.context.error).toBe('column "boom" does not exist');
  });

  it("re-submitting from a terminal state restarts and clears prior error", () => {
    const actor = startedActor();
    actor.send({ type: "SUBMIT", sql: "bad" });
    actor.send({ type: "ERROR", message: "syntax error" });
    expect(actor.getSnapshot().value).toBe("error");

    actor.send({ type: "SUBMIT", sql: "select 1" });
    const snapshot = actor.getSnapshot();
    expect(snapshot.value).toBe("running");
    expect(snapshot.context.error).toBeNull();
    expect(snapshot.context.rowCount).toBe(0);
    expect(snapshot.context.sql).toBe("select 1");
  });

  it("isQueryBusy is true only while running or streaming", () => {
    expect(isQueryBusy("idle")).toBe(false);
    expect(isQueryBusy("running")).toBe(true);
    expect(isQueryBusy("streaming")).toBe(true);
    expect(isQueryBusy("done")).toBe(false);
    expect(isQueryBusy("error")).toBe(false);
    expect(isQueryBusy("cancelled")).toBe(false);
  });
});
