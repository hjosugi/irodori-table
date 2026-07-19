// Log-file highlighting for `.log` buffers (EDITOR-178, ULogViewer-inspired).
//
// Log lines are independent, so this tokenizes only the visible lines: each
// line is scanned for severity keywords (ERROR/WARN/INFO/DEBUG/TRACE families,
// case-insensitive, bracketed or bare), ISO-ish timestamps, and `[...]`
// sections. Severity and timestamp matches win over the bracket span they sit
// in; the rest of a bracketed section is coloured as a section marker. All
// colours come from the active theme's accent ramp so severities read
// correctly on both light and dark themes.

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import type { IrodoriUiColors } from "@/theme";

export type LogTokenKind =
  | "timestamp"
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "trace"
  | "bracket";

export type LogToken = {
  from: number;
  to: number;
  kind: LogTokenKind;
};

const severityKinds: Record<string, LogTokenKind> = {
  fatal: "error",
  critical: "error",
  error: "error",
  err: "error",
  warning: "warn",
  warn: "warn",
  info: "info",
  notice: "info",
  debug: "debug",
  trace: "trace",
  verbose: "trace",
};

const severityPattern =
  /\b(fatal|critical|error|err|warning|warn|info|notice|debug|trace|verbose)\b/gi;

// ISO-ish date, date-time (T or space, optional fraction and zone), or a bare
// hh:mm:ss time.
const timestampPattern =
  /\b(?:\d{4}[-/]\d{2}[-/]\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\b/g;

const bracketPattern = /\[[^\]\n]*\]/g;

function matchAll(
  line: string,
  pattern: RegExp,
): Array<{ from: number; to: number; text: string }> {
  pattern.lastIndex = 0;
  const matches: Array<{ from: number; to: number; text: string }> = [];
  for (const match of line.matchAll(pattern)) {
    matches.push({
      from: match.index,
      to: match.index + match[0].length,
      text: match[0],
    });
  }
  return matches;
}

function overlaps(
  a: { from: number; to: number },
  b: { from: number; to: number },
): boolean {
  return a.from < b.to && b.from < a.to;
}

/** Tokenize one log line into non-overlapping highlight tokens. */
export function tokenizeLogLine(line: string): LogToken[] {
  const tokens: LogToken[] = matchAll(line, severityPattern).map((match) => ({
    from: match.from,
    to: match.to,
    kind: severityKinds[match.text.toLowerCase()] ?? "info",
  }));
  for (const match of matchAll(line, timestampPattern)) {
    if (!tokens.some((token) => overlaps(token, match))) {
      tokens.push({ from: match.from, to: match.to, kind: "timestamp" });
    }
  }
  // Bracketed sections fill the gaps the higher-priority tokens left open.
  for (const match of matchAll(line, bracketPattern)) {
    const inside = tokens
      .filter((token) => overlaps(token, match))
      .sort((a, b) => a.from - b.from);
    let cursor = match.from;
    for (const token of inside) {
      if (token.from > cursor) {
        tokens.push({ from: cursor, to: token.from, kind: "bracket" });
      }
      cursor = Math.max(cursor, token.to);
    }
    if (cursor < match.to) {
      tokens.push({ from: cursor, to: match.to, kind: "bracket" });
    }
  }
  return tokens.sort((a, b) => a.from - b.from);
}

const logMarks: Record<LogTokenKind, Decoration> = {
  timestamp: Decoration.mark({ class: "cm-log-timestamp" }),
  error: Decoration.mark({ class: "cm-log-error" }),
  warn: Decoration.mark({ class: "cm-log-warn" }),
  info: Decoration.mark({ class: "cm-log-info" }),
  debug: Decoration.mark({ class: "cm-log-debug" }),
  trace: Decoration.mark({ class: "cm-log-trace" }),
  bracket: Decoration.mark({ class: "cm-log-bracket" }),
};

function buildLogDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    let pos = range.from;
    while (pos <= range.to) {
      const line = view.state.doc.lineAt(pos);
      for (const token of tokenizeLogLine(line.text)) {
        builder.add(
          line.from + token.from,
          line.from + token.to,
          logMarks[token.kind],
        );
      }
      if (line.to >= range.to) {
        break;
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const logHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLogDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildLogDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function logHighlightTheme(ui: IrodoriUiColors): Extension {
  return EditorView.theme({
    ".cm-log-timestamp": { color: ui.teal },
    ".cm-log-error": { color: ui.red, fontWeight: "700" },
    ".cm-log-warn": { color: ui.amber, fontWeight: "700" },
    ".cm-log-info": { color: ui.green },
    ".cm-log-debug": { color: ui.blue },
    ".cm-log-trace": { color: ui.muted },
    ".cm-log-bracket": { color: ui.purple },
  });
}

/** Severity/timestamp/section highlighting for log buffers. */
export function logHighlighting(ui: IrodoriUiColors): Extension {
  return [logHighlightPlugin, logHighlightTheme(ui)];
}
