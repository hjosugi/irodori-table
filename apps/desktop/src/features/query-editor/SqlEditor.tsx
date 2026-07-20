// CodeMirror 6 SQL editor (ADR 0001).
//
// The host is CM6: `basicSetup` gives line numbers, history, bracket matching,
// active-line highlight, and autocomplete plumbing; `@codemirror/lang-sql`
// supplies dialect-aware parsing bound to the active engine. Irodori's SQL
// highlighting helper maps parser tokens into the normalized theme model, with
// Tree-sitter activation gated on bundled solid grammars. Completion stays
// deliberately light: local metadata plus shallow current-statement context.
// The formatter defaults to `sql-formatter`, dialect-mapped per engine, behind
// a configurable hook.
//
// Buffers are not always SQL: the tab's file-style label routes the language
// (EDITOR-178), so `.csv`/`.tsv` tabs get rainbow columns, `.log` tabs get
// severity/timestamp highlighting, `.txt` stays plain, and everything else
// keeps the SQL pipeline (dialect, completion, lint, metadata insight).

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { usePreferencesStore } from "@/features/preferences";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  type Extension,
  type SelectionRange,
} from "@codemirror/state";
import { acceptCompletion, completionStatus } from "@codemirror/autocomplete";
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";
import {
  linter,
  lintGutter,
  lintKeymap,
  forceLinting,
  openLintPanel,
  type Diagnostic,
} from "@codemirror/lint";
import {
  indentLess,
  indentMore,
  indentWithTab,
  selectAll,
  selectLine,
  toggleComment,
} from "@codemirror/commands";
import { vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import { indentOnInput } from "@codemirror/language";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { rainbowBrackets } from "./editor-rainbow-brackets";
import { delimitedHighlighting } from "./editor-csv-highlight";
import { logHighlighting } from "./editor-log-highlight";
import {
  currentLogFilter,
  emptyLogFilter,
  logFilterSpecsEqual,
  logLineFilter,
  setLogFilterEffect,
  type LogFilterSpec,
} from "./editor-log-filter";
import {
  editorLanguageForTabLabel,
  type EditorLanguage,
} from "@/lib/editor-language";
import type { DatabaseMetadata, DbEngine } from "@/generated/irodori-api";
import type { SqlSnippetDefinition } from "@/sql/completion";
import { buildSqlExtensions } from "@/sql/dialect";
import { formatSqlDocument, type SqlFormatterId } from "@/sql/formatter";
import { sqlHighlightingExtensions } from "@/sql/highlighting";
import { lintSqlDocument, type SqlLinterId } from "@/sql/linter";
import type { SqlMetadataTarget } from "@/sql/metadata-inspection";
import {
  transformSqlEditorText,
  type SqlEditorTransformAction,
} from "@/sql/editor-transforms";
import { editorThemeExtensions, type IrodoriTheme } from "@/theme";
import {
  openQuickDefinitionAtSelection,
  sqlMetadataInsightExtensions,
} from "./sql-editor-metadata";
import { errorMessage } from "@/core";

export type SqlEditorSelection = { from: number; to: number };
export type SqlMetadataToolWindowMode = "definition" | "usages";
export type SqlMetadataToolWindowRequest = {
  target: SqlMetadataTarget;
  mode: SqlMetadataToolWindowMode;
};
export type SqlEditorCommandResult = {
  error: string | null;
  changed: boolean;
  skipped?: "empty" | "unchanged";
};

export interface SqlEditorHandle {
  /** Document offsets of the current selection (collapsed range = caret). */
  getSelection: () => SqlEditorSelection;
  /** Document offsets for every selection/cursor range. */
  getSelections: () => SqlEditorSelection[];
  /** Open the Quick Definition popup for the symbol under the main caret. */
  quickDefinition: () => boolean;
  /** Select and scroll a document range into view. */
  revealRange: (selection: SqlEditorSelection) => void;
  /**
   * Pretty-print the whole buffer with the engine's dialect, in place.
   * Reports no-op cases separately so the host does not show a fake success.
   */
  format: () => Promise<SqlEditorCommandResult>;
  /** Run deterministic cleanup across the whole buffer. */
  cleanup: () => Promise<SqlEditorCommandResult>;
  /** Focus the editor and show diagnostics/quick-fix actions near the caret. */
  showQuickFix: () => boolean;
  /** Toggle SQL line/block comments around the current selection. */
  toggleComment: () => boolean;
  /** Indent the selected lines or current line. */
  indentSelection: () => boolean;
  /** Outdent the selected lines or current line. */
  outdentSelection: () => boolean;
  /** Transform the current selection, or the current line when nothing is selected. */
  transformSelection: (action: SqlEditorTransformAction) => boolean;
  /** Insert text at the current selection/caret without remounting the editor. */
  insertText: (text: string) => void;
  focus: () => void;
}

interface SqlEditorProps {
  value: string;
  onChange: (next: string) => void;
  onSelectionChange?: (selection: SqlEditorSelection[]) => void;
  /**
   * File-style tab label ("scratch.sql", "orders.csv"); routes the buffer's
   * language. Missing/unknown extensions keep the historical SQL behavior.
   */
  tabLabel?: string;
  engine: DbEngine;
  /** View-level log filter for `.log` buffers (issue #177); never edits the doc. */
  logFilter?: LogFilterSpec;
  /** Introspection metadata for the active connection (drives table/column completion). */
  metadata?: DatabaseMetadata;
  snippets: readonly SqlSnippetDefinition[];
  theme: IrodoriTheme;
  vimMode: boolean;
  formatter: SqlFormatterId;
  linter: SqlLinterId;
  onMetadataJump?: (target: SqlMetadataTarget) => void;
  onMetadataToolWindow?: (request: SqlMetadataToolWindowRequest) => void;
}

interface SqlEditorCompartments {
  clipboard: Compartment;
  vim: Compartment;
  sql: Compartment;
  lint: Compartment;
  theme: Compartment;
  highlight: Compartment;
}

interface CreateSqlEditorViewOptions {
  host: HTMLDivElement;
  value: string;
  onChangeRef: { current: (next: string) => void };
  onSelectionChangeRef: {
    current: ((selection: SqlEditorSelection[]) => void) | undefined;
  };
  language: EditorLanguage;
  engine: DbEngine;
  metadata: DatabaseMetadata | undefined;
  snippets: readonly SqlSnippetDefinition[];
  theme: IrodoriTheme;
  vimMode: boolean;
  linter: SqlLinterId;
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined;
  onMetadataToolWindow:
    | ((request: SqlMetadataToolWindowRequest) => void)
    | undefined;
  compartments: SqlEditorCompartments;
}

interface FormatEditorResult {
  error: string | null;
  formatted?: string;
  skipped?: "empty" | "unchanged";
}

function createSqlEditorCompartments(): SqlEditorCompartments {
  return {
    clipboard: new Compartment(),
    vim: new Compartment(),
    sql: new Compartment(),
    lint: new Compartment(),
    theme: new Compartment(),
    highlight: new Compartment(),
  };
}

function createSqlEditorView(options: CreateSqlEditorViewOptions): EditorView {
  return new EditorView({
    parent: options.host,
    state: createSqlEditorState(options),
  });
}

function createSqlEditorState({
  value,
  onChangeRef,
  onSelectionChangeRef,
  language,
  engine,
  metadata,
  snippets,
  theme,
  vimMode,
  linter: linterId,
  onMetadataJump,
  onMetadataToolWindow,
  compartments,
}: Omit<CreateSqlEditorViewOptions, "host">): EditorState {
  return EditorState.create({
    doc: value,
    extensions: [
      editorSelectAllShortcut(),
      compartments.clipboard.of(vimMode ? vimClipboardShortcuts() : []),
      compartments.vim.of(vimMode ? vim() : []),
      basicSetup,
      indentOnInput(),
      indentationMarkers({
        highlightActiveBlock: true,
        hideFirstIndent: false,
      }),
      search({ top: true }),
      highlightSelectionMatches(),
      Prec.highest(keymap.of(searchKeymap)),
      gutterLineSelection(),
      keymap.of([
        { key: "Tab", run: acceptCompletionWithTab },
        indentWithTab,
        // VS Code-style line selection; repeated presses extend by a line.
        { key: "Mod-l", run: selectLine, preventDefault: true },
      ]),
      compartments.sql.of(
        buildLanguageSqlExtensions(
          language,
          engine,
          metadata,
          snippets,
          onMetadataJump,
          onMetadataToolWindow,
        ),
      ),
      compartments.lint.of(
        buildLanguageLintExtensions(language, engine, linterId),
      ),
      compartments.theme.of(editorThemeExtensions(theme)),
      compartments.highlight.of(
        contentHighlightExtensions(language, engine, theme),
      ),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          onSelectionChangeRef.current?.(
            editorSelectionRanges(update.state.selection.ranges),
          );
        }
      }),
    ],
  });
}

