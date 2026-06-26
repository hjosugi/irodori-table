import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  AlignLeft,
  ChevronDown,
  Play,
  Save,
  SplitSquareHorizontal,
  Square,
  TerminalSquare,
} from "lucide-react";
import SqlEditor, { type SqlEditorHandle } from "../../SqlEditor";
import type {
  DatabaseMetadata,
  DbEngine,
} from "../../generated/irodori-api";
import type { SqlFormatterId } from "../../sql/formatter";
import type { SqlLinterId } from "../../sql/linter";
import type { IrodoriTheme } from "../../theme";
import type { EditorSplitMode } from "../preferences";

export type EditorGroup = "primary" | "secondary";
export type EditorSelection = { from: number; to: number };

type EditorSplitModeUpdater =
  | EditorSplitMode
  | ((mode: EditorSplitMode) => EditorSplitMode);

export interface QueryEditorPaneProps {
  activeTabLabel: string;
  activeConnectionOpen: boolean;
  running: boolean;
  formatter: SqlFormatterId;
  query: string;
  onQueryChange: (next: string) => void;
  editorEngine: DbEngine;
  activeMetadata?: DatabaseMetadata;
  theme: IrodoriTheme;
  vimMode: boolean;
  sqlLinter: SqlLinterId;
  editorApiRef: RefObject<SqlEditorHandle | null>;
  secondaryEditorApiRef: RefObject<SqlEditorHandle | null>;
  editorSplitRef: RefObject<HTMLDivElement | null>;
  editorSplitOpen: boolean;
  editorSplitMode: EditorSplitMode;
  setEditorSplitMode: (value: EditorSplitModeUpdater) => void;
  activeEditorGroup: EditorGroup;
  setActiveEditorGroup: (group: EditorGroup) => void;
  setEditorSelection: (selection: EditorSelection) => void;
  runPrimaryLabel: string;
  runShortcutLabel: string;
  runCurrentShortcutLabel: string;
  runFromStartShortcutLabel: string;
  runAllShortcutLabel: string;
  runMenuOpen: boolean;
  hasSelectedEditorSql: boolean;
  runCommand: (commandId: string) => void;
  saveCurrentQuery: () => void;
  runQuery: () => Promise<void>;
  runSelectionQuery: () => Promise<void>;
  runCurrentQuery: () => Promise<void>;
  runFromStartQuery: () => Promise<void>;
  runAllQuery: () => Promise<void>;
  cancelQuery: () => Promise<void>;
  setRunMenuOpen: (value: boolean | ((open: boolean) => boolean)) => void;
  beginEditorSplitResize: (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  onEditorSplitResizeKey: (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => void;
}

export function QueryEditorPane({
  activeTabLabel,
  activeConnectionOpen,
  running,
  formatter,
  query,
  onQueryChange,
  editorEngine,
  activeMetadata,
  theme,
  vimMode,
  sqlLinter,
  editorApiRef,
  secondaryEditorApiRef,
  editorSplitRef,
  editorSplitOpen,
  editorSplitMode,
  setEditorSplitMode,
  activeEditorGroup,
  setActiveEditorGroup,
  setEditorSelection,
  runPrimaryLabel,
  runShortcutLabel,
  runCurrentShortcutLabel,
  runFromStartShortcutLabel,
  runAllShortcutLabel,
  runMenuOpen,
  hasSelectedEditorSql,
  runCommand,
  saveCurrentQuery,
  runQuery,
  runSelectionQuery,
  runCurrentQuery,
  runFromStartQuery,
  runAllQuery,
  cancelQuery,
  setRunMenuOpen,
  beginEditorSplitResize,
  onEditorSplitResizeKey,
}: QueryEditorPaneProps) {
  return (
    <section className="editor-pane" aria-label={activeTabLabel}>
      <div className="editor-meta">
        <div className="editor-title">
          <span>{activeTabLabel}</span>
          <small>
            {running ? "running..." : activeConnectionOpen ? "ready" : "closed"}
          </small>
        </div>
        <div className="editor-command-bar">
          <button
            className="text-button toolbar-command"
            type="button"
            title={`Format SQL (${formatter})`}
            aria-label="Format SQL"
            onClick={() => runCommand("editor.format")}
          >
            <AlignLeft size={15} />
            <span>Format</span>
          </button>
          <button
            className="icon-button"
            type="button"
            title="Toggle SQL comment"
            aria-label="Toggle SQL comment"
            onClick={() => runCommand("editor.comment.toggle")}
          >
            <TerminalSquare size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Save query"
            aria-label="Save query"
            onClick={saveCurrentQuery}
          >
            <Save size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            title={editorSplitOpen ? "Close editor split" : "Split editor"}
            aria-label="Split editor"
            aria-pressed={editorSplitOpen}
            onClick={() => {
              setEditorSplitMode((mode) =>
                mode === "single" ? "right" : "single",
              );
            }}
          >
            <SplitSquareHorizontal size={15} />
          </button>
          {editorSplitOpen ? (
            <div
              className="segmented-control editor-split-mode"
              role="group"
              aria-label="Editor split direction"
            >
              <button
                type="button"
                className={editorSplitMode === "right" ? "active" : undefined}
                onClick={() => setEditorSplitMode("right")}
              >
                Right
              </button>
              <button
                type="button"
                className={editorSplitMode === "down" ? "active" : undefined}
                onClick={() => setEditorSplitMode("down")}
              >
                Down
              </button>
            </div>
          ) : null}
          <div className="run-control">
            <button
              className="primary-action run-main-button"
              type="button"
              title={
                runShortcutLabel
                  ? `${runPrimaryLabel} (${runShortcutLabel})`
                  : runPrimaryLabel
              }
              disabled={running}
              onClick={() => void runQuery()}
            >
              <Play size={15} fill="currentColor" />
              <span>{runPrimaryLabel}</span>
            </button>
            <button
              className="primary-action run-menu-toggle"
              type="button"
              title="Run options"
              aria-label="Run options"
              aria-haspopup="menu"
              aria-expanded={runMenuOpen}
              disabled={running}
              onClick={() => setRunMenuOpen((open) => !open)}
            >
              <ChevronDown size={14} />
            </button>
            {runMenuOpen ? (
              <div className="app-menu-popover run-menu-popover" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void runQuery()}
                >
                  <span>{runPrimaryLabel}</span>
                  {runShortcutLabel ? <kbd>{runShortcutLabel}</kbd> : null}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!hasSelectedEditorSql}
                  onClick={() => void runSelectionQuery()}
                >
                  <span>Run Selection</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void runCurrentQuery()}
                >
                  <span>Run Current</span>
                  {runCurrentShortcutLabel ? (
                    <kbd>{runCurrentShortcutLabel}</kbd>
                  ) : null}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void runFromStartQuery()}
                >
                  <span>Run From Top</span>
                  {runFromStartShortcutLabel ? (
                    <kbd>{runFromStartShortcutLabel}</kbd>
                  ) : null}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void runAllQuery()}
                >
                  <span>Run All</span>
                  {runAllShortcutLabel ? <kbd>{runAllShortcutLabel}</kbd> : null}
                </button>
              </div>
            ) : null}
          </div>
          <button
            className="icon-button"
            type="button"
            title="Cancel query"
            aria-label="Cancel query"
            disabled={!running}
            onClick={() => void cancelQuery()}
          >
            <Square size={15} />
          </button>
        </div>
      </div>
      <div
        ref={editorSplitRef}
        className={`editor-split editor-split-${editorSplitMode}`}
      >
        <div
          className={`editor-shell editor-group${
            activeEditorGroup === "primary" ? " active" : ""
          }`}
          onFocusCapture={() => setActiveEditorGroup("primary")}
          onPointerDown={() => setActiveEditorGroup("primary")}
        >
          <SqlEditor
            ref={editorApiRef}
            value={query}
            onChange={onQueryChange}
            onSelectionChange={(selection) => {
              setActiveEditorGroup("primary");
              setEditorSelection(selection);
            }}
            engine={editorEngine}
            metadata={activeMetadata}
            theme={theme}
            vimMode={vimMode}
            formatter={formatter}
            linter={sqlLinter}
          />
        </div>
        {editorSplitOpen ? (
          <>
            <div
              className={`panel-resizer editor-split-resizer ${editorSplitMode}`}
              role="separator"
              aria-label="Resize editor split"
              aria-orientation={
                editorSplitMode === "down" ? "horizontal" : "vertical"
              }
              tabIndex={0}
              onPointerDown={beginEditorSplitResize}
              onKeyDown={onEditorSplitResizeKey}
            />
            <div
              className={`editor-shell editor-group${
                activeEditorGroup === "secondary" ? " active" : ""
              }`}
              onFocusCapture={() => setActiveEditorGroup("secondary")}
              onPointerDown={() => setActiveEditorGroup("secondary")}
            >
              <SqlEditor
                ref={secondaryEditorApiRef}
                value={query}
                onChange={onQueryChange}
                onSelectionChange={(selection) => {
                  setActiveEditorGroup("secondary");
                  setEditorSelection(selection);
                }}
                engine={editorEngine}
                metadata={activeMetadata}
                theme={theme}
                vimMode={vimMode}
                formatter={formatter}
                linter={sqlLinter}
              />
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
