import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { CSSProperties } from "react";
import {
  AlignLeft,
  ChevronDown,
  FileSearch,
  Pencil,
  PanelBottomClose,
  PanelRightClose,
  Play,
  Save,
  Search,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import SqlEditor, {
  type SqlEditorHandle,
  type SqlEditorSelection,
  type SqlMetadataToolWindowRequest,
} from "./SqlEditor";
import type {
  DatabaseMetadata,
  DbEngine,
} from "../../generated/irodori-api";
import type { SqlSnippetDefinition } from "../../sql/completion";
import type { SqlFormatterId } from "../../sql/formatter";
import {
  sqlMetadataTargetTitle,
  type SqlMetadataTarget,
} from "../../sql/metadata-inspection";
import type { SqlLinterId } from "../../sql/linter";
import type { IrodoriTheme } from "@/theme";
import type { EditorSplitMode } from "../workbench";
import {
  ShortcutTips,
  type ShortcutTip,
} from "../workbench/components/ShortcutTips";
import { findSqlFile, hasDraggedFiles } from "./drag-drop";
import { renderSqlMetadataTooltip } from "./sql-metadata-tooltip";

export type EditorGroup = "primary" | "secondary";
export type EditorSelection = SqlEditorSelection;
export type EditorSelections = readonly EditorSelection[];

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
  sqlSnippets: readonly SqlSnippetDefinition[];
  editorBackgroundImage: string;
  editorBackgroundOpacity: number;
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
  setEditorSelection: (selection: EditorSelections) => void;
  runPrimaryLabel: string;
  runShortcutLabel: string;
  runCurrentShortcutLabel: string;
  runFromStartShortcutLabel: string;
  runAllShortcutLabel: string;
  shortcutTips: readonly ShortcutTip[];
  runMenuOpen: boolean;
  hasSelectedEditorSql: boolean;
  resultActionsAvailable: boolean;
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
  onSqlFileDrop?: (file: File) => void;
  onUnsupportedFileDrop?: () => void;
  sqlFileDropLabel?: string;
  onMetadataJump?: (target: SqlMetadataTarget) => void;
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
  sqlSnippets,
  editorBackgroundImage,
  editorBackgroundOpacity,
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
  shortcutTips,
  runMenuOpen,
  hasSelectedEditorSql,
  resultActionsAvailable,
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
  onSqlFileDrop,
  onUnsupportedFileDrop,
  sqlFileDropLabel = "Drop .sql file to load",
  onMetadataJump,
}: QueryEditorPaneProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [metadataToolWindow, setMetadataToolWindow] =
    useState<SqlMetadataToolWindowRequest | null>(null);
  const [sqlFileDragOver, setSqlFileDragOver] = useState(false);
  const runControlRef = useRef<HTMLDivElement | null>(null);
  const sqlFileDragDepthRef = useRef(0);
  const editorBackgroundStyle = editorShellBackgroundStyle(
    editorBackgroundImage,
    editorBackgroundOpacity,
  );
  const showShortcutTips = query.trim().length === 0;

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setContextMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!runMenuOpen) {
      return;
    }
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && runControlRef.current?.contains(target)) {
        return;
      }
      setRunMenuOpen(false);
    };
    const closeOnBlur = () => setRunMenuOpen(false);
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [runMenuOpen, setRunMenuOpen]);

  useEffect(() => {
    if (onSqlFileDrop) {
      return;
    }

    sqlFileDragDepthRef.current = 0;
    setSqlFileDragOver(false);
  }, [onSqlFileDrop]);

  const openEditorContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    group: EditorGroup,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveEditorGroup(group);
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const runContextCommand = (commandId: string) => {
    setContextMenu(null);
    runCommand(commandId);
  };

  const revealMetadataUsage = (selection: EditorSelection) => {
    const primary = editorApiRef.current;
    const secondary = secondaryEditorApiRef.current;
    const active =
      activeEditorGroup === "secondary" ? secondary ?? primary : primary ?? secondary;
    active?.revealRange(selection);
  };

  const resetSqlFileDragState = () => {
    sqlFileDragDepthRef.current = 0;
    setSqlFileDragOver(false);
  };

  const prepareSqlFileDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!onSqlFileDrop || !hasDraggedFiles(event.dataTransfer)) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    return true;
  };

  const handleSqlFileDragEnter = (event: ReactDragEvent<HTMLElement>) => {
    if (!prepareSqlFileDrop(event)) {
      return;
    }

    sqlFileDragDepthRef.current += 1;
    setSqlFileDragOver(true);
  };

  const handleSqlFileDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!prepareSqlFileDrop(event)) {
      return;
    }

    setSqlFileDragOver(true);
  };

  const handleSqlFileDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!onSqlFileDrop || !hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.stopPropagation();
    sqlFileDragDepthRef.current = Math.max(0, sqlFileDragDepthRef.current - 1);

    if (sqlFileDragDepthRef.current === 0) {
      setSqlFileDragOver(false);
    }
  };

  const handleSqlFileDrop = (event: ReactDragEvent<HTMLElement>) => {
    const dropSqlFile = onSqlFileDrop;

    if (!dropSqlFile || !prepareSqlFileDrop(event)) {
      return;
    }

    resetSqlFileDragState();

    const sqlFile = findSqlFile(event.dataTransfer.files);
    if (!sqlFile) {
      onUnsupportedFileDrop?.();
      return;
    }

    dropSqlFile(sqlFile);
  };

  return (
    <section
      className={`editor-pane${sqlFileDragOver ? " sql-file-drag-over" : ""}`}
      data-drop-label={sqlFileDropLabel}
      aria-label={activeTabLabel}
      onDragEnter={handleSqlFileDragEnter}
      onDragOver={handleSqlFileDragOver}
      onDragLeave={handleSqlFileDragLeave}
      onDrop={handleSqlFileDrop}
    >
      <div className="editor-meta">
        <div className="editor-title">
          <span>{activeTabLabel}</span>
          <small>
            {running ? "running..." : activeConnectionOpen ? "ready" : "closed"}
          </small>
        </div>
      </div>
      <div
        ref={editorSplitRef}
        className={`editor-split editor-split-${editorSplitMode}`}
      >
        <div
          className={`editor-shell editor-group${
            activeEditorGroup === "primary" ? " active" : ""
          }${editorBackgroundStyle ? " editor-shell-has-background" : ""}`}
          style={editorBackgroundStyle}
          onFocusCapture={() => setActiveEditorGroup("primary")}
          onPointerDown={() => setActiveEditorGroup("primary")}
          onContextMenu={(event) => openEditorContextMenu(event, "primary")}
        >
          {editorBackgroundStyle ? (
            <div className="editor-background-image" aria-hidden="true" />
          ) : null}
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
            snippets={sqlSnippets}
            theme={theme}
            vimMode={vimMode}
            formatter={formatter}
            linter={sqlLinter}
            onMetadataJump={onMetadataJump}
            onMetadataToolWindow={setMetadataToolWindow}
          />
          {showShortcutTips ? (
            <ShortcutTips
              className="editor-shortcut-tips"
              items={shortcutTips}
            />
          ) : null}
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
              }${editorBackgroundStyle ? " editor-shell-has-background" : ""}`}
              style={editorBackgroundStyle}
              onFocusCapture={() => setActiveEditorGroup("secondary")}
              onPointerDown={() => setActiveEditorGroup("secondary")}
              onContextMenu={(event) => openEditorContextMenu(event, "secondary")}
            >
              {editorBackgroundStyle ? (
                <div className="editor-background-image" aria-hidden="true" />
              ) : null}
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
                snippets={sqlSnippets}
                theme={theme}
                vimMode={vimMode}
                formatter={formatter}
                linter={sqlLinter}
                onMetadataJump={onMetadataJump}
                onMetadataToolWindow={setMetadataToolWindow}
              />
            </div>
          </>
        ) : null}
      </div>
      {metadataToolWindow ? (
        <MetadataToolWindow
          request={metadataToolWindow}
          query={query}
          onClose={() => setMetadataToolWindow(null)}
          onEdit={() => {
            onMetadataJump?.(metadataToolWindow.target);
            setMetadataToolWindow(null);
          }}
          onRevealUsage={revealMetadataUsage}
        />
      ) : null}
      <div className="editor-floating-actions">
        <div
          className="editor-action-dock"
          role="toolbar"
          aria-label="Editor actions"
        >
          <div className="editor-command-bar">
            <button
              className="icon-button"
              type="button"
              title={`Format SQL (${formatter})`}
              aria-label="Format SQL"
              onClick={() => runCommand("editor.format")}
            >
              <AlignLeft size={15} />
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
            <div
              className="editor-split-controls"
              role="group"
              aria-label="Editor layout"
            >
              <button
                className={
                  editorSplitMode === "right"
                    ? "icon-button active"
                    : "icon-button"
                }
                type="button"
                title="Split editor right"
                aria-label="Split editor right"
                aria-pressed={editorSplitMode === "right"}
                onClick={() => setEditorSplitMode("right")}
              >
                <SplitSquareHorizontal size={15} />
              </button>
              <button
                className={
                  editorSplitMode === "down"
                    ? "icon-button active"
                    : "icon-button"
                }
                type="button"
                title="Split editor down"
                aria-label="Split editor down"
                aria-pressed={editorSplitMode === "down"}
                onClick={() => setEditorSplitMode("down")}
              >
                <SplitSquareVertical size={15} />
              </button>
              {editorSplitOpen ? (
                <button
                  className="icon-button"
                  type="button"
                  title="Close editor split"
                  aria-label="Close editor split"
                  onClick={() => setEditorSplitMode("single")}
                >
                  {editorSplitMode === "down" ? (
                    <PanelBottomClose size={15} />
                  ) : (
                    <PanelRightClose size={15} />
                  )}
                </button>
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
          <div className="editor-primary-actions">
            <button
              className="text-button toolbar-command"
              type="button"
              title="Save query"
              aria-label="Save query"
              onClick={saveCurrentQuery}
            >
              <Save size={15} />
              <span>Save</span>
            </button>
            <button
              className="text-button toolbar-command"
              type="button"
              title={
                runAllShortcutLabel
                  ? `Run All (${runAllShortcutLabel})`
                  : "Run All"
              }
              disabled={running}
              onClick={() => void runAllQuery()}
            >
              <Play size={15} />
              <span>Run All</span>
            </button>
            <div className="run-control editor-floating-run" ref={runControlRef}>
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
          </div>
        </div>
      </div>
      {contextMenu ? (
        <div
          className="app-menu-popover editor-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextCommand("query.run")}
          >
            <span>{runPrimaryLabel}</span>
            {runShortcutLabel ? <kbd>{runShortcutLabel}</kbd> : null}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextCommand("editor.quickFix")}
          >
            <span>Show Problems and Quick Fixes</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextCommand("editor.cleanup")}
          >
            <span>Code Cleanup</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextCommand("editor.format")}
          >
            <span>Format SQL</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextCommand("editor.comment.toggle")}
          >
            <span>Toggle Comment</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextCommand("editor.quickDefinition")}
          >
            <span>Quick Definition</span>
          </button>
          <span className="menu-separator" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextCommand("editor.transform.uppercase")}
          >
            <span>Uppercase selection</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextCommand("editor.transform.lowercase")}
          >
            <span>Lowercase selection</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runContextCommand("editor.transform.addCommas")}
          >
            <span>Add commas to lines</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              runContextCommand("editor.transform.doubleToSingleQuotes")
            }
          >
            <span>Double quotes to single quotes</span>
          </button>
          <span className="menu-separator" aria-hidden="true" />
          <button
            type="button"
            role="menuitem"
            disabled={!resultActionsAvailable}
            onClick={() => runContextCommand("result.copySqlInserts")}
          >
            <span>Copy result as INSERT SQL</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!resultActionsAvailable}
            onClick={() => runContextCommand("result.exportSqlInserts")}
          >
            <span>Download result as INSERT SQL</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

function editorShellBackgroundStyle(
  image: string,
  opacity: number,
): CSSProperties | undefined {
  const trimmed = image.trim();
  if (!trimmed) {
    return undefined;
  }
  return {
    "--editor-background-image": `url("${escapeCssUrl(trimmed)}")`,
    "--editor-background-image-opacity": String(opacity),
  } as CSSProperties;
}

function escapeCssUrl(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "")
    .replace(/\r/g, "")
    .replace(/\f/g, "");
}

type MetadataUsage = {
  from: number;
  to: number;
  line: number;
  column: number;
  preview: string;
};

function MetadataToolWindow({
  request,
  query,
  onClose,
  onEdit,
  onRevealUsage,
}: {
  request: SqlMetadataToolWindowRequest;
  query: string;
  onClose: () => void;
  onEdit: () => void;
  onRevealUsage: (selection: EditorSelection) => void;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const title = sqlMetadataTargetTitle(request.target);
  const usages =
    request.mode === "usages" ? findMetadataUsages(query, request.target) : [];

  useEffect(() => {
    const content = contentRef.current;
    if (!content || request.mode !== "definition") {
      return;
    }
    content.replaceChildren(
      renderSqlMetadataTooltip(request.target, {
        className: "sql-metadata-tooltip-tool-window",
      }),
    );
    return () => content.replaceChildren();
  }, [request]);

  return (
    <section
      className="metadata-tool-window"
      aria-label="Find tool window"
    >
      <div className="metadata-tool-window-header">
        <div className="metadata-tool-window-title">
          {request.mode === "usages" ? (
            <Search size={15} />
          ) : (
            <FileSearch size={15} />
          )}
          <span>{request.mode === "usages" ? "Usages" : "Definition"}</span>
          <strong>{title}</strong>
        </div>
        <div className="metadata-tool-window-actions">
          <button
            className="icon-button"
            type="button"
            title="Edit Source"
            aria-label="Edit Source"
            onClick={onEdit}
          >
            <Pencil size={14} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {request.mode === "definition" ? (
        <div ref={contentRef} className="metadata-tool-window-body" />
      ) : (
        <div className="metadata-tool-window-body metadata-usages-list">
          {usages.length === 0 ? (
            <div className="metadata-tool-window-empty">
              No usages in the current SQL buffer
            </div>
          ) : (
            usages.map((usage) => (
              <button
                key={`${usage.from}:${usage.to}`}
                className="metadata-usage-row"
                type="button"
                onClick={() =>
                  onRevealUsage({ from: usage.from, to: usage.to })
                }
              >
                <span>
                  {usage.line}:{usage.column}
                </span>
                <code>{usage.preview}</code>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function findMetadataUsages(
  query: string,
  target: SqlMetadataTarget,
): MetadataUsage[] {
  const ranges = new Map<string, MetadataUsage>();
  for (const needle of metadataUsageNeedles(target)) {
    for (const usage of findIdentifierOccurrences(query, needle)) {
      ranges.set(`${usage.from}:${usage.to}`, usage);
    }
  }
  return Array.from(ranges.values()).sort((left, right) => left.from - right.from);
}

function metadataUsageNeedles(target: SqlMetadataTarget): string[] {
  const object = target.object;
  const values =
    target.kind === "column"
      ? [
          `${object.schema}.${object.name}.${target.column.name}`,
          `${object.name}.${target.column.name}`,
          target.column.name,
        ]
      : [`${object.schema}.${object.name}`, object.name];
  return [...new Set(values.map((value) => value.toLowerCase()))].sort(
    (left, right) => right.length - left.length,
  );
}

function findIdentifierOccurrences(
  query: string,
  needle: string,
): MetadataUsage[] {
  const lowerQuery = query.toLowerCase();
  const usages: MetadataUsage[] = [];
  let index = lowerQuery.indexOf(needle);
  while (index >= 0) {
    const to = index + needle.length;
    if (isIdentifierBoundary(query[index - 1]) && isIdentifierBoundary(query[to])) {
      const { line, column } = lineColumnAt(query, index);
      usages.push({
        from: index,
        to,
        line,
        column,
        preview: linePreviewAt(query, index),
      });
    }
    index = lowerQuery.indexOf(needle, index + Math.max(needle.length, 1));
  }
  return usages;
}

function lineColumnAt(query: string, index: number) {
  let line = 1;
  let lineStart = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (query[cursor] === "\n") {
      line += 1;
      lineStart = cursor + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

function linePreviewAt(query: string, index: number): string {
  const lineStart = query.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = query.indexOf("\n", index);
  return query
    .slice(lineStart, lineEnd < 0 ? query.length : lineEnd)
    .trim()
    .slice(0, 180);
}

function isIdentifierBoundary(char: string | undefined): boolean {
  return !char || !/[A-Za-z0-9_$]/.test(char);
}
