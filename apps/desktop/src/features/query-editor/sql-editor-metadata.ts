import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  EditorView,
  hoverTooltip,
  keymap,
  showTooltip,
  type Tooltip,
} from "@codemirror/view";

import type { DatabaseMetadata } from "@/generated/irodori-api";
import {
  inspectSqlMetadataAt,
  sqlMetadataTargetTitle,
  type SqlMetadataTarget,
} from "@/sql/metadata-inspection";
import {
  renderSqlMetadataTooltip,
  type SqlMetadataTooltipLink,
} from "./sql-metadata-tooltip";
import type {
  SqlEditorSelection,
  SqlMetadataToolWindowRequest,
} from "./SqlEditor";

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

export function sqlMetadataInsightExtensions(
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
        run: (view) =>
          jumpToMetadataAtSelection(view, metadata, onMetadataJump),
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
          openQuickDefinitionSource(view, quickDefinitionField, onMetadataJump),
      },
      {
        key: "Alt-Shift-ArrowLeft",
        run: (view) =>
          navigateQuickDefinitionHistory(view, quickDefinitionField, -1),
      },
      {
        key: "Alt-Shift-ArrowRight",
        run: (view) =>
          navigateQuickDefinitionHistory(view, quickDefinitionField, 1),
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
  const { metadata, onMetadataJump, onMetadataToolWindow } = popup;
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
            navigateQuickDefinitionHistory(view, quickDefinitionField, -1),
        }),
        toolbarButton({
          label: "Forward",
          text: ">",
          disabled: popup.historyIndex >= popup.history.length - 1,
          onClick: () =>
            navigateQuickDefinitionHistory(view, quickDefinitionField, 1),
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

export function openQuickDefinitionAtSelection(
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
  const object = findMetadataObject(
    metadata,
    schema,
    foreignKey.referencesTable,
  );
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