// Click a line number to select that whole line (Shift+click extends the
// selection to the clicked line), matching other editors. This must be a raw
// DOM listener on the editor root: EditorView.domEventHandlers only observes
// the content element, and gutter clicks never reach it.
function gutterLineSelection(): Extension {
  return ViewPlugin.define((view) => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".cm-lineNumbers")) {
        return;
      }
      const block = view.lineBlockAtHeight(event.clientY - view.documentTop);
      const line = view.state.doc.lineAt(block.from);
      const to = Math.min(view.state.doc.length, line.to + 1);
      const anchor = event.shiftKey
        ? view.state.selection.main.anchor
        : line.from;
      view.dispatch({
        selection: EditorSelection.range(anchor, to),
        userEvent: "select",
      });
      view.focus();
      event.preventDefault();
      event.stopPropagation();
    };
    view.dom.addEventListener("mousedown", onMouseDown);
    return {
      destroy: () => view.dom.removeEventListener("mousedown", onMouseDown),
    };
  });
}

function editorSelectAllShortcut(): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (!isPrimarySelectAllShortcut(event)) {
          return false;
        }
        event.preventDefault();
        event.stopPropagation();
        return selectAll(view);
      },
    }),
  );
}

function vimClipboardShortcuts(): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (matchesCtrlShiftKey(event, "c")) {
          event.preventDefault();
          event.stopPropagation();
          copyEditorSelectionToClipboard(view.state);
          return true;
        }
        if (matchesCtrlShiftKey(event, "v")) {
          event.preventDefault();
          event.stopPropagation();
          pasteClipboardIntoEditor(view);
          return true;
        }
        return false;
      },
    }),
  );
}

