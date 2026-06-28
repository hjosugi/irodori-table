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
import {
  EditorView,
  hoverTooltip,
  keymap,
  showTooltip,
  type Tooltip,
} from "@codemirror/view";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
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
import { indentWithTab, selectAll, toggleComment } from "@codemirror/commands";
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
  sqlMetadataTargetTitle,
  type SqlMetadataTarget,
} from "@/sql/metadata-inspection";
import {
  transformSqlEditorText,
  type SqlEditorTransformAction,
} from "@/sql/editor-transforms";
import { editorThemeExtensions, type IrodoriTheme } from "@/theme";
import {
  renderSqlMetadataTooltip,
  type SqlMetadataTooltipLink,
} from "./sql-metadata-tooltip";

export type SqlEditorSelection = { from: number; to: number };
export type SqlMetadataToolWindowMode = "definition" | "usages";
export type SqlMetadataToolWindowRequest = {
  target: SqlMetadataTarget;
  mode: SqlMetadataToolWindowMode;
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
   * Returns `null` on success, or an error message when formatting fails.
   */
  format: () => Promise<string | null>;
  /** Run deterministic cleanup across the whole buffer. */
  cleanup: () => Promise<string | null>;
  /** Focus the editor and show diagnostics/quick-fix actions near the caret. */
  showQuickFix: () => boolean;
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
  onSelectionChange?: (selection: SqlEditorSelection[]) => void;
  engine: DbEngine;
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
      search({ top: true }),
      highlightSelectionMatches(),
      Prec.highest(keymap.of(searchKeymap)),
      keymap.of([{ key: "Tab", run: acceptCompletionWithTab }, indentWithTab]),
      compartments.sql.of(
        buildEditorSqlExtensions(
          engine,
          metadata,
          snippets,
          onMetadataJump,
          onMetadataToolWindow,
        ),
      ),
      compartments.lint.of(buildSqlLintExtensions(engine, linterId)),
      compartments.theme.of(editorThemeExtensions(theme)),
      compartments.highlight.of(sqlHighlightingExtensions(engine, theme.syntax)),
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
          const text = selectedEditorText(view.state);
          if (text) {
            void navigator.clipboard?.writeText(text).catch(() => undefined);
          }
          return true;
        }
        if (matchesCtrlShiftKey(event, "v")) {
          event.preventDefault();
          event.stopPropagation();
          void navigator.clipboard?.readText?.()
            .then((text) => {
              if (!text || !view.dom.isConnected) {
                return;
              }
              view.dispatch(view.state.replaceSelection(text));
              view.focus();
            })
            .catch(() => undefined);
          return true;
        }
        return false;
      },
    }),
  );
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
    (event.key.toLowerCase() === key || event.code === `Key${key.toUpperCase()}`)
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
  onMetadataToolWindow:
    | ((request: SqlMetadataToolWindowRequest) => void)
    | undefined,
): Extension {
  return [
    buildSqlExtensions(engine, metadata, snippets),
    sqlMetadataInsightExtensions(metadata, onMetadataJump, onMetadataToolWindow),
  ];
}

type QuickDefinitionPopupState = {
  target: SqlMetadataTarget;
  metadata: DatabaseMetadata;
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined;
  onMetadataToolWindow:
    | ((request: SqlMetadataToolWindowRequest) => void)
    | undefined;
  anchor: number;
  range: SqlEditorSelection;
  history: readonly SqlMetadataTarget[];
  historyIndex: number;
};

const setQuickDefinitionEffect =
  StateEffect.define<QuickDefinitionPopupState | null>();

const quickDefinitionField: StateField<QuickDefinitionPopupState | null> =
  StateField.define<QuickDefinitionPopupState | null>({
    create: () => null,
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setQuickDefinitionEffect)) {
          return effect.value;
        }
      }
      return transaction.docChanged ? null : value;
    },
    provide: (field): Extension =>
      showTooltip.computeN([field], (state) => {
        const popup = state.field(field);
        return popup ? [quickDefinitionTooltip(popup)] : [];
      }),
  });

