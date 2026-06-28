// Normalized theme model (THEME-001).
//
// One model is the single source of truth for both the workbench UI (driven via
// CSS custom properties on `.app-shell`) and the editor (driven via CodeMirror
// extensions). VS Code theme imports normalize *into* this model rather than
// the app consuming TextMate scopes directly.

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import defaultThemeCatalog from "./default-themes.json";

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

export type SyntaxTokenRole = keyof IrodoriSyntaxColors;

export interface IrodoriTheme {
  name: string;
  kind: ThemeKind;
  ui: IrodoriUiColors;
  syntax: IrodoriSyntaxColors;
}

export interface DefaultThemeEntry {
  id: string;
  name: string;
  kind: ThemeKind;
  inspiredBy: string[];
  licenseNote: string;
  theme: IrodoriTheme;
}

export interface VsCodeColorThemeJson {
  $schema: "vscode://schemas/color-theme";
  name: string;
  type: "dark" | "light";
  colors: Record<string, string>;
  tokenColors: Array<{
    name?: string;
    scope: string | string[];
    settings: {
      foreground: string;
      fontStyle?: string;
    };
  }>;
  semanticHighlighting: true;
  semanticTokenColors: Record<string, string | { foreground: string }>;
}

const irodoriUiColorKeys: Array<keyof IrodoriUiColors> = [
  "border",
  "borderStrong",
  "surface",
  "surfaceRaised",
  "surfaceMuted",
  "chrome",
  "editorBg",
  "text",
  "muted",
  "green",
  "teal",
  "blue",
  "amber",
  "red",
  "purple",
  "hover",
  "selected",
  "selectedStrong",
  "focus",
  "inputBg",
  "gridHeader",
  "gridRowAlt",
  "cellBorder",
  "dangerBg",
  "warningBg",
  "selection",
  "activeLine",
  "caret",
  "gutterBg",
  "gutterText",
];

const irodoriSyntaxColorKeys: Array<keyof IrodoriSyntaxColors> = [
  "keyword",
  "string",
  "number",
  "comment",
  "type",
  "property",
  "name",
  "operator",
  "function",
  "bracket",
  "punctuation",
  "bool",
];

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
    border: "#2a2a2d",
    borderStrong: "#3d3d42",
    surface: "#171717",
    surfaceRaised: "#202020",
    surfaceMuted: "#111111",
    chrome: "#2b2b2f",
    editorBg: "#1f2324",
    text: "#cccccc",
    muted: "#858585",
    green: "#89d185",
    teal: "#4ec9b0",
    blue: "#0e639c",
    amber: "#d7ba7d",
    red: "#f48771",
    purple: "#c586c0",
    hover: "#2a2d2f",
    selected: "#303236",
    selectedStrong: "#094771",
    focus: "#007fd4",
    inputBg: "#24272b",
    gridHeader: "#252529",
    gridRowAlt: "#1a1d1d",
    cellBorder: "#292d2f",
    dangerBg: "#3b1d1d",
    warningBg: "#3a3219",
    selection: "#264f78",
    activeLine: "#2a2a2a",
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

function defaultThemeEntryFromJson(value: unknown): DefaultThemeEntry {
  if (!isJsonObject(value)) {
    throw new Error("default theme entry must be an object");
  }
  if (typeof value.id !== "string" || !value.id.trim()) {
    throw new Error("default theme entry requires an id");
  }
  if (!Array.isArray(value.inspiredBy)) {
    throw new Error(`default theme "${value.id}" requires inspiredBy`);
  }
  const kind = readThemeKind(value.kind, "dark");
  const theme = irodoriThemeFromJson(value);
  if (theme.kind !== kind) {
    throw new Error(`default theme "${value.id}" has mismatched kind`);
  }
  return {
    id: value.id.trim(),
    name: theme.name,
    kind,
    inspiredBy: value.inspiredBy.filter(
      (source): source is string => typeof source === "string",
    ),
    licenseNote:
      typeof value.licenseNote === "string"
        ? value.licenseNote
        : "Original Irodori palette.",
    theme,
  };
}

export const defaultThemeEntries: DefaultThemeEntry[] = (
  defaultThemeCatalog as unknown[]
).map(defaultThemeEntryFromJson);

