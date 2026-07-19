// Rainbow-column highlighting for CSV/TSV buffers (EDITOR-178).
//
// Same shape as editor-rainbow-brackets: a small lexical pass over the
// document, no grammar. Fields are tokenized RFC 4180-style — a field that
// starts with `"` runs to its closing quote, so embedded delimiters, escaped
// quotes (`""`) and even newlines inside quoted fields do not break the column
// count. Each column gets a stable colour from the active theme's accent ramp
// (column index modulo the ramp), and the first record is styled as the
// header row. The scan starts at the document top so quote state and column
// indices are correct for any viewport, but decorations are only emitted for
// visible ranges.

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import type { IrodoriUiColors } from "@/theme";

export type DelimitedField = {
  from: number;
  to: number;
  /** Zero-based column index within the record. */
  column: number;
  /** Zero-based record index; record 0 is the header row. */
  record: number;
};

export const csvColumnColorCount = 6;

/**
 * Split delimited text into field ranges, quote-aware. Empty fields are
 * reported too (they still advance the column index).
 */
export function tokenizeDelimited(
  text: string,
  delimiter: string,
): DelimitedField[] {
  const fields: DelimitedField[] = [];
  const length = text.length;
  let record = 0;
  let column = 0;
  let fieldStart = 0;
  let i = 0;
  const pushField = (to: number) => {
    fields.push({ from: fieldStart, to, column, record });
  };
  while (i < length) {
    const ch = text[i];
    if (ch === '"' && i === fieldStart) {
      // Quoted field: consume through the closing quote. `""` escapes a
      // quote; delimiters and newlines inside are plain content.
      i += 1;
      while (i < length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === delimiter) {
      pushField(i);
      column += 1;
      i += 1;
      fieldStart = i;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      pushField(i);
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      i += 1;
      record += 1;
      column = 0;
      fieldStart = i;
      continue;
    }
    i += 1;
  }
  if (fieldStart < length || column > 0) {
    pushField(length);
  }
  return fields;
}

const columnMarks = Array.from({ length: csvColumnColorCount }, (_, index) => ({
  body: Decoration.mark({ class: `cm-csv-col-${index}` }),
  header: Decoration.mark({ class: `cm-csv-header cm-csv-col-${index}` }),
}));

function buildDelimitedDecorations(
  view: EditorView,
  delimiter: string,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges = view.visibleRanges;
  if (ranges.length === 0) {
    return builder.finish();
  }
  const lastTo = ranges[ranges.length - 1].to;
  const text = view.state.doc.sliceString(0, lastTo);
  let rangeIdx = 0;
  for (const field of tokenizeDelimited(text, delimiter)) {
    if (field.from === field.to) {
      continue;
    }
    while (rangeIdx < ranges.length && ranges[rangeIdx].to <= field.from) {
      rangeIdx += 1;
    }
    if (rangeIdx >= ranges.length || field.to <= ranges[rangeIdx].from) {
      continue;
    }
    const mark = columnMarks[field.column % csvColumnColorCount];
    builder.add(
      field.from,
      field.to,
      field.record === 0 ? mark.header : mark.body,
    );
  }
  return builder.finish();
}

function delimitedHighlightPlugin(delimiter: string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDelimitedDecorations(view, delimiter);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDelimitedDecorations(update.view, delimiter);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

// Column ramp ordered so neighbouring columns contrast; every stop is a theme
// accent, so it tracks light/dark themes instead of clashing with them.
export function csvColumnColors(ui: IrodoriUiColors): readonly string[] {
  return [ui.blue, ui.amber, ui.teal, ui.purple, ui.green, ui.red];
}

function delimitedHighlightTheme(ui: IrodoriUiColors): Extension {
  const rules: Record<string, Record<string, string>> = {
    ".cm-csv-header": {
      fontWeight: "700",
      textDecoration: "underline",
      textUnderlineOffset: "3px",
    },
  };
  csvColumnColors(ui).forEach((color, index) => {
    rules[`.cm-csv-col-${index}`] = { color };
  });
  return EditorView.theme(rules);
}

/** Rainbow-CSV style columns for delimiter-separated buffers. */
export function delimitedHighlighting(
  delimiter: string,
  ui: IrodoriUiColors,
): Extension {
  return [delimitedHighlightPlugin(delimiter), delimitedHighlightTheme(ui)];
}
