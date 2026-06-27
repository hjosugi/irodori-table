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

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, hoverTooltip, keymap } from "@codemirror/view";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { acceptCompletion, completionStatus } from "@codemirror/autocomplete";
import {
  linter,
  lintGutter,
  lintKeymap,
  type Diagnostic,
} from "@codemirror/lint";
import { indentWithTab, toggleComment } from "@codemirror/commands";
import { vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import type { DatabaseMetadata, DbEngine } from "@/generated/irodori-api";
import type { SqlSnippetDefinition } from "@/sql/completion";
import { buildSqlExtensions } from "@/sql/dialect";
import { formatSqlDocument, type SqlFormatterId } from "@/sql/formatter";
import { sqlHighlightingExtensions } from "@/sql/highlighting";
import { lintSqlDocument, type SqlLinterId } from "@/sql/linter";
import {
  inspectSqlMetadataAt,
  type SqlMetadataTarget,
} from "@/sql/metadata-inspection";
import {
  transformSqlEditorText,
  type SqlEditorTransformAction,
} from "@/sql/editor-transforms";
import { editorThemeExtensions, type IrodoriTheme } from "@/theme";
import { renderSqlMetadataTooltip } from "./sql-metadata-tooltip";

export interface SqlEditorHandle {
  /** Document offsets of the current selection (collapsed range = caret). */
  getSelection: () => { from: number; to: number };
  /**
   * Pretty-print the whole buffer with the engine's dialect, in place.
   * Returns `null` on success, or an error message when formatting fails.
   */
  format: () => string | null;
  /** Toggle SQL line/block comments around the current selection. */
  toggleComment: () => boolean;
  /** Transform the current selection, or the current line when nothing is selected. */
  transformSelection: (action: SqlEditorTransformAction) => boolean;
  /** Insert text at the current selection/caret without remounting the editor. */
  insertText: (text: string) => void;
  focus: () => void;
}

interface SqlEditorProps {
  value: string;
  onChange: (next: string) => void;
  onSelectionChange?: (selection: { from: number; to: number }) => void;
  engine: DbEngine;
  /** Introspection metadata for the active connection (drives table/column completion). */
  metadata?: DatabaseMetadata;
  snippets: readonly SqlSnippetDefinition[];
  theme: IrodoriTheme;
  vimMode: boolean;
  formatter: SqlFormatterId;
  linter: SqlLinterId;
  onMetadataJump?: (target: SqlMetadataTarget) => void;
}

interface SqlEditorCompartments {
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
    current: ((selection: { from: number; to: number }) => void) | undefined;
  };
  engine: DbEngine;
  metadata: DatabaseMetadata | undefined;
  snippets: readonly SqlSnippetDefinition[];
  theme: IrodoriTheme;
  vimMode: boolean;
  linter: SqlLinterId;
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined;
  compartments: SqlEditorCompartments;
}

interface FormatEditorResult {
  error: string | null;
  formatted?: string;
}

function createSqlEditorCompartments(): SqlEditorCompartments {
  return {
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
  engine,
  metadata,
  snippets,
  theme,
  vimMode,
  linter: linterId,
  onMetadataJump,
  compartments,
}: Omit<CreateSqlEditorViewOptions, "host">): EditorState {
  return EditorState.create({
    doc: value,
    extensions: [
      compartments.vim.of(vimMode ? vim() : []),
      basicSetup,
      keymap.of([{ key: "Tab", run: acceptCompletionWithTab }, indentWithTab]),
      compartments.sql.of(
        buildEditorSqlExtensions(engine, metadata, snippets, onMetadataJump),
      ),
      compartments.lint.of(buildSqlLintExtensions(engine, linterId)),
      compartments.theme.of(editorThemeExtensions(theme)),
      compartments.highlight.of(sqlHighlightingExtensions(engine, theme.syntax)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const selection = update.state.selection.main;
          onSelectionChangeRef.current?.({
            from: selection.from,
            to: selection.to,
          });
        }
      }),
    ],
  });
}

function acceptCompletionWithTab(view: EditorView): boolean {
  return completionStatus(view.state) === "active" && acceptCompletion(view);
}

function visibleDiagnosticMarkers(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === "warning" || diagnostic.severity === "error",
  );
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
): Extension {
  return [
    buildSqlExtensions(engine, metadata, snippets),
    sqlMetadataInsightExtensions(metadata, onMetadataJump),
  ];
}

function sqlMetadataInsightExtensions(
  metadata: DatabaseMetadata | undefined,
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined,
): Extension[] {
  if (!metadata) {
    return [];
  }

  return [
    hoverTooltip(
      (view, pos) => {
        const target = inspectSqlMetadataAt(
          view.state.doc.toString(),
          pos,
          metadata,
        );
        if (!target) {
          return null;
        }
        return {
          pos: target.range.from,
          end: target.range.to,
          above: true,
          create() {
            return { dom: renderSqlMetadataTooltip(target) };
          },
        };
      },
      { hideOnChange: true },
    ),
    keymap.of([
      {
        key: "F12",
        run: (view) => jumpToMetadataAtSelection(view, metadata, onMetadataJump),
      },
    ]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!onMetadataJump || !(event.metaKey || event.ctrlKey)) {
          return false;
        }
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) {
          return false;
        }
        const target = inspectSqlMetadataAt(
          view.state.doc.toString(),
          pos,
          metadata,
        );
        if (!target) {
          return false;
        }
        event.preventDefault();
        event.stopPropagation();
        view.dispatch({
          selection: { anchor: target.range.from, head: target.range.to },
          scrollIntoView: true,
        });
        onMetadataJump(target);
        return true;
      },
    }),
  ];
}