export const defaultThemeEntriesByKind: Record<ThemeKind, DefaultThemeEntry[]> =
  {
    light: defaultThemeEntries.filter((entry) => entry.kind === "light"),
    dark: defaultThemeEntries.filter((entry) => entry.kind === "dark"),
  };

const defaultThemeEntryMap = new Map(
  defaultThemeEntries.map((entry) => [entry.id, entry]),
);

export function defaultThemeById(
  id: string | null | undefined,
): DefaultThemeEntry | null {
  return id ? (defaultThemeEntryMap.get(id) ?? null) : null;
}

export function isDefaultThemeId(value: unknown): value is string {
  return typeof value === "string" && defaultThemeEntryMap.has(value);
}

export function defaultThemeEntryForKind(
  kind: ThemeKind,
  preferredId?: string | null,
): DefaultThemeEntry | null {
  const preferred = defaultThemeById(preferredId);
  if (preferred?.kind === kind) {
    return preferred;
  }
  return defaultThemeEntriesByKind[kind][0] ?? null;
}

export function defaultThemeForKind(
  kind: ThemeKind,
  preferredId?: string | null,
): IrodoriTheme {
  return defaultThemeEntryForKind(kind, preferredId)?.theme ?? themes[kind];
}

export function vscodeThemeFromIrodoriTheme(
  theme: IrodoriTheme,
): VsCodeColorThemeJson {
  const { ui, syntax } = theme;
  return {
    $schema: "vscode://schemas/color-theme",
    name: theme.name,
    type: theme.kind,
    colors: {
      foreground: ui.text,
      descriptionForeground: ui.muted,
      disabledForeground: ui.muted,
      errorForeground: ui.red,
      focusBorder: ui.focus,
      contrastBorder: ui.borderStrong,
      "activityBar.background": ui.chrome,
      "activityBar.border": ui.border,
      "badge.background": ui.blue,
      "button.background": ui.blue,
      "charts.blue": ui.blue,
      "charts.foreground": ui.text,
      "charts.green": ui.green,
      "charts.purple": ui.purple,
      "charts.red": ui.red,
      "charts.yellow": ui.amber,
      "dropdown.background": ui.inputBg,
      "dropdown.border": ui.border,
      "dropdown.foreground": ui.text,
      "editor.background": ui.editorBg,
      "editor.foreground": ui.text,
      "editor.findMatchBackground": ui.selectedStrong,
      "editor.findMatchHighlightBackground": ui.selected,
      "editor.inactiveSelectionBackground": ui.selected,
      "editor.lineHighlightBackground": ui.activeLine,
      "editor.selectionBackground": ui.selection,
      "editor.selectionHighlightBackground": ui.selected,
      "editorCursor.foreground": ui.caret,
      "editorError.foreground": ui.red,
      "editorGroup.border": ui.borderStrong,
      "editorGutter.background": ui.gutterBg,
      "editorHint.foreground": ui.teal,
      "editorInfo.foreground": ui.blue,
      "editorLineNumber.foreground": ui.gutterText,
      "editorOverviewRuler.errorForeground": ui.red,
      "editorOverviewRuler.warningForeground": ui.amber,
      "editorWarning.foreground": ui.amber,
      "editorWidget.background": ui.surfaceRaised,
      "editorWidget.border": ui.border,
      "input.background": ui.inputBg,
      "input.border": ui.border,
      "input.foreground": ui.text,
      "inputValidation.errorBackground": ui.dangerBg,
      "inputValidation.errorBorder": ui.red,
      "inputValidation.warningBackground": ui.warningBg,
      "inputValidation.warningBorder": ui.amber,
      "list.activeSelectionBackground": ui.selectedStrong,
      "list.focusBackground": ui.selected,
      "list.hoverBackground": ui.hover,
      "list.inactiveSelectionBackground": ui.selected,
      "list.highlightForeground": ui.blue,
      "menu.background": ui.surfaceRaised,
      "menu.border": ui.border,
      "panel.background": ui.surfaceRaised,
      "panel.border": ui.border,
      "sideBar.background": ui.surface,
      "sideBar.border": ui.border,
      "sideBarSectionHeader.background": ui.surfaceMuted,
      "sideBarTitle.foreground": ui.text,
      "tab.activeBackground": ui.surfaceRaised,
      "tab.border": ui.border,
      "titleBar.activeBackground": ui.chrome,
      "titleBar.activeForeground": ui.text,
      "tree.tableOddRowsBackground": ui.gridRowAlt,
      "widget.border": ui.border,
    },
    tokenColors: [
      {
        name: "Comments",
        scope: ["comment", "punctuation.definition.comment"],
        settings: { foreground: syntax.comment },
      },
      {
        name: "Strings",
        scope: ["string", "constant.other.symbol"],
        settings: { foreground: syntax.string },
      },
      {
        name: "Numbers",
        scope: ["constant.numeric", "keyword.other.unit"],
        settings: { foreground: syntax.number },
      },
      {
        name: "Keywords",
        scope: ["keyword", "storage", "storage.modifier"],
        settings: { foreground: syntax.keyword },
      },
      {
        name: "Types",
        scope: ["entity.name.type", "support.type", "storage.type"],
        settings: { foreground: syntax.type },
      },
      {
        name: "Functions",
        scope: ["entity.name.function", "support.function"],
        settings: { foreground: syntax.function },
      },
      {
        name: "Properties",
        scope: ["variable.other.property", "support.variable.property"],
        settings: { foreground: syntax.property },
      },
      {
        name: "Operators",
        scope: "keyword.operator",
        settings: { foreground: syntax.operator },
      },
      {
        name: "Punctuation",
        scope: ["punctuation.separator", "punctuation.terminator"],
        settings: { foreground: syntax.punctuation },
      },
      {
        name: "Brackets",
        scope: "punctuation.section",
        settings: { foreground: syntax.bracket },
      },
    ],
    semanticHighlighting: true,
    semanticTokenColors: {
      boolean: syntax.bool,
      class: syntax.type,
      enum: syntax.type,
      enumMember: syntax.property,
      function: syntax.function,
      interface: syntax.type,
      keyword: syntax.keyword,
      method: syntax.function,
      namespace: syntax.type,
      number: syntax.number,
      operator: syntax.operator,
      parameter: syntax.name,
      property: syntax.property,
      string: syntax.string,
      struct: syntax.type,
      type: syntax.type,
      variable: syntax.name,
    },
  };
}

