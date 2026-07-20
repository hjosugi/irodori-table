import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  buildLogFilterDecorations,
  computeLogFilterRanges,
  currentLogFilter,
  emptyLogFilter,
  isLogFilterActive,
  logFilterSpecsEqual,
  logLineFilter,
  setLogFilterEffect,
  splitLogEntries,
  splitLogFilterLines,
  type LogFilterSpec,
} from "@/features/query-editor/editor-log-filter";

const fixture = [
  "2026-07-18 10:00:00 INFO service started", // 0
  "2026-07-18 10:00:01 DEBUG cache warmed", // 1
  "2026-07-18 10:00:02 ERROR request failed", // 2
  "    at example.handler (handler.js:10)", // 3
  "    at process (node:internal:71)", // 4
  "2026-07-18 10:00:03 WARN slow response", // 5
  "2026-07-18 10:00:04 configuration reloaded", // 6
] as const;

function spec(partial: Partial<LogFilterSpec>): LogFilterSpec {
  return { ...emptyLogFilter, ...partial };
}

describe("splitLogEntries", () => {
  it("attaches stack-trace continuation lines to the preceding entry", () => {
    expect(splitLogEntries([...fixture])).toEqual([
      { fromLine: 0, toLine: 0, severity: "info" },
      { fromLine: 1, toLine: 1, severity: "debug" },
      { fromLine: 2, toLine: 4, severity: "error" },
      { fromLine: 5, toLine: 5, severity: "warn" },
      { fromLine: 6, toLine: 6, severity: null },
    ]);
  });

  it("treats a timestamp-only line as an entry head without severity", () => {
    expect(splitLogEntries(["2026-07-18 10:00:00 listening on :8080"])).toEqual(
      [{ fromLine: 0, toLine: 0, severity: null }],
    );
  });

  it("groups leading headless lines into one unknown-severity entry", () => {
    expect(splitLogEntries(["banner line", "second banner"])).toEqual([
      { fromLine: 0, toLine: 1, severity: null },
    ]);
  });

  it("reads bracketed severities through the highlight classifier", () => {
    expect(splitLogEntries(["[WARN] [worker-1] queue is deep"])).toEqual([
      { fromLine: 0, toLine: 0, severity: "warn" },
    ]);
  });

  it("uses the first severity token when a message mentions another level", () => {
    expect(splitLogEntries(["10:00:00 INFO no error found"])).toEqual([
      { fromLine: 0, toLine: 0, severity: "info" },
    ]);
  });
});

describe("computeLogFilterRanges", () => {
  it("is inert for the empty filter", () => {
    expect(computeLogFilterRanges([...fixture], emptyLogFilter)).toEqual({
      hiddenRanges: [],
      hiddenLineCount: 0,
    });
    expect(isLogFilterActive(emptyLogFilter)).toBe(false);
  });

  it("hides entries below the minimum level, including their continuations", () => {
    const result = computeLogFilterRanges(
      [...fixture],
      spec({ minLevel: "warn" }),
    );
    expect(result.hiddenRanges).toEqual([{ fromLine: 0, toLine: 1 }]);
    expect(result.hiddenLineCount).toBe(2);
  });

  it("keeps unknown-severity entries visible under a level filter", () => {
    const result = computeLogFilterRanges(
      [...fixture],
      spec({ minLevel: "error" }),
    );
    // INFO, DEBUG, and WARN entries hide; the ERROR entry (with its stack
    // trace) and the severity-less line 6 stay.
    expect(result.hiddenRanges).toEqual([
      { fromLine: 0, toLine: 1 },
      { fromLine: 5, toLine: 5 },
    ]);
    expect(result.hiddenLineCount).toBe(3);
  });

  it("filters entries by regex, matching continuation lines too", () => {
    const result = computeLogFilterRanges(
      [...fixture],
      spec({ text: "handler\\.js|cache" }),
    );
    // The stack-trace match keeps the whole ERROR entry visible.
    expect(result.hiddenRanges).toEqual([
      { fromLine: 0, toLine: 0 },
      { fromLine: 5, toLine: 6 },
    ]);
    expect(result.hiddenLineCount).toBe(3);
  });

  it("matches case-insensitively", () => {
    const result = computeLogFilterRanges(
      [...fixture],
      spec({ text: "SLOW RESPONSE" }),
    );
    expect(result.hiddenRanges).toEqual([
      { fromLine: 0, toLine: 4 },
      { fromLine: 6, toLine: 6 },
    ]);
  });

  it("falls back to literal matching for invalid regexes", () => {
    const result = computeLogFilterRanges(
      ["ERROR boom (", "ERROR quiet"],
      spec({ text: "boom (" }),
    );
    expect(result.hiddenRanges).toEqual([{ fromLine: 1, toLine: 1 }]);
  });

  it("composes the level and text filters", () => {
    const result = computeLogFilterRanges(
      [...fixture],
      spec({ minLevel: "info", text: "service|cache" }),
    );
    // DEBUG "cache warmed" matches the text but sits below INFO.
    expect(result.hiddenRanges).toEqual([{ fromLine: 1, toLine: 6 }]);
    expect(result.hiddenLineCount).toBe(6);
  });
});