function copyEditorSelectionToClipboard(state: EditorState) {
  const text = selectedEditorText(state);
  const writeText = navigator.clipboard?.writeText;
  if (text && writeText) {
    void writeText.call(navigator.clipboard, text).catch(() => undefined);
  }
}

function pasteClipboardIntoEditor(view: EditorView) {
  const readText = navigator.clipboard?.readText;
  if (!readText) {
    return;
  }
  void readText
    .call(navigator.clipboard)
    .then((text) => {
      if (!text || !view.dom.isConnected) {
        return;
      }
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    })
    .catch(() => undefined);
}

function selectedEditorText(state: EditorState): string {
  return state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => state.sliceDoc(range.from, range.to))
    .join("\n");
}

function matchesCtrlShiftKey(event: KeyboardEvent, key: "c" | "v"): boolean {
  return (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    (event.key.toLowerCase() === key ||
      event.code === `Key${key.toUpperCase()}`)
  );
}

function isPrimarySelectAllShortcut(event: KeyboardEvent): boolean {
  const isAKey = event.key.toLowerCase() === "a" || event.code === "KeyA";
  if (!isAKey || event.altKey || event.shiftKey) {
    return false;
  }
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  return mac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

function acceptCompletionWithTab(view: EditorView): boolean {
  return completionStatus(view.state) === "active" && acceptCompletion(view);
}

function visibleDiagnosticMarkers(
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === "warning" || diagnostic.severity === "error",
  );
}