export type CustomThemeEntry = {
  id: string;
  name: string;
  theme: IrodoriTheme;
};

export type ThemeJsonImportSource = "irodori" | "vscode";

export interface ThemeJsonImport {
  theme: IrodoriTheme;
  source: ThemeJsonImportSource;
  warnings: string[];
}

function readThemeKind(value: unknown, fallback: ThemeKind): ThemeKind {
  return value === "light" || value === "dark" ? value : fallback;
}

function everyRecordValueIsString(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  return keys.every((key) => typeof value[key] === "string");
}

export function irodoriThemeFromJson(value: unknown): IrodoriTheme {
  if (!isJsonObject(value)) {
    throw new Error("theme must be an object");
  }
  const kind = readThemeKind(value.kind, "dark");
  if (
    typeof value.name !== "string" ||
    !isJsonObject(value.ui) ||
    !isJsonObject(value.syntax) ||
    !everyRecordValueIsString(value.ui, irodoriUiColorKeys) ||
    !everyRecordValueIsString(value.syntax, irodoriSyntaxColorKeys)
  ) {
    throw new Error("theme must be a complete Irodori theme JSON object");
  }

  const uiSource = value.ui;
  const syntaxSource = value.syntax;
  const ui = Object.fromEntries(
    irodoriUiColorKeys.map((key) => [key, uiSource[key] as string]),
  ) as unknown as IrodoriUiColors;
  const syntax = Object.fromEntries(
    irodoriSyntaxColorKeys.map((key) => [key, syntaxSource[key] as string]),
  ) as unknown as IrodoriSyntaxColors;

  return {
    name: value.name,
    kind,
    ui,
    syntax,
  };
}

function looksLikeVsCodeTheme(value: JsonObject) {
  return (
    isJsonObject(value.colors) ||
    Array.isArray(value.tokenColors) ||
    isJsonObject(value.semanticTokenColors) ||
    value.type === "dark" ||
    value.type === "light" ||
    value.type === "hc" ||
    value.type === "hcLight"
  );
}