describe("splitLogFilterLines", () => {
  it("splits on unix and windows line endings", () => {
    expect(splitLogFilterLines("a\nb\r\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("logFilterSpecsEqual", () => {
  it("compares by value", () => {
    expect(logFilterSpecsEqual(emptyLogFilter, spec({}))).toBe(true);
    expect(logFilterSpecsEqual(emptyLogFilter, spec({ text: "x" }))).toBe(
      false,
    );
    expect(
      logFilterSpecsEqual(emptyLogFilter, spec({ minLevel: "warn" })),
    ).toBe(false);
  });
});

describe("logLineFilter editor extension", () => {
  const doc = fixture.join("\n");

  function stateWithFilter(filter: LogFilterSpec): EditorState {
    const base = EditorState.create({ doc, extensions: [logLineFilter] });
    return base.update({ effects: setLogFilterEffect.of(filter) }).state;
  }

  it("stores the filter spec behind the effect", () => {
    const state = stateWithFilter(spec({ minLevel: "warn", text: "slow" }));
    expect(currentLogFilter(state)).toEqual({
      minLevel: "warn",
      text: "slow",
    });
  });

  it("never mutates the document", () => {
    const state = stateWithFilter(spec({ minLevel: "error" }));
    expect(state.doc.toString()).toBe(doc);
  });

  it("hides filtered lines with block decorations covering their breaks", () => {
    const state = stateWithFilter(spec({ minLevel: "error" }));
    const decorations = buildLogFilterDecorations(state);
    const ranges: Array<[number, number]> = [];
    const cursor = decorations.iter();
    while (cursor.value) {
      ranges.push([cursor.from, cursor.to]);
      cursor.next();
    }
    // Each hidden run swallows its trailing line break so no blank row is
    // left behind (doc lines are 1-based; hidden 0-based lines 0-1 and 5).
    expect(ranges).toEqual([
      [state.doc.line(1).from, state.doc.line(3).from],
      [state.doc.line(6).from, state.doc.line(7).from],
    ]);
  });

  it("hides a trailing last line by covering its leading break", () => {
    const base = EditorState.create({
      doc: "ERROR a\nDEBUG b",
      extensions: [logLineFilter],
    });
    const state = base.update({
      effects: setLogFilterEffect.of(spec({ minLevel: "error" })),
    }).state;
    const decorations = buildLogFilterDecorations(state);
    const ranges: Array<[number, number]> = [];
    const cursor = decorations.iter();
    while (cursor.value) {
      ranges.push([cursor.from, cursor.to]);
      cursor.next();
    }
    expect(ranges).toEqual([
      [state.doc.line(2).from - 1, state.doc.line(2).to],
    ]);
  });

  it("produces no decorations when the filter is inactive", () => {
    const state = stateWithFilter(emptyLogFilter);
    expect(buildLogFilterDecorations(state).size).toBe(0);
  });
});
