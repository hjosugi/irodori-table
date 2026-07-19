import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import type {
  SqlEditorHandle,
  SqlMetadataToolWindowRequest,
} from "./SqlEditor";
import { EditorGroupShell } from "./EditorGroupShell";
import type { DatabaseMetadata, DbEngine } from "../../generated/irodori-api";
import type { SqlSnippetDefinition } from "../../sql/completion";
import type { SqlFormatterId } from "../../sql/formatter";
import type { SqlLinterId } from "../../sql/linter";
import type { SqlMetadataTarget } from "../../sql/metadata-inspection";
import type { IrodoriTheme } from "@/theme";
import type { EditorSplitMode } from "@/lib/editor-split-mode";
import type { EditorGroup, EditorSelections } from "./query-editor-pane-types";

type EditorGroupState = {
  query: string;
  /** Active tab's file-style label; routes the buffer language (EDITOR-178). */
  tabLabel: string;
  apiRef: RefObject<SqlEditorHandle | null>;
  onQueryChange: (next: string) => void;
};

export type EditorContextMenuHandler = (
  event: ReactMouseEvent<HTMLDivElement>,
  group: EditorGroup,
) => void;

export type EditorSplitLayoutProps = {
  editorSplitRef: RefObject<HTMLDivElement | null>;
  editorSplitOpen: boolean;
  editorSplitMode: EditorSplitMode;
  activeEditorGroup: EditorGroup;
  primary: EditorGroupState;
  secondary: EditorGroupState;
  formatter: SqlFormatterId;
  editorEngine: DbEngine;
  activeMetadata?: DatabaseMetadata;
  sqlSnippets: readonly SqlSnippetDefinition[];
  editorBackgroundStyle: CSSProperties | undefined;
  theme: IrodoriTheme;
  vimMode: boolean;
  sqlLinter: SqlLinterId;
  renderEditorTabStrip: (group: EditorGroup) => ReactNode;
  setActiveEditorGroup: (group: EditorGroup) => void;
  setEditorSelection: (group: EditorGroup, selection: EditorSelections) => void;
  onEditorContextMenu: EditorContextMenuHandler;
  onMetadataJump?: (target: SqlMetadataTarget) => void;
  onMetadataToolWindow: (request: SqlMetadataToolWindowRequest) => void;
  beginEditorSplitResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEditorSplitResizeKey: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};

export function EditorSplitLayout({
  editorSplitRef,
  editorSplitOpen,
  editorSplitMode,
  activeEditorGroup,
  primary,
  secondary,
  formatter,
  editorEngine,
  activeMetadata,
  sqlSnippets,
  editorBackgroundStyle,
  theme,
  vimMode,
  sqlLinter,
  renderEditorTabStrip,
  setActiveEditorGroup,
  setEditorSelection,
  onEditorContextMenu,
  onMetadataJump,
  onMetadataToolWindow,
  beginEditorSplitResize,
  onEditorSplitResizeKey,
}: EditorSplitLayoutProps) {
  const renderEditorGroup = (group: EditorGroup, state: EditorGroupState) => (
    <EditorGroupShell
      group={group}
      active={activeEditorGroup === group}
      query={state.query}
      tabLabel={state.tabLabel}
      apiRef={state.apiRef}
      formatter={formatter}
      editorEngine={editorEngine}
      activeMetadata={activeMetadata}
      sqlSnippets={sqlSnippets}
      editorBackgroundStyle={editorBackgroundStyle}
      theme={theme}
      vimMode={vimMode}
      sqlLinter={sqlLinter}
      renderEditorTabStrip={renderEditorTabStrip}
      onQueryChange={state.onQueryChange}
      setActiveEditorGroup={setActiveEditorGroup}
      setEditorSelection={setEditorSelection}
      onContextMenu={onEditorContextMenu}
      onMetadataJump={onMetadataJump}
      onMetadataToolWindow={onMetadataToolWindow}
    />
  );

  return (
    <div
      ref={editorSplitRef}
      className={`editor-split editor-split-${editorSplitMode}`}
    >
      {renderEditorGroup("primary", primary)}
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
          {renderEditorGroup("secondary", secondary)}
        </>
      ) : null}
    </div>
  );
}