// Non-SQL buffers (csv/tsv/log/text) get lexical highlighting only: no SQL
// parser, completion, metadata insight, or diagnostics.
function buildLanguageSqlExtensions(
  language: EditorLanguage,
  engine: DbEngine,
  metadata: DatabaseMetadata | undefined,
  snippets: readonly SqlSnippetDefinition[],
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined,
  onMetadataToolWindow:
    | ((request: SqlMetadataToolWindowRequest) => void)
    | undefined,
): Extension {
  if (language !== "sql") {
    return [];
  }
  return buildEditorSqlExtensions(
    engine,
    metadata,
    snippets,
    onMetadataJump,
    onMetadataToolWindow,
  );
}

function buildLanguageLintExtensions(
  language: EditorLanguage,
  engine: DbEngine,
  linterId: SqlLinterId,
): Extension[] {
  return language === "sql" ? buildSqlLintExtensions(engine, linterId) : [];
}

// Rainbow bracket-pair colouring is a code affordance and rides along with the
// SQL branch only: in csv/tsv/log buffers brackets are field content or
// section markers, and the depth colours would fight the language highlighter.
function contentHighlightExtensions(
  language: EditorLanguage,
  engine: DbEngine,
  theme: IrodoriTheme,
): Extension {
  switch (language) {
    case "csv":
      return delimitedHighlighting(",", theme.ui);
    case "tsv":
      return delimitedHighlighting("\t", theme.ui);
    case "log":
      return [logHighlighting(theme.ui), logLineFilter];
    case "text":
      return [];
    case "sql":
      return [
        sqlHighlightingExtensions(engine, theme.syntax),
        rainbowBrackets(),
      ];
  }
}

function buildSqlLintExtensions(
  engine: DbEngine,
  linterId: SqlLinterId,
): Extension[] {
  if (linterId === "disabled") {
    return [];
  }

  return [
    linter((view) => lintSqlDocument(view.state.doc.toString(), engine), {
      delay: 900,
      autoPanel: false,
      markerFilter: visibleDiagnosticMarkers,
    }),
    lintGutter({
      markerFilter: visibleDiagnosticMarkers,
    }),
    keymap.of([...lintKeymap]),
  ];
}

function buildEditorSqlExtensions(
  engine: DbEngine,
  metadata: DatabaseMetadata | undefined,
  snippets: readonly SqlSnippetDefinition[],
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined,
  onMetadataToolWindow:
    | ((request: SqlMetadataToolWindowRequest) => void)
    | undefined,
): Extension {
  return [
    buildSqlExtensions(engine, metadata, snippets),
    sqlMetadataInsightExtensions(
      metadata,
      onMetadataJump,
      onMetadataToolWindow,
    ),
  ];
}

function reconfigureVimMode(
  view: EditorView | null,
  compartments: SqlEditorCompartments,
  vimMode: boolean,
) {
  view?.dispatch({
    effects: [
      compartments.clipboard.reconfigure(
        vimMode ? vimClipboardShortcuts() : [],
      ),
      compartments.vim.reconfigure(vimMode ? vim() : []),
    ],
  });
}

function syncEditorDocument(view: EditorView | null, value: string) {
  if (!view) return;
  const current = view.state.doc.toString();
  if (value !== current) {
    replaceEditorDocument(view, current, value);
  }
}

function replaceEditorDocument(
  view: EditorView,
  current: string,
  next: string,
) {
  view.dispatch({ changes: { from: 0, to: current.length, insert: next } });
}

