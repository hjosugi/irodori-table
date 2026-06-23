// Normalized theme model (THEME-001).
//
// One model is the single source of truth for both the workbench UI (driven via
// CSS custom properties on `.app-shell`) and the editor (driven via CodeMirror
// extensions). VS Code theme import (THEME-002) will normalize *into* this model
// rather than the app consuming TextMate scopes directly.

import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

export type ThemeKind = "light" | "dark";

/** Workbench colors. The first block maps 1:1 onto the `.app-shell` CSS vars. */
export interface IrodoriUiColors {
  border: string;
  borderStrong: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  chrome: string;
  editorBg: string;
  text: string;
  muted: string;
  green: string;
  teal: string;
  blue: string;
  amber: string;
  red: string;
  purple: string;
  hover: string;
  selected: string;
  selectedStrong: string;
  focus: string;
  inputBg: string;
  gridHeader: string;
  gridRowAlt: string;
  cellBorder: string;
  dangerBg: string;
  warningBg: string;
  // Editor-only chrome (not exported as shell vars):
  selection: string;
  activeLine: string;
  caret: string;
  gutterBg: string;
  gutterText: string;
}

/** Syntax token colors, keyed by role (mapped onto Lezer highlight tags). */
export interface IrodoriSyntaxColors {
  keyword: string;
  string: string;
  number: string;
  comment: string;
  type: string;
  property: string;
  name: string;
  operator: string;
  function: string;
  bracket: string;
  punctuation: string;
  bool: string;
}

export interface IrodoriTheme {
  name: string;
  kind: ThemeKind;
  ui: IrodoriUiColors;
  syntax: IrodoriSyntaxColors;
}

export const lightTheme: IrodoriTheme = {
  name: "Irodori Light",
  kind: "light",
  ui: {
    border: "#d0d7de",
    borderStrong: "#afb8c1",
    surface: "#f3f3f3",
    surfaceRaised: "#ffffff",
    surfaceMuted: "#ededed",
    chrome: "#f8f8f8",
    editorBg: "#ffffff",
    text: "#1f2328",
    muted: "#6e7781",
    green: "#238636",
    teal: "#0e7490",
    blue: "#0969da",
    amber: "#9a6700",
    red: "#cf222e",
    purple: "#8250df",
    hover: "#eaeef2",
    selected: "#dbeafe",
    selectedStrong: "#c8e1ff",
    focus: "#0969da",
    inputBg: "#ffffff",
    gridHeader: "#f6f8fa",
    gridRowAlt: "#fafbfc",
    cellBorder: "#d8dee4",
    dangerBg: "#fff1f1",
    warningBg: "#fff8c5",
    selection: "#add6ff",
    activeLine: "#f6f8fa",
    caret: "#0969da",
    gutterBg: "#f6f8fa",
    gutterText: "#6e7781",
  },
  syntax: {
    keyword: "#0969da",
    string: "#116329",
    number: "#953800",
    comment: "#8c9488",
    type: "#0e7490",
    property: "#8250df",
    name: "#1f2328",
    operator: "#6e7781",
    function: "#953800",
    bracket: "#6e7781",
    punctuation: "#6e7781",
    bool: "#953800",
  },
};

export const darkTheme: IrodoriTheme = {
  name: "Irodori Dark",
  kind: "dark",
  ui: {
    border: "#303030",
    borderStrong: "#3c3c3c",
    surface: "#1e1e1e",
    surfaceRaised: "#252526",
    surfaceMuted: "#181818",
    chrome: "#2d2d30",
    editorBg: "#1e1e1e",
    text: "#d4d4d4",
    muted: "#858585",
    green: "#89d185",
    teal: "#4ec9b0",
    blue: "#75beff",
    amber: "#d7ba7d",
    red: "#f48771",
    purple: "#c586c0",
    hover: "#2a2d2e",
    selected: "#37373d",
    selectedStrong: "#094771",
    focus: "#007fd4",
    inputBg: "#1f1f1f",
    gridHeader: "#252526",
    gridRowAlt: "#1b1b1b",
    cellBorder: "#303030",
    dangerBg: "#3b1d1d",
    warningBg: "#3a3219",
    selection: "#264f78",
    activeLine: "#262626",
    caret: "#aeafad",
    gutterBg: "#1e1e1e",
    gutterText: "#858585",
  },
  syntax: {
    keyword: "#569cd6",
    string: "#ce9178",
    number: "#b5cea8",
    comment: "#6a9955",
    type: "#4ec9b0",
    property: "#9cdcfe",
    name: "#d4d4d4",
    operator: "#d4d4d4",
    function: "#dcdcaa",
    bracket: "#cccccc",
    punctuation: "#cccccc",
    bool: "#569cd6",
  },
};

