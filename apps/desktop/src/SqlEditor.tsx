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
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { indentWithTab, toggleComment } from "@codemirror/commands";
import { vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import type { DatabaseMetadata, DbEngine } from "./generated/irodori-api";
import { buildSqlExtensions } from "./sql/dialect";
import { formatSqlDocument, type SqlFormatterId } from "./sql/formatter";
import { sqlHighlightingExtensions } from "./sql/highlighting";
import { editorThemeExtensions, type IrodoriTheme } from "./theme";

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
  focus: () => void;
}

interface SqlEditorProps {
  value: string;
  onChange: (next: string) => void;
  engine: DbEngine;
  /** Introspection metadata for the active connection (drives table/column completion). */
  metadata?: DatabaseMetadata;
  theme: IrodoriTheme;
  vimMode: boolean;
  formatter: SqlFormatterId;
}

interface SqlEditorCompartments {
  vim: Compartment;
  sql: Compartment;
  theme: Compartment;
  highlight: Compartment;
}

interface CreateSqlEditorViewOptions {
  host: HTMLDivElement;
  value: string;
  onChangeRef: { current: (next: string) => void };
  engine: DbEngine;
  metadata: DatabaseMetadata | undefined;
  theme: IrodoriTheme;
  vimMode: boolean;
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
  engine,
  metadata,
  theme,
  vimMode,
  compartments,
}: Omit<CreateSqlEditorViewOptions, "host">): EditorState {
  return EditorState.create({
    doc: value,
    extensions: [
      compartments.vim.of(vimMode ? vim() : []),
      basicSetup,
      keymap.of([indentWithTab]),
      compartments.sql.of(buildSqlExtensions(engine, metadata)),
      compartments.theme.of(editorThemeExtensions(theme)),
      compartments.highlight.of(sqlHighlightingExtensions(engine, theme.syntax)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ],
  });
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
) {
  view?.dispatch({
    effects: compartments.sql.reconfigure(buildSqlExtensions(engine, metadata)),
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

const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { value, onChange, engine, metadata, theme, vimMode, formatter },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
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
      engine,
      metadata,
      theme,
      vimMode,
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
    reconfigureSqlExtensions(viewRef.current, compartments, engine, metadata);
  }, [engine, metadata, compartments]);

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
      focus() {
        viewRef.current?.focus();
      },
    }),
    [engine, formatter],
  );

  return <div className="cm-host" ref={hostRef} />;
});

export default SqlEditor;