function reconfigureSqlExtensions(
  view: EditorView | null,
  compartments: SqlEditorCompartments,
  language: EditorLanguage,
  engine: DbEngine,
  metadata: DatabaseMetadata | undefined,
  snippets: readonly SqlSnippetDefinition[],
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined,
  onMetadataToolWindow:
    | ((request: SqlMetadataToolWindowRequest) => void)
    | undefined,
) {
  view?.dispatch({
    effects: compartments.sql.reconfigure(
      buildLanguageSqlExtensions(
        language,
        engine,
        metadata,
        snippets,
        onMetadataJump,
        onMetadataToolWindow,
      ),
    ),
  });
}

function reconfigureLintExtensions(
  view: EditorView | null,
  compartments: SqlEditorCompartments,
  language: EditorLanguage,
  engine: DbEngine,
  linterId: SqlLinterId,
) {
  view?.dispatch({
    effects: compartments.lint.reconfigure(
      buildLanguageLintExtensions(language, engine, linterId),
    ),
  });
}

function reconfigureThemeExtensions(
  view: EditorView | null,
  compartments: SqlEditorCompartments,
  language: EditorLanguage,
  engine: DbEngine,
  theme: IrodoriTheme,
) {
  view?.dispatch({
    effects: [
      compartments.theme.reconfigure(editorThemeExtensions(theme)),
      compartments.highlight.reconfigure(
        contentHighlightExtensions(language, engine, theme),
      ),
    ],
  });
}

async function formatEditorDocument(
  view: EditorView,
  engine: DbEngine,
  formatter: SqlFormatterId,
): Promise<FormatEditorResult> {
  const doc = view.state.doc.toString();
  if (!doc.trim()) return { error: null, skipped: "empty" };
  try {
    const formatted = await formatSqlDocument(doc, engine, formatter);
    if (formatted !== doc) {
      replaceEditorDocument(view, doc, formatted);
      return { error: null, formatted };
    }
    return { error: null, skipped: "unchanged" };
  } catch (error) {
    return {
      error: errorMessage(error),
    };
  }
}

async function cleanupEditorDocument(
  view: EditorView,
  engine: DbEngine,
  formatter: SqlFormatterId,
): Promise<FormatEditorResult> {
  const formatted = await formatEditorDocument(view, engine, formatter);
  if (formatted.error) {
    return formatted;
  }
  const current = view.state.doc.toString();
  const cleaned = current.replace(/[ \t]+$/gm, "").replace(/\s*$/, "\n");
  if (cleaned !== current) {
    replaceEditorDocument(view, current, cleaned);
    return { error: null, formatted: cleaned };
  }
  return formatted.skipped ? formatted : { error: null, skipped: "unchanged" };
}

function toEditorCommandResult(
  result: FormatEditorResult,
): SqlEditorCommandResult {
  return {
    error: result.error,
    changed: result.formatted !== undefined,
    skipped: result.skipped,
  };
}

function showEditorQuickFix(view: EditorView): boolean {
  forceLinting(view);
  view.focus();
  return openLintPanel(view);
}

function editorSelectionRanges(
  ranges: readonly SelectionRange[],
): SqlEditorSelection[] {
  return ranges.map((range) => ({ from: range.from, to: range.to }));
}

function insertEditorText(view: EditorView, text: string) {
  const ranges = view.state.selection.ranges;
  let offset = 0;
  const nextRanges = ranges.map((range) => {
    const from = range.from + offset;
    const head = from + text.length;
    offset += text.length - (range.to - range.from);
    return EditorSelection.cursor(head);
  });
  view.dispatch({
    changes: ranges.map((range) => ({
      from: range.from,
      to: range.to,
      insert: text,
    })),
    selection: EditorSelection.create(
      nextRanges,
      view.state.selection.mainIndex,
    ),
    scrollIntoView: true,
  });
}

