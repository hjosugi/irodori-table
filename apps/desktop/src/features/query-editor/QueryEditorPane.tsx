import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
} from "react";
import type {
  SqlEditorHandle,
  SqlMetadataToolWindowRequest,
} from "./SqlEditor";
import type { DatabaseMetadata, DbEngine } from "../../generated/irodori-api";
import type { SqlSnippetDefinition } from "../../sql/completion";
import type { SqlFormatterId } from "../../sql/formatter";
import type { SqlMetadataTarget } from "../../sql/metadata-inspection";
import type { SqlLinterId } from "../../sql/linter";
import type { IrodoriTheme } from "@/theme";
import type { EditorSplitMode } from "../workbench";
import { findSqlFile, hasDraggedFiles } from "./drag-drop";
import { EditorCommandBar } from "./EditorCommandBar";
import {
  EditorGroupShell,
  editorShellBackgroundStyle,
} from "./EditorGroupShell";
import {
  editorContextCommandGroups,
  type EditorContextCommand,
} from "./editor-commands";
import { MetadataToolWindow } from "./MetadataToolWindow";
import { RunControl } from "./RunControl";
import type {
  EditorGroup,
  EditorSelection,
  EditorSelections,
  EditorSplitModeUpdater,
} from "./query-editor-pane-types";

export type { EditorGroup, EditorSelection, EditorSelections };

export interface QueryEditorPaneProps {
  activeTabLabel: string;
  running: boolean;
  formatter: SqlFormatterId;
  primaryQuery: string;
  secondaryQuery: string;
  onPrimaryQueryChange: (next: string) => void;
  onSecondaryQueryChange: (next: string) => void;
  renderEditorTabStrip: (group: EditorGroup) => ReactNode;
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
  setEditorSelection: (group: EditorGroup, selection: EditorSelections) => void;
  runPrimaryLabel: string;
  runShortcutLabel: string;
  runCurrentShortcutLabel: string;
  runFromStartShortcutLabel: string;
  runAllShortcutLabel: string;
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
  beginEditorSplitResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEditorSplitResizeKey: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onSqlFileDrop?: (file: File) => void;
  onUnsupportedFileDrop?: () => void;
  sqlFileDropLabel?: string;
  onMetadataJump?: (target: SqlMetadataTarget) => void;
}