export function importThemeJson(
  value: unknown,
  fallbackKind: ThemeKind,
): ThemeJsonImport {
  try {
    return {
      theme: irodoriThemeFromJson(value),
      source: "irodori",
      warnings: [],
    };
  } catch (error) {
    if (!isJsonObject(value) || !looksLikeVsCodeTheme(value)) {
      throw error;
    }
    const result = importVsCodeTheme(value, {
      fallbackTheme: themes[fallbackKind],
    });
    return {
      theme: result.theme,
      source: "vscode",
      warnings: result.warnings,
    };
  }
}

function customThemeSlug(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "theme"
  );
}

function createCustomThemeId(name: string, entries: CustomThemeEntry[]) {
  const base = `custom-${customThemeSlug(name)}`;
  let candidate = base;
  let suffix = 2;
  while (entries.some((entry) => entry.id === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function upsertCustomThemeEntry(
  entries: CustomThemeEntry[],
  theme: IrodoriTheme,
) {
  const existing = entries.find(
    (entry) => entry.name.toLowerCase() === theme.name.toLowerCase(),
  );
  const id = existing?.id ?? createCustomThemeId(theme.name, entries);
  const nextEntry = { id, name: theme.name, theme };
  const nextEntries = existing
    ? entries.map((entry) => (entry.id === id ? nextEntry : entry))
    : [...entries, nextEntry];
  return { id, entries: nextEntries };
}

export function customThemeEntryFromJson(
  value: unknown,
  index: number,
  entries: CustomThemeEntry[],
): CustomThemeEntry {
  const themeSource =
    isJsonObject(value) && "theme" in value ? value.theme : value;
  const theme = irodoriThemeFromJson(themeSource);
  const name =
    isJsonObject(value) && typeof value.name === "string" && value.name.trim()
      ? value.name.trim()
      : theme.name;
  const id =
    isJsonObject(value) && typeof value.id === "string" && value.id.trim()
      ? value.id.trim()
      : createCustomThemeId(name || `Custom Theme ${index + 1}`, entries);
  return {
    id,
    name: name || `Custom Theme ${index + 1}`,
    theme: { ...theme, name: name || theme.name },
  };
}

export interface VsCodeThemeImportOptions {
  fallbackTheme?: IrodoriTheme;
  licenseNote?: string;
  name?: string;
}

export interface VsCodeThemeUnsupportedKeys {
  colors: string[];
  tokenScopes: string[];
  semanticTokenColors: string[];
}

export interface VsCodeThemeImportResult {
  theme: IrodoriTheme;
  warnings: string[];
  licenseNote: string;
  unsupported: VsCodeThemeUnsupportedKeys;
}

type JsonObject = Record<string, unknown>;
type UiColorRole = keyof IrodoriUiColors;

const vscodeWorkbenchColorMappings: Record<string, readonly UiColorRole[]> = {
  foreground: ["text"],
  descriptionForeground: ["muted"],
  disabledForeground: ["muted"],
  errorForeground: ["red"],
  focusBorder: ["focus"],
  contrastBorder: ["borderStrong"],
  "activityBar.background": ["chrome"],
  "activityBar.border": ["border"],
  "badge.background": ["blue"],
  "button.background": ["blue"],
  "charts.blue": ["blue"],
  "charts.foreground": ["text"],
  "charts.green": ["green"],
  "charts.purple": ["purple"],
  "charts.red": ["red"],
  "charts.yellow": ["amber"],
  "dropdown.background": ["inputBg"],
  "dropdown.border": ["border"],
  "editor.background": ["editorBg"],
  "editor.findMatchBackground": ["selectedStrong"],
  "editor.findMatchHighlightBackground": ["selected"],
  "editor.foreground": ["text"],
  "editor.inactiveSelectionBackground": ["selected"],
  "editor.lineHighlightBackground": ["activeLine"],
  "editor.selectionBackground": ["selection", "selectedStrong"],
  "editor.selectionHighlightBackground": ["selected"],
  "editorError.foreground": ["red"],
  "editorGroup.border": ["borderStrong"],
  "editorGutter.background": ["gutterBg"],
  "editorHint.foreground": ["teal"],
  "editorInfo.foreground": ["blue"],
  "editorLineNumber.foreground": ["gutterText", "muted"],
  "editorOverviewRuler.errorForeground": ["red"],
  "editorOverviewRuler.warningForeground": ["amber"],
  "editorWarning.foreground": ["amber"],
  "editorWidget.background": ["surfaceRaised"],
  "editorWidget.border": ["border"],
  "editorCursor.foreground": ["caret"],
  "input.background": ["inputBg"],
  "input.border": ["border"],
  "input.foreground": ["text"],
  "inputValidation.errorBackground": ["dangerBg"],
  "inputValidation.errorBorder": ["red"],
  "inputValidation.warningBackground": ["warningBg"],
  "inputValidation.warningBorder": ["amber"],
  "list.activeSelectionBackground": ["selectedStrong"],
  "list.focusBackground": ["selected"],
  "list.hoverBackground": ["hover"],
  "list.inactiveSelectionBackground": ["selected"],
  "list.highlightForeground": ["blue"],
  "menu.background": ["surfaceRaised"],
  "menu.border": ["border"],
  "panel.background": ["surfaceRaised"],
  "panel.border": ["border"],
  "peekView.border": ["borderStrong"],
  "problemsErrorIcon.foreground": ["red"],
  "problemsInfoIcon.foreground": ["blue"],
  "problemsWarningIcon.foreground": ["amber"],
  "sideBar.background": ["surface"],
  "sideBar.border": ["border"],
  "sideBar.foreground": ["text"],
  "sideBarSectionHeader.background": ["surfaceMuted"],
  "sideBarSectionHeader.border": ["border"],
  "statusBar.background": ["chrome"],
  "statusBar.border": ["border"],
  "tab.activeBackground": ["surfaceRaised"],
  "tab.border": ["border"],
  "tab.inactiveBackground": ["surface"],
  "terminal.ansiBlue": ["blue"],
  "terminal.ansiBrightBlue": ["blue"],
  "terminal.ansiBrightCyan": ["teal"],
  "terminal.ansiBrightGreen": ["green"],
  "terminal.ansiBrightMagenta": ["purple"],
  "terminal.ansiBrightRed": ["red"],
  "terminal.ansiBrightYellow": ["amber"],
  "terminal.ansiCyan": ["teal"],
  "terminal.ansiGreen": ["green"],
  "terminal.ansiMagenta": ["purple"],
  "terminal.ansiRed": ["red"],
  "terminal.ansiYellow": ["amber"],
  "titleBar.activeBackground": ["chrome"],
  "titleBar.border": ["border"],
  "titleBar.inactiveBackground": ["surfaceMuted"],
};

const vscodeWorkbenchSyntaxMappings: Record<
  string,
  readonly SyntaxTokenRole[]
> = {
  foreground: ["name"],
  "editor.foreground": ["name"],
};

const semanticTokenRoleAliases: Record<string, SyntaxTokenRole> = {
  boolean: "bool",
  bracket: "bracket",
  class: "type",
  comment: "comment",
  decorator: "property",
  enum: "type",
  enummember: "property",
  event: "property",
  function: "function",
  interface: "type",
  keyword: "keyword",
  label: "name",
  macro: "function",
  method: "function",
  modifier: "keyword",
  namespace: "type",
  null: "bool",
  number: "number",
  operator: "operator",
  parameter: "name",
  property: "property",
  punctuation: "punctuation",
  regexp: "string",
  string: "string",
  struct: "type",
  type: "type",
  typeparameter: "type",
  variable: "name",
};

/** Normalize a VS Code color theme object into the internal theme model. */
export function importVsCodeTheme(
  source: unknown,
  options: VsCodeThemeImportOptions = {},
): VsCodeThemeImportResult {
  const warnings: string[] = [];
  const unsupported: VsCodeThemeUnsupportedKeys = {
    colors: [],
    tokenScopes: [],
    semanticTokenColors: [],
  };

  if (!isJsonObject(source)) {
    warnings.push("Theme import expected a JSON object; using fallback theme.");
  }

  const kind =
    inferVsCodeThemeKind(source) ?? options.fallbackTheme?.kind ?? "dark";
  const theme = cloneTheme(options.fallbackTheme ?? themes[kind]);
  theme.kind = kind;
  theme.name =
    options.name ??
    (isJsonObject(source) ? readString(source.name) : undefined) ??
    "Imported VS Code Theme";

  if (isJsonObject(source)) {
    applyVsCodeWorkbenchColors(source.colors, theme, warnings, unsupported);
    applyVsCodeTokenColors(source.tokenColors, theme, warnings, unsupported);
    applyVsCodeSemanticTokenColors(
      source.semanticTokenColors,
      theme,
      warnings,
      unsupported,
    );
  }

  appendUnsupportedWarnings(unsupported, warnings);

  return {
    theme,
    warnings,
    licenseNote: licenseNoteForImport(source, options),
    unsupported,
  };
}

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
    "--selection": ui.selection,
    "--active-line": ui.activeLine,
    "--caret": ui.caret,
    "--gutter-bg": ui.gutterBg,
    "--gutter-text": ui.gutterText,
  };
}

/** CodeMirror chrome extension for the editor, from the theme model. */
export function editorThemeExtensions(theme: IrodoriTheme): Extension {
  const { ui } = theme;
  const chrome = EditorView.theme(
    {
      "&": { color: ui.text, backgroundColor: ui.editorBg, height: "100%" },
      ".cm-scroller": {
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
        fontSize: "var(--font-code, 13px)",
        lineHeight: "var(--editor-line-height, 20px)",
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
      ".cm-line": {
        paddingLeft: "10px",
        paddingRight: "14px",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        paddingLeft: "8px",
        paddingRight: "10px",
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

  return [chrome];
}

function applyVsCodeWorkbenchColors(
  value: unknown,
  theme: IrodoriTheme,
  warnings: string[],
  unsupported: VsCodeThemeUnsupportedKeys,
): void {
  if (value === undefined) {
    return;
  }
  if (!isJsonObject(value)) {
    warnings.push("Ignored VS Code colors because it is not an object.");
    return;
  }

  for (const [key, rawColor] of Object.entries(value)) {
    const uiRoles = vscodeWorkbenchColorMappings[key];
    const syntaxRoles = vscodeWorkbenchSyntaxMappings[key] ?? [];
    if (!uiRoles && syntaxRoles.length === 0) {
      pushUnique(unsupported.colors, key);
      continue;
    }

    const color = readThemeColor(
      rawColor,
      `VS Code workbench color "${key}"`,
      warnings,
    );
    if (!color) {
      continue;
    }

    for (const role of uiRoles ?? []) {
      theme.ui[role] = color;
    }
    for (const role of syntaxRoles) {
      theme.syntax[role] = color;
    }
  }
}

function applyVsCodeTokenColors(
  value: unknown,
  theme: IrodoriTheme,
  warnings: string[],
  unsupported: VsCodeThemeUnsupportedKeys,
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    warnings.push("Ignored VS Code tokenColors because it is not an array.");
    return;
  }

  value.forEach((rule, index) => {
    if (!isJsonObject(rule)) {
      warnings.push(
        `Ignored tokenColors[${index}] because it is not an object.`,
      );
      return;
    }
    const settings = rule.settings;
    if (!isJsonObject(settings)) {
      warnings.push(
        `Ignored tokenColors[${index}] because settings is not an object.`,
      );
      return;
    }

    const label = readString(rule.name) ?? `tokenColors[${index}]`;
    const foreground = readOptionalThemeColor(
      settings.foreground,
      `${label} foreground`,
      warnings,
    );
    const background = readOptionalThemeColor(
      settings.background,
      `${label} background`,
      warnings,
    );
    const hasScope = rule.scope !== undefined;
    const scopes = textMateScopesForRule(rule.scope, label, warnings);

    if (scopes.length === 0) {
      if (hasScope) {
        return;
      }
      if (foreground) {
        theme.ui.text = foreground;
        theme.syntax.name = foreground;
      }
      if (background) {
        theme.ui.editorBg = background;
      }
      return;
    }

    if (!foreground) {
      return;
    }

    for (const scope of scopes) {
      const roles = syntaxRolesForTextMateScope(scope);
      if (roles.length === 0) {
        pushUnique(unsupported.tokenScopes, scope);
        continue;
      }
      for (const role of roles) {
        theme.syntax[role] = foreground;
      }
    }
  });
}

function applyVsCodeSemanticTokenColors(
  value: unknown,
  theme: IrodoriTheme,
  warnings: string[],
  unsupported: VsCodeThemeUnsupportedKeys,
): void {
  if (value === undefined) {
    return;
  }
  if (!isJsonObject(value)) {
    warnings.push(
      "Ignored VS Code semanticTokenColors because it is not an object.",
    );
    return;
  }

  for (const [key, rawEntry] of Object.entries(value)) {
    const roles = syntaxRolesForSemanticTokenKey(key);
    if (roles.length === 0) {
      pushUnique(unsupported.semanticTokenColors, key);
      continue;
    }

    const color = semanticTokenForeground(rawEntry, key, warnings);
    if (!color) {
      continue;
    }

    for (const role of roles) {
      theme.syntax[role] = color;
    }
  }
}

function appendUnsupportedWarnings(
  unsupported: VsCodeThemeUnsupportedKeys,
  warnings: string[],
): void {
  unsupported.colors.sort();
  unsupported.tokenScopes.sort();
  unsupported.semanticTokenColors.sort();

  if (unsupported.colors.length > 0) {
    warnings.push(
      `Ignored ${unsupported.colors.length} unsupported workbench color key(s): ${previewList(
        unsupported.colors,
      )}.`,
    );
  }
  if (unsupported.tokenScopes.length > 0) {
    warnings.push(
      `Ignored ${unsupported.tokenScopes.length} unsupported TextMate scope(s): ${previewList(
        unsupported.tokenScopes,
      )}.`,
    );
  }
  if (unsupported.semanticTokenColors.length > 0) {
    warnings.push(
      `Ignored ${
        unsupported.semanticTokenColors.length
      } unsupported semantic token key(s): ${previewList(
        unsupported.semanticTokenColors,
      )}.`,
    );
  }
}

function syntaxRolesForTextMateScope(scopeSelector: string): SyntaxTokenRole[] {
  const scope = scopeSelector.toLowerCase();
  if (scope.includes("comment")) {
    return ["comment"];
  }
  if (
    scope.includes("string") ||
    scope.includes("constant.character") ||
    scope.includes("constant.other.symbol") ||
    scope.includes("regexp")
  ) {
    return ["string"];
  }
  if (scope.includes("constant.numeric") || scope.includes("number")) {
    return ["number"];
  }
  if (
    scope.includes("constant.language") ||
    scope.includes("support.constant") ||
    scope.includes("boolean") ||
    scope.includes("null")
  ) {
    return ["bool"];
  }
  if (
    scope.includes("entity.name.function") ||
    scope.includes("support.function") ||
    scope.includes("meta.function-call") ||
    scope.includes("function")
  ) {
    return ["function"];
  }
  if (
    scope.includes("entity.name.type") ||
    scope.includes("entity.name.class") ||
    scope.includes("entity.name.enum") ||
    scope.includes("entity.name.struct") ||
    scope.includes("support.type") ||
    scope.includes("storage.type")
  ) {
    return ["type"];
  }
  if (
    scope.includes("variable.other.property") ||
    scope.includes("support.variable.property") ||
    scope.includes("entity.other.attribute-name") ||
    scope.includes("property") ||
    scope.includes("field")
  ) {
    return ["property"];
  }
  if (scope.includes("keyword.operator") || scope.includes("operator")) {
    return ["operator"];
  }
  if (
    scope.includes("keyword") ||
    scope.includes("storage.modifier") ||
    scope.includes("storage.control") ||
    scope.includes("storage")
  ) {
    return ["keyword"];
  }
  if (
    scope.includes("punctuation.section") ||
    scope.includes("brace") ||
    scope.includes("bracket") ||
    scope.includes("paren")
  ) {
    return ["bracket"];
  }
  if (
    scope.includes("punctuation") ||
    scope.includes("separator") ||
    scope.includes("delimiter")
  ) {
    return ["punctuation"];
  }
  if (
    scope.includes("variable") ||
    scope.includes("identifier") ||
    scope.includes("entity.name") ||
    scope.includes("support.variable")
  ) {
    return ["name"];
  }
  return [];
}

function syntaxRolesForSemanticTokenKey(key: string): SyntaxTokenRole[] {
  const parts = key
    .toLowerCase()
    .split(/[^a-z0-9_*]+/)
    .filter(Boolean);
  for (const part of parts) {
    const role = semanticTokenRoleAliases[part];
    if (role) {
      return [role];
    }
  }
  return [];
}

function semanticTokenForeground(
  value: unknown,
  key: string,
  warnings: string[],
): string | undefined {
  if (typeof value === "string") {
    return readThemeColor(value, `semantic token "${key}"`, warnings);
  }
  if (isJsonObject(value)) {
    return readOptionalThemeColor(
      value.foreground,
      `semantic token "${key}" foreground`,
      warnings,
    );
  }
  warnings.push(`Ignored semantic token "${key}" because it is not a color.`);
  return undefined;
}

function textMateScopesForRule(
  value: unknown,
  label: string,
  warnings: string[],
): string[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return splitTextMateScopeSelector(value);
  }
  if (!Array.isArray(value)) {
    warnings.push(
      `Ignored ${label} scope because it is not a string or array.`,
    );
    return [];
  }

  const scopes: string[] = [];
  value.forEach((scope, index) => {
    if (typeof scope !== "string") {
      warnings.push(
        `Ignored ${label} scope[${index}] because it is not a string.`,
      );
      return;
    }
    scopes.push(...splitTextMateScopeSelector(scope));
  });
  return scopes;
}

function splitTextMateScopeSelector(selector: string): string[] {
  return selector
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function inferVsCodeThemeKind(source: unknown): ThemeKind | undefined {
  if (!isJsonObject(source)) {
    return undefined;
  }

  const type = readString(source.type)?.toLowerCase();
  if (type?.includes("light")) {
    return "light";
  }
  if (type?.includes("dark") || type === "hc") {
    return "dark";
  }

  const colors = source.colors;
  if (!isJsonObject(colors)) {
    return undefined;
  }
  const editorBackground = colors["editor.background"];
  if (
    typeof editorBackground !== "string" ||
    !isVsCodeColor(editorBackground)
  ) {
    return undefined;
  }
  const luminance = relativeLuminance(editorBackground);
  if (luminance === undefined) {
    return undefined;
  }
  return luminance > 0.5 ? "light" : "dark";
}

function relativeLuminance(color: string): number | undefined {
  const hex = color.slice(1);
  const rgb =
    hex.length === 3 || hex.length === 4
      ? [hex[0], hex[1], hex[2]].map((part) => parseInt(part + part, 16))
      : hex.length === 6 || hex.length === 8
        ? [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
          ]
        : undefined;
  if (!rgb) {
    return undefined;
  }

  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function readThemeColor(
  value: unknown,
  label: string,
  warnings: string[],
): string | undefined {
  if (typeof value !== "string" || !isVsCodeColor(value)) {
    warnings.push(`Ignored ${label} because it is not a supported hex color.`);
    return undefined;
  }
  return value;
}

function readOptionalThemeColor(
  value: unknown,
  label: string,
  warnings: string[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readThemeColor(value, label, warnings);
}

function isVsCodeColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value);
}

function licenseNoteForImport(
  source: unknown,
  options: VsCodeThemeImportOptions,
): string {
  if (options.licenseNote) {
    return options.licenseNote;
  }

  const declaredLicense = isJsonObject(source)
    ? (readString(source.license) ?? readString(source.licenseNote))
    : undefined;
  if (declaredLicense) {
    return `Imported VS Code theme declares license: ${declaredLicense}. Verify terms before redistribution.`;
  }
  return "Verify the source VS Code theme license before importing or redistributing it.";
}

function cloneTheme(theme: IrodoriTheme): IrodoriTheme {
  return {
    name: theme.name,
    kind: theme.kind,
    ui: { ...theme.ui },
    syntax: { ...theme.syntax },
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function previewList(values: readonly string[]): string {
  const preview = values.slice(0, 8).join(", ");
  return values.length > 8 ? `${preview}, ...` : preview;
}