function jumpToMetadataAtSelection(
  view: EditorView,
  metadata: DatabaseMetadata,
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined,
): boolean {
  if (!onMetadataJump) {
    return false;
  }
  const target = inspectSqlMetadataAt(
    view.state.doc.toString(),
    view.state.selection.main.head,
    metadata,
  );
  if (!target) {
    return false;
  }
  view.dispatch({
    selection: { anchor: target.range.from, head: target.range.to },
    scrollIntoView: true,
  });
  onMetadataJump(target);
  return true;
}

function reconfigureVimMode(
  view: EditorView | null,
  compartments: SqlEditorCompartments,
  vimMode: boolean,
) {
  view?.dispatch({
    effects: compartments.vim.reconfigure(vimMode ? vim() : []),
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
  engine: DbEngine,
  metadata: DatabaseMetadata | undefined,
  snippets: readonly SqlSnippetDefinition[],
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined,
) {
  view?.dispatch({
    effects: compartments.sql.reconfigure(
      buildEditorSqlExtensions(engine, metadata, snippets, onMetadataJump),
    ),
  });
}

function reconfigureLintExtensions(
  view: EditorView | null,
  compartments: SqlEditorCompartments,
  engine: DbEngine,
  linterId: SqlLinterId,
) {
  view?.dispatch({
    effects: compartments.lint.reconfigure(
      buildSqlLintExtensions(engine, linterId),
    ),
  });
}

function reconfigureThemeExtensions(
  view: EditorView | null,
  compartments: SqlEditorCompartments,
  engine: DbEngine,
  theme: IrodoriTheme,
) {
  view?.dispatch({
    effects: [
      compartments.theme.reconfigure(editorThemeExtensions(theme)),
      compartments.highlight.reconfigure(
        sqlHighlightingExtensions(engine, theme.syntax),
      ),
    ],
  });
}

function formatEditorDocument(
  view: EditorView,
  engine: DbEngine,
  formatter: SqlFormatterId,
): FormatEditorResult {
  const doc = view.state.doc.toString();
  if (!doc.trim()) return { error: null };
  try {
    const formatted = formatSqlDocument(doc, engine, formatter);
    if (formatted !== doc) {
      replaceEditorDocument(view, doc, formatted);
      return { error: null, formatted };
    }
    return { error: null };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function insertEditorText(view: EditorView, text: string) {
  const selection = view.state.selection.main;
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: text },
    selection: { anchor: selection.from + text.length },
    scrollIntoView: true,
  });
}

function transformEditorSelection(
  view: EditorView,
  action: SqlEditorTransformAction,
) {
  const selection = view.state.selection.main;
  const range = selection.empty
    ? view.state.doc.lineAt(selection.from)
    : selection;
  const current = view.state.doc.sliceString(range.from, range.to);
  const next = transformSqlEditorText(current, action);
  if (next === current) {
    return false;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: next },
    selection: { anchor: range.from, head: range.from + next.length },
    scrollIntoView: true,
  });
  return true;
}

const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  {
    value,
    onChange,
    onSelectionChange,
    engine,
    metadata,
    snippets,
    theme,
    vimMode,
    formatter,
    linter,
    onMetadataJump,
  },
  ref,
) {
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
      engine,
      metadata,
      snippets,
      theme,
      vimMode,
      linter,
      onMetadataJump,
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

  // Toggle Vim emulation without recreating the editor or losing undo history.
  useEffect(() => {
    reconfigureVimMode(viewRef.current, compartments, vimMode);
  }, [vimMode, compartments]);

  // Controlled sync: push external value changes (history click, etc.) into the doc.
  useEffect(() => {
    syncEditorDocument(viewRef.current, value);
  }, [value]);

  // Reconfigure dialect + metadata completion when the engine or metadata changes.
  useEffect(() => {
    reconfigureSqlExtensions(
      viewRef.current,
      compartments,
      engine,
      metadata,
      snippets,
      onMetadataJump,
    );
  }, [engine, metadata, snippets, onMetadataJump, compartments]);

  // Reconfigure the gentle SQL diagnostics without remounting the editor.
  useEffect(() => {
    reconfigureLintExtensions(viewRef.current, compartments, engine, linter);
  }, [engine, linter, compartments]);

  // Reconfigure editor chrome + syntax highlight when the theme or engine changes.
  useEffect(() => {
    reconfigureThemeExtensions(viewRef.current, compartments, engine, theme);
  }, [engine, theme, compartments]);

  useImperativeHandle(
    ref,
    () => ({
      getSelection() {
        const main = viewRef.current?.state.selection.main;
        return { from: main?.from ?? 0, to: main?.to ?? 0 };
      },
      format() {
        const view = viewRef.current;
        if (!view) return null;
        const result = formatEditorDocument(view, engine, formatter);
        if (result.formatted !== undefined) {
          onChangeRef.current(result.formatted);
        }
        return result.error;
      },
      toggleComment() {
        const view = viewRef.current;
        if (!view) return false;
        return toggleComment(view);
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
    [engine, formatter],
  );

  return <div className="cm-host" ref={hostRef} />;
});

export default SqlEditor;