export const themes: Record<ThemeKind, IrodoriTheme> = {
  light: lightTheme,
  dark: darkTheme,
};

/** CSS custom properties for the workbench shell. Spread onto `.app-shell` style. */
export function cssVariables(theme: IrodoriTheme): Record<string, string> {
  const { ui } = theme;
  return {
    "--border": ui.border,
    "--border-strong": ui.borderStrong,
    "--surface": ui.surface,
    "--surface-raised": ui.surfaceRaised,
    "--surface-muted": ui.surfaceMuted,
    "--chrome": ui.chrome,
    "--editor-bg": ui.editorBg,
    "--text": ui.text,
    "--muted": ui.muted,
    "--green": ui.green,
    "--teal": ui.teal,
    "--blue": ui.blue,
    "--amber": ui.amber,
    "--red": ui.red,
    "--purple": ui.purple,
    "--hover": ui.hover,
    "--selected": ui.selected,
    "--selected-strong": ui.selectedStrong,
    "--focus": ui.focus,
    "--input-bg": ui.inputBg,
    "--grid-header": ui.gridHeader,
    "--grid-row-alt": ui.gridRowAlt,
    "--cell-border": ui.cellBorder,
    "--danger-bg": ui.dangerBg,
    "--warning-bg": ui.warningBg,
  };
}

/** CodeMirror extensions (chrome + syntax highlight) for the editor, from the model. */
export function editorThemeExtensions(theme: IrodoriTheme): Extension {
  const { ui, syntax } = theme;
  const chrome = EditorView.theme(
    {
      "&": { color: ui.text, backgroundColor: ui.editorBg, height: "100%" },
      ".cm-scroller": {
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
        fontSize: "13px",
        lineHeight: "21px",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-content": { caretColor: ui.caret },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: ui.caret },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: ui.selection },
      ".cm-activeLine": { backgroundColor: ui.activeLine },
      ".cm-gutters": {
        backgroundColor: ui.gutterBg,
        color: ui.gutterText,
        border: "none",
        borderRight: `1px solid ${ui.border}`,
      },
      ".cm-activeLineGutter": { backgroundColor: ui.activeLine },
      ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
        backgroundColor: "transparent",
        outline: `1px solid ${ui.muted}`,
      },
      ".cm-tooltip": {
        backgroundColor: ui.surfaceRaised,
        border: `1px solid ${ui.border}`,
        color: ui.text,
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: ui.blue,
        color: "#ffffff",
      },
    },
    { dark: theme.kind === "dark" },
  );

  const highlight = syntaxHighlighting(
    HighlightStyle.define([
      { tag: t.keyword, color: syntax.keyword },
      { tag: t.operatorKeyword, color: syntax.keyword },
      { tag: [t.string, t.special(t.string)], color: syntax.string },
      { tag: t.number, color: syntax.number },
      { tag: [t.bool, t.null, t.atom], color: syntax.bool },
      {
        tag: [t.comment, t.lineComment, t.blockComment],
        color: syntax.comment,
        fontStyle: "italic",
      },
      { tag: [t.typeName, t.className], color: syntax.type },
      { tag: t.propertyName, color: syntax.property },
      { tag: [t.name, t.variableName], color: syntax.name },
      {
        tag: [t.function(t.variableName), t.function(t.propertyName)],
        color: syntax.function,
      },
      { tag: t.operator, color: syntax.operator },
      {
        tag: [t.bracket, t.paren, t.brace, t.squareBracket],
        color: syntax.bracket,
      },
      { tag: [t.punctuation, t.separator], color: syntax.punctuation },
    ]),
  );

  return [chrome, highlight];
}