function transformEditorSelection(
  view: EditorView,
  action: SqlEditorTransformAction,
) {
  const targetRanges = uniqueTransformRanges(view);
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const nextRanges: SelectionRange[] = [];
  let offset = 0;
  for (const range of targetRanges) {
    const current = view.state.doc.sliceString(range.from, range.to);
    const next = transformSqlEditorText(current, action);
    if (next === current) {
      continue;
    }
    changes.push({ from: range.from, to: range.to, insert: next });
    const from = range.from + offset;
    const to = from + next.length;
    nextRanges.push(EditorSelection.range(from, to));
    offset += next.length - (range.to - range.from);
  }
  if (changes.length === 0) {
    return false;
  }
  view.dispatch({
    changes,
    selection: EditorSelection.create(nextRanges),
    scrollIntoView: true,
  });
  return true;
}

function uniqueTransformRanges(view: EditorView): SqlEditorSelection[] {
  const seen = new Set<string>();
  const ranges: SqlEditorSelection[] = [];
  for (const selection of view.state.selection.ranges) {
    const range = selection.empty
      ? view.state.doc.lineAt(selection.from)
      : selection;
    const key = `${range.from}:${range.to}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    ranges.push({ from: range.from, to: range.to });
  }
  return ranges;
}

const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(
  function SqlEditor(
    {
      value,
      onChange,
      onSelectionChange,
      tabLabel,
      engine,
      logFilter,
      metadata,
      snippets,
      theme,
      vimMode,
      formatter,
      linter,
      onMetadataJump,
      onMetadataToolWindow,
    },
    ref,
  ) {
    const language = editorLanguageForTabLabel(tabLabel ?? "");
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    onChangeRef.current = onChange;
    onSelectionChangeRef.current = onSelectionChange;
    const compartmentsRef = useRef<SqlEditorCompartments | null>(null);
    if (!compartmentsRef.current) {
      compartmentsRef.current = createSqlEditorCompartments();
    }
    const compartments = compartmentsRef.current;

    // Create the editor once. `value`/`engine`/`metadata` seed the initial state;
    // later changes flow through the controlled-sync and reconfigure effects below.
    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const view = createSqlEditorView({
        host,
        value,
        onChangeRef,
        onSelectionChangeRef,
        language,
        engine,
        metadata,
        snippets,
        theme,
        vimMode,
        linter,
        onMetadataJump,
        onMetadataToolWindow,
        compartments,
      });
      viewRef.current = view;
      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // Mount-once: deliberately excludes value/engine/metadata (handled by effects below).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-measure whenever host font metrics change (UI zoom slider, async
    // font loading). CodeMirror caches character metrics; without this the
    // caret and click targets are drawn from stale widths/heights and land
    // on the wrong character, especially in the WebKitGTK webview.
    const uiZoom = usePreferencesStore((state) => state.uiZoom);
    useEffect(() => {
      viewRef.current?.requestMeasure();
    }, [uiZoom, theme]);
    useEffect(() => {
      let cancelled = false;
      void document.fonts?.ready.then(() => {
        if (!cancelled) {
          viewRef.current?.requestMeasure();
        }
      });
      return () => {
        cancelled = true;
      };
    }, []);

    // Toggle Vim emulation without recreating the editor or losing undo history.
    useEffect(() => {
      reconfigureVimMode(viewRef.current, compartments, vimMode);
    }, [vimMode, compartments]);

    // Controlled sync: push external value changes (history click, etc.) into the doc.
    useEffect(() => {
      syncEditorDocument(viewRef.current, value);
    }, [value]);

    // Reconfigure dialect + metadata completion when the buffer language,
    // engine, or metadata changes.
    useEffect(() => {
      reconfigureSqlExtensions(
        viewRef.current,
        compartments,
        language,
        engine,
        metadata,
        snippets,
        onMetadataJump,
        onMetadataToolWindow,
      );
    }, [
      language,
      engine,
      metadata,
      snippets,
      onMetadataJump,
      onMetadataToolWindow,
      compartments,
    ]);

    // Reconfigure the gentle SQL diagnostics without remounting the editor.
    useEffect(() => {
      reconfigureLintExtensions(
        viewRef.current,
        compartments,
        language,
        engine,
        linter,
      );
    }, [language, engine, linter, compartments]);

    // Reconfigure editor chrome + syntax highlight when the theme, language,
    // or engine changes.
    useEffect(() => {
      reconfigureThemeExtensions(
        viewRef.current,
        compartments,
        language,
        engine,
        theme,
      );
    }, [language, engine, theme, compartments]);

    // Push the log filter into the view (issue #177). The filter field rides
    // in the highlight compartment's log branch, so after a language flip it
    // reappears empty and this effect re-applies the bar's state; for non-log
    // buffers the field is absent and the dispatch is skipped.
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const next =
        language === "log" ? (logFilter ?? emptyLogFilter) : emptyLogFilter;
      if (!logFilterSpecsEqual(currentLogFilter(view.state), next)) {
        view.dispatch({ effects: setLogFilterEffect.of(next) });
      }
    }, [language, logFilter]);

    useImperativeHandle(
      ref,
      () => ({
        getSelection() {
          const main = viewRef.current?.state.selection.main;
          return { from: main?.from ?? 0, to: main?.to ?? 0 };
        },
        getSelections() {
          const ranges = viewRef.current?.state.selection.ranges;
          return ranges ? editorSelectionRanges(ranges) : [{ from: 0, to: 0 }];
        },
        quickDefinition() {
          const view = viewRef.current;
          if (!view || !metadata) return false;
          return openQuickDefinitionAtSelection(
            view,
            metadata,
            onMetadataJump,
            onMetadataToolWindow,
          );
        },
        revealRange(selection) {
          const view = viewRef.current;
          if (!view) return;
          view.dispatch({
            selection: {
              anchor: selection.from,
              head: selection.to,
            },
            scrollIntoView: true,
          });
          view.focus();
        },
        async format() {
          const view = viewRef.current;
          if (!view) {
            return { error: "editor is not ready", changed: false };
          }
          if (language !== "sql") {
            // Running the SQL formatter over csv/tsv/log content would mangle
            // it; report a no-op instead.
            return { error: null, changed: false, skipped: "unchanged" };
          }
          const result = await formatEditorDocument(view, engine, formatter);
          if (result.formatted !== undefined) {
            onChangeRef.current(result.formatted);
          }
          return toEditorCommandResult(result);
        },
        async cleanup() {
          const view = viewRef.current;
          if (!view) {
            return { error: "editor is not ready", changed: false };
          }
          if (language !== "sql") {
            return { error: null, changed: false, skipped: "unchanged" };
          }
          const result = await cleanupEditorDocument(view, engine, formatter);
          if (result.formatted !== undefined) {
            onChangeRef.current(result.formatted);
          }
          return toEditorCommandResult(result);
        },
        showQuickFix() {
          const view = viewRef.current;
          return view ? showEditorQuickFix(view) : false;
        },
        toggleComment() {
          const view = viewRef.current;
          if (!view) return false;
          return toggleComment(view);
        },
        indentSelection() {
          const view = viewRef.current;
          return view ? indentMore(view) : false;
        },
        outdentSelection() {
          const view = viewRef.current;
          return view ? indentLess(view) : false;
        },
        transformSelection(action) {
          const view = viewRef.current;
          return view ? transformEditorSelection(view, action) : false;
        },
        insertText(text) {
          const view = viewRef.current;
          if (!view || !text) return;
          insertEditorText(view, text);
        },
        focus() {
          viewRef.current?.focus();
        },
      }),
      [language, engine, formatter],
    );

    return <div className="cm-host" ref={hostRef} />;
  },
);

export default SqlEditor;
