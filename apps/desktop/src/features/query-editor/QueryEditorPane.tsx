import {
  useCallback,
  useRef,
  useState,
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
import type { EditorSplitMode } from "@/lib/editor-split-mode";
import { EditorCommandBar } from "./EditorCommandBar";
import { EditorContextMenu } from "./EditorContextMenu";
import { editorShellBackgroundStyle } from "./EditorGroupShell";
import { EditorSplitLayout } from "./EditorSplitLayout";
import { MetadataToolWindow } from "./MetadataToolWindow";
import { RunControl } from "./RunControl";
import { useSqlFileDrop } from "./sql-file-drop";
import type {
  EditorGroup,
  EditorSelection,
  EditorSelections,
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
  const runControlRef = useRef<HTMLDivElement | null>(null);
  const editorBackgroundStyle = editorShellBackgroundStyle(
    editorBackgroundImage,
    editorBackgroundOpacity,
  );
  const activeQuery =
    activeEditorGroup === "secondary" ? secondaryQuery : primaryQuery;
  const { sqlFileDragOver, sqlFileDropHandlers } = useSqlFileDrop({
    onSqlFileDrop,
    onUnsupportedFileDrop,
  });

  const openEditorContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, group: EditorGroup) => {
      event.preventDefault();
      event.stopPropagation();
      setActiveEditorGroup(group);
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    [setActiveEditorGroup],
  );

  const closeEditorContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const runContextCommand = useCallback(
    (commandId: string) => {
      setContextMenu(null);
      runCommand(commandId);
    },
    [runCommand],
  );

  const revealMetadataUsage = (selection: EditorSelection) => {
    const primary = editorApiRef.current;
    const secondary = secondaryEditorApiRef.current;
    const active =
      activeEditorGroup === "secondary"
        ? (secondary ?? primary)
        : (primary ?? secondary);
    active?.revealRange(selection);
  };

  return (
    <>
      <section
        className={`editor-pane${sqlFileDragOver ? " sql-file-drag-over" : ""}`}
        data-drop-label={sqlFileDropLabel}
        aria-label={activeTabLabel}
        {...sqlFileDropHandlers}
      >
        <EditorSplitLayout
          editorSplitRef={editorSplitRef}
          editorSplitOpen={editorSplitOpen}
          editorSplitMode={editorSplitMode}
          activeEditorGroup={activeEditorGroup}
          primary={{
            query: primaryQuery,
            apiRef: editorApiRef,
            onQueryChange: onPrimaryQueryChange,
          }}
          secondary={{
            query: secondaryQuery,
            apiRef: secondaryEditorApiRef,
            onQueryChange: onSecondaryQueryChange,
          }}
          formatter={formatter}
          editorEngine={editorEngine}
          activeMetadata={activeMetadata}
          sqlSnippets={sqlSnippets}
          editorBackgroundStyle={editorBackgroundStyle}
          theme={theme}
          vimMode={vimMode}
          sqlLinter={sqlLinter}
          renderEditorTabStrip={renderEditorTabStrip}
          setActiveEditorGroup={setActiveEditorGroup}
          setEditorSelection={setEditorSelection}
          onEditorContextMenu={openEditorContextMenu}
          onMetadataJump={onMetadataJump}
          onMetadataToolWindow={setMetadataToolWindow}
          beginEditorSplitResize={beginEditorSplitResize}
          onEditorSplitResizeKey={onEditorSplitResizeKey}
        />
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
          <EditorContextMenu
            position={contextMenu}
            runPrimaryLabel={runPrimaryLabel}
            runShortcutLabel={runShortcutLabel}
            resultActionsAvailable={resultActionsAvailable}
            onCommand={runContextCommand}
            onClose={closeEditorContextMenu}
          />
        ) : null}
      </section>
      {/* TablePlus-style: the save/run controls live at the bottom-right of
          the editor pane, next to where results appear. */}
      <div className="query-toolbar query-toolbar-bottom">
        <div className="query-toolbar-spacer" aria-hidden="true" />
        <div
          className="editor-action-dock"
          role="toolbar"
          aria-label="SQL query actions"
        >
          <EditorCommandBar
            formatter={formatter}
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
            runQuery={runQuery}
            runSelectionQuery={runSelectionQuery}
            runCurrentQuery={runCurrentQuery}
            runFromStartQuery={runFromStartQuery}
            runAllQuery={runAllQuery}
          />
        </div>
      </div>
    </>
  );
}
