// Log-file level/regex filtering for `.log` buffers (issue #177, tier 2).
//
// The filter is strictly view-level: hidden entries are covered by zero-height
// block `Decoration.replace` ranges, the document is never mutated, and any
// selection (including select-all) still copies the hidden text. Severity
// detection rides on the highlight classifier in `editor-log-highlight` so the
// two features can never disagree about what a line means.
//
// Entries, not lines, are the unit of filtering: a line with a severity or
// timestamp token starts a new entry, and token-less lines (stack traces,
// wrapped messages) belong to the entry above them. Entries whose severity the
// classifier cannot determine always pass the level filter — hiding text the
// parser does not understand would be worse than showing too much.

import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { tokenizeLogLine } from "./editor-log-highlight";

const severityRank = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
} as const;

export type LogEntrySeverity = keyof typeof severityRank;

/** Minimum-severity choices; `trace` is omitted because it hides nothing. */
export const logMinLevels = ["debug", "info", "warn", "error"] as const;

export type LogMinLevel = "all" | (typeof logMinLevels)[number];

export type LogFilterSpec = {
  minLevel: LogMinLevel;
  /** Regex (case-insensitive); falls back to a literal match when invalid. */
  text: string;
};

export const emptyLogFilter: LogFilterSpec = { minLevel: "all", text: "" };

export function isLogFilterActive(spec: LogFilterSpec): boolean {
  return spec.minLevel !== "all" || spec.text !== "";
}

export function logFilterSpecsEqual(
  a: LogFilterSpec,
  b: LogFilterSpec,
): boolean {
  return a.minLevel === b.minLevel && a.text === b.text;
}

export type LogEntry = {
  /** First line of the entry (0-based, inclusive). */
  fromLine: number;
  /** Last line of the entry (0-based, inclusive). */
  toLine: number;
  /** Severity of the head line, or null when the classifier found none. */
  severity: LogEntrySeverity | null;
};

function classifyLogLine(line: string): {
  isHead: boolean;
  severity: LogEntrySeverity | null;
} {
  let isHead = false;
  let severity: LogEntrySeverity | null = null;
  // tokenizeLogLine returns tokens sorted by position, so the first
  // severity-kind token seen here is the leftmost one on the line.
  for (const token of tokenizeLogLine(line)) {
    if (token.kind === "timestamp") {
      isHead = true;
    } else if (token.kind in severityRank) {
      isHead = true;
      severity ??= token.kind as LogEntrySeverity;
    }
  }
  return { isHead, severity };
}

/** Group lines into log entries; continuation lines join the entry above. */
export function splitLogEntries(lines: readonly string[]): LogEntry[] {
  const entries: LogEntry[] = [];
  for (let index = 0; index < lines.length; index++) {
    const { isHead, severity } = classifyLogLine(lines[index]);
    const current = entries[entries.length - 1];
    if (isHead || !current) {
      entries.push({ fromLine: index, toLine: index, severity });
    } else {
      current.toLine = index;
    }
  }
  return entries;
}

/** Split editor text the same way CodeMirror splits document lines. */
export function splitLogFilterLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

function compileLogTextMatcher(
  text: string,
): ((input: string) => boolean) | null {
  if (!text) {
    return null;
  }
  try {
    const regex = new RegExp(text, "i");
    return (input) => regex.test(input);
  } catch {
    // Half-typed patterns like "boom (" should keep filtering usefully
    // instead of erroring, so invalid regexes match literally.
    const literal = text.toLowerCase();
    return (input) => input.toLowerCase().includes(literal);
  }
}

export type LogFilterResult = {
  /** Merged runs of hidden lines (0-based, inclusive). */
  hiddenRanges: Array<{ fromLine: number; toLine: number }>;
  hiddenLineCount: number;
};

/** Decide which lines the filter hides. Pure; shared by the bar and the view. */
export function computeLogFilterRanges(
  lines: readonly string[],
  spec: LogFilterSpec,
): LogFilterResult {
  if (!isLogFilterActive(spec)) {
    return { hiddenRanges: [], hiddenLineCount: 0 };
  }
  const matcher = compileLogTextMatcher(spec.text);
  const minRank = spec.minLevel === "all" ? null : severityRank[spec.minLevel];
  const hiddenRanges: LogFilterResult["hiddenRanges"] = [];
  let hiddenLineCount = 0;
  for (const entry of splitLogEntries(lines)) {
    const passesLevel =
      minRank === null ||
      entry.severity === null ||
      severityRank[entry.severity] >= minRank;
    const passesText =
      !matcher ||
      matcher(lines.slice(entry.fromLine, entry.toLine + 1).join("\n"));
    if (passesLevel && passesText) {
      continue;
    }
    const last = hiddenRanges[hiddenRanges.length - 1];
    if (last && last.toLine === entry.fromLine - 1) {
      last.toLine = entry.toLine;
    } else {
      hiddenRanges.push({ fromLine: entry.fromLine, toLine: entry.toLine });
    }
    hiddenLineCount += entry.toLine - entry.fromLine + 1;
  }
  return { hiddenRanges, hiddenLineCount };
}

/** Replace the active log filter; dispatched by the filter bar. */
export const setLogFilterEffect = StateEffect.define<LogFilterSpec>();

const logFilterSpecField = StateField.define<LogFilterSpec>({
  create: () => emptyLogFilter,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (
        effect.is(setLogFilterEffect) &&
        !logFilterSpecsEqual(value, effect.value)
      ) {
        value = effect.value;
      }
    }
    return value;
  },
});

/** The active filter, or the empty filter when the field is not installed. */
export function currentLogFilter(state: EditorState): LogFilterSpec {
  return state.field(logFilterSpecField, false) ?? emptyLogFilter;
}

const hiddenLogBlock = Decoration.replace({ block: true });

/**
 * Hidden-entry decorations for the current doc + filter. Each hidden run also
 * covers its trailing line break (or the leading one at the end of the doc)
 * so filtered-out empty lines cannot leave blank rows behind.
 */
export function buildLogFilterDecorations(state: EditorState): DecorationSet {
  const spec = currentLogFilter(state);
  if (!isLogFilterActive(spec)) {
    return Decoration.none;
  }
  const doc = state.doc;
  const lines: string[] = new Array(doc.lines);
  for (let number = 1; number <= doc.lines; number++) {
    lines[number - 1] = doc.line(number).text;
  }
  const { hiddenRanges } = computeLogFilterRanges(lines, spec);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of hiddenRanges) {
    let from = doc.line(range.fromLine + 1).from;
    let to = doc.line(range.toLine + 1).to;
    if (to < doc.length) {
      to += 1;
    } else if (from > 0) {
      from -= 1;
    }
    if (from < to) {
      builder.add(from, to, hiddenLogBlock);
    }
  }
  return builder.finish();
}

/**
 * View-level log filtering. Block decorations must come from state, not a
 * view plugin, because hiding lines changes the vertical layout.
 */
export const logLineFilter: Extension = [
  logFilterSpecField,
  EditorView.decorations.compute(
    ["doc", logFilterSpecField],
    buildLogFilterDecorations,
  ),
];
