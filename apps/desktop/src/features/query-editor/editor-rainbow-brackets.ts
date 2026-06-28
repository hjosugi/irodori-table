// Rainbow bracket pair colorization for the SQL editor.
//
// CM6 ships no bracket-pair colorization, so this is a small lexical pass: scan
// from the document start to the end of the viewport, track nesting depth across
// the four bracket kinds, and color each bracket in view by depth — cycling the
// same three hues VS Code uses (gold / orchid / sky-blue). It's lexical, not
// grammar-aware, so brackets inside string literals are colored too; that's an
// acceptable trade for an O(n)-to-viewport pass with no dependency.

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";

const OPEN = "([{";
const CLOSE = ")]}";
const LEVELS = 3;

const bracketMarks = Array.from({ length: LEVELS }, (_, level) =>
  Decoration.mark({ class: `cm-rainbow-bracket cm-rainbow-bracket-${level}` }),
);

function buildBracketDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ranges = view.visibleRanges;
  if (ranges.length === 0) {
    return builder.finish();
  }
  const lastTo = ranges[ranges.length - 1].to;
  const text = view.state.doc.sliceString(0, lastTo);
  let depth = 0;
  let rangeIdx = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const open = OPEN.includes(ch);
    const close = !open && CLOSE.includes(ch);
    if (!open && !close) {
      continue;
    }
    let level: number;
    if (open) {
      level = depth % LEVELS;
      depth += 1;
    } else {
      depth = Math.max(0, depth - 1);
      level = depth % LEVELS;
    }
    while (rangeIdx < ranges.length && ranges[rangeIdx].to <= i) {
      rangeIdx += 1;
    }
    if (
      rangeIdx < ranges.length &&
      i >= ranges[rangeIdx].from &&
      i < ranges[rangeIdx].to
    ) {
      builder.add(i, i + 1, bracketMarks[level]);
    }
  }
  return builder.finish();
}

const rainbowBracketsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildBracketDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildBracketDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const rainbowBracketsTheme = EditorView.baseTheme({
  ".cm-rainbow-bracket-0": { color: "#ffd700" },
  ".cm-rainbow-bracket-1": { color: "#da70d6" },
  ".cm-rainbow-bracket-2": { color: "#179fff" },
});

/** Color matching bracket pairs by nesting depth, VS Code style. */
export function rainbowBrackets(): Extension {
  return [rainbowBracketsPlugin, rainbowBracketsTheme];
}
