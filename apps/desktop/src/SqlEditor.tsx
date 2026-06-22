// CodeMirror 6 SQL editor (ADR 0001).
//
// The host is CM6: `basicSetup` gives line numbers, history, bracket matching,
// active-line highlight, and keyword autocompletion; `@codemirror/lang-sql`
// supplies dialect-aware syntax highlighting bound to the active engine, plus
// schema-aware completion fed from Irodori's introspection metadata. The
// formatter is `sql-formatter`, dialect-mapped per engine. Tree-sitter is the
// planned *semantic* layer (completion scope, outline, selection) and is not
// wired here yet — see docs/adr/0001-editor-stack.md.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { basicSetup } from "codemirror";
import {
  MSSQL,
  MariaSQL,
  MySQL,
  PLSQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  sql,
  type SQLConfig,
  type SQLDialect,
  type SQLNamespace,
} from "@codemirror/lang-sql";
import type { Completion } from "@codemirror/autocomplete";
import { format as formatSql } from "sql-formatter";
import type { DatabaseMetadata, DbEngine } from "./generated/irodori-api";
import { editorThemeExtensions, type IrodoriTheme } from "./theme";

export interface SqlEditorHandle {
  /** Document offsets of the current selection (collapsed range = caret). */
  getSelection: () => { from: number; to: number };
  /**
   * Pretty-print the whole buffer with the engine's dialect, in place.
   * Returns `null` on success, or an error message when formatting fails.
   */
  format: () => string | null;
  focus: () => void;
}

interface SqlEditorProps {
  value: string;
  onChange: (next: string) => void;
  engine: DbEngine;
  /** Introspection metadata for the active connection (drives table/column completion). */
  metadata?: DatabaseMetadata;
  theme: IrodoriTheme;
}

/** Map an Irodori engine onto a CodeMirror SQL dialect (Postgres-wire siblings share one). */
function cmDialect(engine: DbEngine): SQLDialect {
  switch (engine) {
    case "mysql":
    case "tidb":
      return MySQL;
    case "mariadb":
      return MariaSQL;
    case "sqlite":
      return SQLite;
    case "sqlserver":
      return MSSQL;
    case "oracle":
      return PLSQL;
    case "postgres":
    case "cockroachdb":
    case "yugabytedb":
    case "redshift":
    case "timescaledb":
    case "neon":
    case "h2":
    case "duckdb":
      return PostgreSQL;
    default:
      return StandardSQL;
  }
}

/** Map an Irodori engine onto a sql-formatter language. */
function formatterLanguage(engine: DbEngine): string {
  switch (engine) {
    case "mysql":
      return "mysql";
    case "tidb":
      return "tidb";
    case "mariadb":
      return "mariadb";
    case "sqlite":
      return "sqlite";
    case "sqlserver":
      return "transactsql";
    case "oracle":
      return "plsql";
    case "redshift":
      return "redshift";
    case "duckdb":
      return "duckdb";
    case "clickhouse":
      return "clickhouse";
    case "postgres":
    case "cockroachdb":
    case "yugabytedb":
    case "timescaledb":
    case "neon":
    case "h2":
      return "postgresql";
    default:
      return "sql";
  }
}

/**
 * Convert Irodori introspection metadata into a CodeMirror SQL completion schema:
 * `{ schema: { table: { self, children: columns } } }`. Indexes are skipped — only
 * relations (tables/views) and their columns are completable.
 */
function metadataToNamespace(
  metadata: DatabaseMetadata | undefined,
): SQLNamespace | undefined {
  if (!metadata || metadata.schemas.length === 0) return undefined;
  const namespace: Record<string, SQLNamespace> = {};
  for (const schema of metadata.schemas) {
    const tables: Record<string, SQLNamespace> = {};
    for (const object of schema.objects) {
      if (object.kind === "index") continue;
      const columns: Completion[] = object.columns
        .slice()
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((column) => ({
          label: column.name,
          type: "property",
          detail: column.nullable ? column.dataType : `${column.dataType} not null`,
        }));
      tables[object.name] = {
        self: { label: object.name, type: object.kind === "view" ? "type" : "class" },
        children: columns,
      };
    }
    namespace[schema.name] = tables;
  }
  return namespace;
}

function buildSqlConfig(
  engine: DbEngine,
  metadata: DatabaseMetadata | undefined,
): SQLConfig {
  const schema = metadataToNamespace(metadata);
  return {
    dialect: cmDialect(engine),
    upperCaseKeywords: false,
    ...(schema
      ? { schema, defaultSchema: metadata?.schemas[0]?.name }
      : {}),
  };
}

const SqlEditor = forwardRef<SqlEditorHandle, SqlEditorProps>(function SqlEditor(
  { value, onChange, engine, metadata, theme },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const sqlConf = useRef(new Compartment()).current;
  const themeConf = useRef(new Compartment()).current;

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
          basicSetup,
          keymap.of([indentWithTab]),
          sqlConf.of(sql(buildSqlConfig(engine, metadata))),
          themeConf.of(editorThemeExtensions(theme)),
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

  // Reconfigure editor chrome + syntax highlight when the theme changes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeConf.reconfigure(editorThemeExtensions(theme)),
    });
  }, [theme, themeConf]);

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
          const formatted = formatSql(doc, {
            language: formatterLanguage(engine),
          } as Parameters<typeof formatSql>[1]);
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
      focus() {
        viewRef.current?.focus();
      },
    }),
    [engine],
  );

  return <div className="cm-host" ref={hostRef} />;
});

export default SqlEditor;