export function QueryEditorPane({
  activeTabLabel,
  running,
  formatter,
  primaryQuery,
  secondaryQuery,
  onPrimaryQueryChange,
  onSecondaryQueryChange,
  renderEditorTabStrip,
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
  const activeQuery =
    activeEditorGroup === "secondary" ? secondaryQuery : primaryQuery;

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

  const renderContextCommand = (command: EditorContextCommand) => {
    const label =
      command.commandId === "query.run" ? runPrimaryLabel : command.label;
    const shortcut =
      command.commandId === "query.run" ? runShortcutLabel : null;
    return (
      <button
        type="button"
        role="menuitem"
        key={command.commandId}
        onClick={() => runContextCommand(command.commandId)}
      >
        <span>{label}</span>
        {shortcut ? <kbd>{shortcut}</kbd> : null}
      </button>
    );
  };

  const revealMetadataUsage = (selection: EditorSelection) => {
    const primary = editorApiRef.current;
    const secondary = secondaryEditorApiRef.current;
    const active =
      activeEditorGroup === "secondary"
        ? (secondary ?? primary)
        : (primary ?? secondary);
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
    <>
      <div className="query-toolbar">
        <div className="query-toolbar-spacer" aria-hidden="true" />
        <div
          className="editor-action-dock"
          role="toolbar"
          aria-label="SQL query actions"
        >
          <EditorCommandBar
            formatter={formatter}
            editorSplitOpen={editorSplitOpen}
            editorSplitMode={editorSplitMode}
            setEditorSplitMode={setEditorSplitMode}
            running={running}
            runCommand={runCommand}
            cancelQuery={cancelQuery}
          />
          <RunControl
            running={running}
            runControlRef={runControlRef}
            runMenuOpen={runMenuOpen}
            setRunMenuOpen={setRunMenuOpen}
            runPrimaryLabel={runPrimaryLabel}
            runShortcutLabel={runShortcutLabel}
            runCurrentShortcutLabel={runCurrentShortcutLabel}
            runFromStartShortcutLabel={runFromStartShortcutLabel}
            runAllShortcutLabel={runAllShortcutLabel}
            hasSelectedEditorSql={hasSelectedEditorSql}
            saveCurrentQuery={saveCurrentQuery}
            runQuery={runQuery}
            runSelectionQuery={runSelectionQuery}
            runCurrentQuery={runCurrentQuery}
            runFromStartQuery={runFromStartQuery}
            runAllQuery={runAllQuery}
          />
        </div>
      </div>
      <section
        className={`editor-pane${sqlFileDragOver ? " sql-file-drag-over" : ""}`}
        data-drop-label={sqlFileDropLabel}
        aria-label={activeTabLabel}
        onDragEnter={handleSqlFileDragEnter}
        onDragOver={handleSqlFileDragOver}
        onDragLeave={handleSqlFileDragLeave}
        onDrop={handleSqlFileDrop}
      >
        <div
          ref={editorSplitRef}
          className={`editor-split editor-split-${editorSplitMode}`}
        >
          <EditorGroupShell
            group="primary"
            active={activeEditorGroup === "primary"}
            query={primaryQuery}
            apiRef={editorApiRef}
            formatter={formatter}
            editorEngine={editorEngine}
            activeMetadata={activeMetadata}
            sqlSnippets={sqlSnippets}
            editorBackgroundStyle={editorBackgroundStyle}
            theme={theme}
            vimMode={vimMode}
            sqlLinter={sqlLinter}
            renderEditorTabStrip={renderEditorTabStrip}
            onQueryChange={onPrimaryQueryChange}
            setActiveEditorGroup={setActiveEditorGroup}
            setEditorSelection={setEditorSelection}
            onContextMenu={openEditorContextMenu}
            onMetadataJump={onMetadataJump}
            onMetadataToolWindow={setMetadataToolWindow}
          />
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
              <EditorGroupShell
                group="secondary"
                active={activeEditorGroup === "secondary"}
                query={secondaryQuery}
                apiRef={secondaryEditorApiRef}
                formatter={formatter}
                editorEngine={editorEngine}
                activeMetadata={activeMetadata}
                sqlSnippets={sqlSnippets}
                editorBackgroundStyle={editorBackgroundStyle}
                theme={theme}
                vimMode={vimMode}
                sqlLinter={sqlLinter}
                renderEditorTabStrip={renderEditorTabStrip}
                onQueryChange={onSecondaryQueryChange}
                setActiveEditorGroup={setActiveEditorGroup}
                setEditorSelection={setEditorSelection}
                onContextMenu={openEditorContextMenu}
                onMetadataJump={onMetadataJump}
                onMetadataToolWindow={setMetadataToolWindow}
              />
            </>
          ) : null}
        </div>
        {metadataToolWindow ? (
          <MetadataToolWindow
            request={metadataToolWindow}
            query={activeQuery}
            onClose={() => setMetadataToolWindow(null)}
            onEdit={() => {
              onMetadataJump?.(metadataToolWindow.target);
              setMetadataToolWindow(null);
            }}
            onRevealUsage={revealMetadataUsage}
          />
        ) : null}
        {contextMenu ? (
          <div
            className="app-menu-popover editor-context-menu"
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {editorContextCommandGroups.map((group, index) => (
              <Fragment key={index}>
                {index > 0 ? (
                  <span className="menu-separator" aria-hidden="true" />
                ) : null}
                {group.map(renderContextCommand)}
              </Fragment>
            ))}
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
    </>
  );
}
