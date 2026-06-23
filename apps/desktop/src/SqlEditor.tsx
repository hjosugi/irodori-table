// CodeMirror 6 SQL editor (ADR 0001).
//
// The host is CM6: `basicSetup` gives line numbers, history, bracket matching,
// active-line highlight, and keyword autocompletion; `@codemirror/lang-sql`
// supplies dialect-aware parsing bound to the active engine. Irodori's SQL
// highlighting helper maps parser tokens into the normalized theme model, with
// Tree-sitter activation gated on bundled solid grammars. Schema-aware
// completion is fed from introspection metadata. The formatter defaults to
// `sql-formatter`, dialect-mapped per engine, behind a configurable hook.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { indentWithTab, toggleComment } from "@codemirror/commands";
import { vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import { sql } from "@codemirror/lang-sql";
import type { DatabaseMetadata, DbEngine } from "./generated/irodori-api";
import { buildSqlConfig } from "./sql/dialect";
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

const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { value, onChange, engine, metadata, theme, vimMode, formatter },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const vimConf = useRef(new Compartment()).current;
  const sqlConf = useRef(new Compartment()).current;
  const themeConf = useRef(new Compartment()).current;
  const highlightConf = useRef(new Compartment()).current;

  // Create the editor once. `value`/`engine`/`metadata` seed the initial state;
  // later changes flow through the controlled-sync and reconfigure effects below.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          vimConf.of(vimMode ? vim() : []),
          basicSetup,
          keymap.of([indentWithTab]),
          sqlConf.of(sql(buildSqlConfig(engine, metadata))),
          themeConf.of(editorThemeExtensions(theme)),
          highlightConf.of(sqlHighlightingExtensions(engine, theme.syntax)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
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
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: vimConf.reconfigure(vimMode ? vim() : []),
    });
  }, [vimMode, vimConf]);

  // Controlled sync: push external value changes (history click, etc.) into the doc.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  // Reconfigure dialect + completion schema when the engine or metadata changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: sqlConf.reconfigure(sql(buildSqlConfig(engine, metadata))),
    });
  }, [engine, metadata, sqlConf]);

  // Reconfigure editor chrome + syntax highlight when the theme or engine changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        themeConf.reconfigure(editorThemeExtensions(theme)),
        highlightConf.reconfigure(sqlHighlightingExtensions(engine, theme.syntax)),
      ],
    });
  }, [engine, highlightConf, theme, themeConf]);

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
        const doc = view.state.doc.toString();
        if (!doc.trim()) return null;
        try {
          const formatted = formatSqlDocument(doc, engine, formatter);
          if (formatted !== doc) {
            view.dispatch({
              changes: { from: 0, to: doc.length, insert: formatted },
            });
            onChangeRef.current(formatted);
          }
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
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