function sqlMetadataInsightExtensions(
  metadata: DatabaseMetadata | undefined,
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined,
  onMetadataToolWindow:
    | ((request: SqlMetadataToolWindowRequest) => void)
    | undefined,
): Extension[] {
  if (!metadata) {
    return [];
  }

  return [
    quickDefinitionField,
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
            return {
              dom: renderSqlMetadataTooltip(target, {
                className: "sql-metadata-tooltip-hover",
                links: metadataTargetLinks(metadata, target),
                onLinkClick: onMetadataJump,
                onTitleClick: onMetadataJump,
              }),
            };
          },
        };
      },
      { hideOnChange: true, hoverTime: 150 },
    ),
    keymap.of([
      {
        key: "Ctrl-Shift-i",
        run: (view) =>
          openQuickDefinitionAtSelection(
            view,
            metadata,
            onMetadataJump,
            onMetadataToolWindow,
          ),
      },
      {
        key: "Mod-Shift-i",
        run: (view) =>
          openQuickDefinitionAtSelection(
            view,
            metadata,
            onMetadataJump,
            onMetadataToolWindow,
          ),
      },
      {
        key: "F12",
        run: (view) => jumpToMetadataAtSelection(view, metadata, onMetadataJump),
      },
      {
        key: "F4",
        run: (view) =>
          editQuickDefinitionSource(
            view,
            quickDefinitionField,
            metadata,
            onMetadataJump,
          ),
      },
      {
        key: "Ctrl-Enter",
        run: (view) =>
          openQuickDefinitionSource(
            view,
            quickDefinitionField,
            onMetadataJump,
          ),
      },
      {
        key: "Alt-Shift-ArrowLeft",
        run: (view) =>
          navigateQuickDefinitionHistory(
            view,
            quickDefinitionField,
            -1,
          ),
      },
      {
        key: "Alt-Shift-ArrowRight",
        run: (view) =>
          navigateQuickDefinitionHistory(
            view,
            quickDefinitionField,
            1,
          ),
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

function quickDefinitionTooltip(popup: QuickDefinitionPopupState): Tooltip {
  const {
    metadata,
    onMetadataJump,
    onMetadataToolWindow,
  } = popup;
  return {
    pos: popup.anchor,
    end: popup.range.to,
    above: true,
    arrow: true,
    create(view) {
      const root = document.createElement("div");
      root.className = "sql-quick-definition-popup";
      root.setAttribute("role", "dialog");
      root.setAttribute(
        "aria-label",
        `Quick Definition ${sqlMetadataTargetTitle(popup.target)}`,
      );

      const toolbar = document.createElement("div");
      toolbar.className = "sql-quick-definition-toolbar";
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", "Quick Definition actions");

      toolbar.append(
        toolbarButton({
          label: "Back",
          text: "<",
          disabled: popup.historyIndex <= 0,
          onClick: () =>
            navigateQuickDefinitionHistory(
              view,
              quickDefinitionField,
              -1,
            ),
        }),
        toolbarButton({
          label: "Forward",
          text: ">",
          disabled: popup.historyIndex >= popup.history.length - 1,
          onClick: () =>
            navigateQuickDefinitionHistory(
              view,
              quickDefinitionField,
              1,
            ),
        }),
        toolbarSeparator(),
        toolbarButton({
          label: "Open Source (Ctrl+Enter)",
          text: "Open",
          disabled: !onMetadataJump,
          onClick: () => onMetadataJump?.(popup.target),
        }),
        toolbarButton({
          label: "Edit Source (F4)",
          text: "Edit",
          disabled: !onMetadataJump,
          onClick: () => {
            onMetadataJump?.(popup.target);
            view.dispatch({ effects: setQuickDefinitionEffect.of(null) });
          },
        }),
        toolbarButton({
          label: "View Usages",
          text: "Uses",
          disabled: !onMetadataToolWindow,
          onClick: () =>
            onMetadataToolWindow?.({ target: popup.target, mode: "usages" }),
        }),
      );

      const options = document.createElement("details");
      options.className = "sql-quick-definition-options";
      const summary = document.createElement("summary");
      summary.title = "Options";
      summary.setAttribute("aria-label", "Quick Definition options");
      summary.textContent = "...";
      const menu = document.createElement("div");
      menu.className = "sql-quick-definition-options-menu";
      menu.setAttribute("role", "menu");
      menu.append(
        menuButton({
          label: "Open in Find tool window",
          disabled: !onMetadataToolWindow,
          onClick: () => {
            onMetadataToolWindow?.({
              target: popup.target,
              mode: "definition",
            });
            view.dispatch({ effects: setQuickDefinitionEffect.of(null) });
          },
        }),
        menuButton({
          label: "Edit Source",
          disabled: !onMetadataJump,
          onClick: () => {
            onMetadataJump?.(popup.target);
            view.dispatch({ effects: setQuickDefinitionEffect.of(null) });
          },
        }),
      );
      options.append(summary, menu);
      toolbar.append(options);

      const close = toolbarButton({
        label: "Close",
        text: "x",
        onClick: () =>
          view.dispatch({ effects: setQuickDefinitionEffect.of(null) }),
      });
      close.classList.add("sql-quick-definition-close");
      toolbar.append(close);

      const body = renderSqlMetadataTooltip(popup.target, {
        className: "sql-metadata-tooltip-quick-definition",
        links: metadataTargetLinks(metadata, popup.target),
        onLinkClick: (target) =>
          view.dispatch({
            effects: setQuickDefinitionEffect.of(
              pushQuickDefinitionTarget(popup, target),
            ),
          }),
        onTitleClick: onMetadataJump,
      });

      root.append(toolbar, body);
      root.addEventListener("mousedown", (event) => event.stopPropagation());
      return { dom: root };
    },
  };
}

function toolbarButton({
  label,
  text,
  disabled = false,
  onClick,
}: {
  label: string;
  text: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const button = document.createElement("button");
  button.className = "sql-quick-definition-button";
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.disabled = disabled;
  button.textContent = text;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function menuButton({
  label,
  disabled = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "menuitem");
  button.disabled = disabled;
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function toolbarSeparator() {
  const separator = document.createElement("span");
  separator.className = "sql-quick-definition-separator";
  separator.setAttribute("aria-hidden", "true");
  return separator;
}

function openQuickDefinitionAtSelection(
  view: EditorView,
  metadata: DatabaseMetadata,
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined,
  onMetadataToolWindow:
    | ((request: SqlMetadataToolWindowRequest) => void)
    | undefined,
): boolean {
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
    effects: setQuickDefinitionEffect.of({
      target,
      metadata,
      onMetadataJump,
      onMetadataToolWindow,
      anchor: target.range.from,
      range: target.range,
      history: [target],
      historyIndex: 0,
    }),
  });
  return true;
}

function currentQuickDefinitionTarget(
  view: EditorView,
  field: StateField<QuickDefinitionPopupState | null>,
  metadata: DatabaseMetadata,
): SqlMetadataTarget | null {
  const popup = view.state.field(field, false);
  if (popup) {
    return popup.target;
  }
  return inspectSqlMetadataAt(
    view.state.doc.toString(),
    view.state.selection.main.head,
    metadata,
  );
}

function openQuickDefinitionSource(
  view: EditorView,
  field: StateField<QuickDefinitionPopupState | null>,
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined,
): boolean {
  if (!onMetadataJump) {
    return false;
  }
  const popup = view.state.field(field, false);
  if (!popup) {
    return false;
  }
  onMetadataJump(popup.target);
  return true;
}

function editQuickDefinitionSource(
  view: EditorView,
  field: StateField<QuickDefinitionPopupState | null>,
  metadata: DatabaseMetadata,
  onMetadataJump: ((target: SqlMetadataTarget) => void) | undefined,
): boolean {
  if (!onMetadataJump) {
    return false;
  }
  const target = currentQuickDefinitionTarget(view, field, metadata);
  if (!target) {
    return false;
  }
  onMetadataJump(target);
  view.dispatch({ effects: setQuickDefinitionEffect.of(null) });
  return true;
}

function navigateQuickDefinitionHistory(
  view: EditorView,
  field: StateField<QuickDefinitionPopupState | null>,
  delta: -1 | 1,
): boolean {
  const popup = view.state.field(field, false);
  if (!popup) {
    return false;
  }
  const nextIndex = popup.historyIndex + delta;
  if (nextIndex < 0 || nextIndex >= popup.history.length) {
    return false;
  }
  view.dispatch({
    effects: setQuickDefinitionEffect.of({
      ...popup,
      target: popup.history[nextIndex],
      historyIndex: nextIndex,
    }),
  });
  return true;
}

function pushQuickDefinitionTarget(
  popup: QuickDefinitionPopupState,
  target: SqlMetadataTarget,
): QuickDefinitionPopupState {
  const history = [...popup.history.slice(0, popup.historyIndex + 1), target];
  return {
    ...popup,
    target,
    history,
    historyIndex: history.length - 1,
  };
}

function metadataTargetLinks(
  metadata: DatabaseMetadata,
  target: SqlMetadataTarget,
): SqlMetadataTooltipLink[] {
  if (target.kind === "column") {
    return target.object.foreignKeys
      .filter((foreignKey) =>
        foreignKey.columns.some((column) =>
          sameIdentifier(column, target.column.name),
        ),
      )
      .map((foreignKey) => metadataForeignKeyLink(metadata, target, foreignKey))
      .filter((link): link is SqlMetadataTooltipLink => Boolean(link));
  }

  return target.object.foreignKeys
    .map((foreignKey) => metadataForeignKeyLink(metadata, target, foreignKey))
    .filter((link): link is SqlMetadataTooltipLink => Boolean(link));
}

function metadataForeignKeyLink(
  metadata: DatabaseMetadata,
  target: SqlMetadataTarget,
  foreignKey: SqlMetadataTarget["object"]["foreignKeys"][number],
): SqlMetadataTooltipLink | null {
  const schema = foreignKey.referencesSchema ?? target.object.schema;
  const object = findMetadataObject(metadata, schema, foreignKey.referencesTable);
  if (!object) {
    return null;
  }
  return {
    label: `references ${object.schema}.${object.name}`,
    target: { kind: "object", range: target.range, object },
  };
}

function findMetadataObject(
  metadata: DatabaseMetadata,
  schema: string,
  name: string,
) {
  for (const schemaEntry of metadata.schemas) {
    if (!sameIdentifier(schemaEntry.name, schema)) {
      continue;
    }
    const object = schemaEntry.objects.find((candidate) =>
      sameIdentifier(candidate.name, name),
    );
    if (object) {
      return object;
    }
  }
  return null;
}

function sameIdentifier(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
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
    effects: [
      compartments.clipboard.reconfigure(vimMode ? vimClipboardShortcuts() : []),
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
      buildEditorSqlExtensions(
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

async function formatEditorDocument(
  view: EditorView,
  engine: DbEngine,
  formatter: SqlFormatterId,
): Promise<FormatEditorResult> {
  const doc = view.state.doc.toString();
  if (!doc.trim()) return { error: null };
  try {
    const formatted = await formatSqlDocument(doc, engine, formatter);
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
  return formatted;
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
    onMetadataToolWindow,
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
      onMetadataToolWindow,
    );
  }, [
    engine,
    metadata,
    snippets,
    onMetadataJump,
    onMetadataToolWindow,
    compartments,
  ]);

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
        if (!view) return null;
        const result = await formatEditorDocument(view, engine, formatter);
        if (result.formatted !== undefined) {
          onChangeRef.current(result.formatted);
        }
        return result.error;
      },
      async cleanup() {
        const view = viewRef.current;
        if (!view) return null;
        const result = await cleanupEditorDocument(view, engine, formatter);
        if (result.formatted !== undefined) {
          onChangeRef.current(result.formatted);
        }
        return result.error;
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
