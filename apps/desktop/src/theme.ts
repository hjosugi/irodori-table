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
    border: "#d3d8d2",
    borderStrong: "#b8c1b5",
    surface: "#f7f8f4",
    surfaceRaised: "#ffffff",
    surfaceMuted: "#edf0ea",
    chrome: "#fbfcf7",
    editorBg: "#fffef9",
    text: "#20242a",
    muted: "#687064",
    green: "#2e7a56",
    teal: "#157f85",
    blue: "#3367a5",
    amber: "#b56b1d",
    red: "#bd4b4b",
    purple: "#6c5cae",
    selection: "#d7e3f4",
    activeLine: "#f4efe2",
    caret: "#3367a5",
    gutterBg: "#faf5ea",
    gutterText: "#a58f72",
  },
  syntax: {
    keyword: "#2563a8",
    string: "#2e7a56",
    number: "#b56b1d",
    comment: "#8c9488",
    type: "#157f85",
    property: "#6c5cae",
    name: "#20242a",
    operator: "#687064",
    function: "#b5571d",
    bracket: "#687064",
    punctuation: "#687064",
    bool: "#b56b1d",
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
