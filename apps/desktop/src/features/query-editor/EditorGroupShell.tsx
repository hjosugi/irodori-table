import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from "react";
import SqlEditor, {
  type SqlEditorHandle,
  type SqlMetadataToolWindowRequest,
} from "./SqlEditor";
import type { DatabaseMetadata, DbEngine } from "../../generated/irodori-api";
import type { SqlSnippetDefinition } from "../../sql/completion";
import type { SqlFormatterId } from "../../sql/formatter";
import type { SqlLinterId } from "../../sql/linter";
import type { SqlMetadataTarget } from "../../sql/metadata-inspection";
import type { IrodoriTheme } from "@/theme";
import type { EditorGroup, EditorSelections } from "./query-editor-pane-types";

export type EditorGroupShellProps = {
  group: EditorGroup;
  active: boolean;
  query: string;
  apiRef: RefObject<SqlEditorHandle | null>;
  formatter: SqlFormatterId;
  editorEngine: DbEngine;
  activeMetadata?: DatabaseMetadata;
  sqlSnippets: readonly SqlSnippetDefinition[];
  editorBackgroundStyle: CSSProperties | undefined;
  theme: IrodoriTheme;
  vimMode: boolean;
  sqlLinter: SqlLinterId;
  renderEditorTabStrip: (group: EditorGroup) => ReactNode;
  onQueryChange: (next: string) => void;
  setActiveEditorGroup: (group: EditorGroup) => void;
  setEditorSelection: (group: EditorGroup, selection: EditorSelections) => void;
  onContextMenu: (
    event: ReactMouseEvent<HTMLDivElement>,
    group: EditorGroup,
  ) => void;
  onMetadataJump?: (target: SqlMetadataTarget) => void;
  onMetadataToolWindow: (request: SqlMetadataToolWindowRequest) => void;
};

export function EditorGroupShell({
  group,
  active,
  query,
  apiRef,
  formatter,
  editorEngine,
  activeMetadata,
  sqlSnippets,
  editorBackgroundStyle,
  theme,
  vimMode,
  sqlLinter,
  renderEditorTabStrip,
  onQueryChange,
  setActiveEditorGroup,
  setEditorSelection,
  onContextMenu,
  onMetadataJump,
  onMetadataToolWindow,
}: EditorGroupShellProps) {
  const className = `editor-shell editor-group${active ? " active" : ""}${
    editorBackgroundStyle ? " editor-shell-has-background" : ""
  }`;

  return (
    <div
      className={className}
      style={editorBackgroundStyle}
      onFocusCapture={() => setActiveEditorGroup(group)}
      onPointerDown={() => setActiveEditorGroup(group)}
      onContextMenu={(event) => onContextMenu(event, group)}
    >
      {editorBackgroundStyle ? (
        <div className="editor-background-image" aria-hidden="true" />
      ) : null}
      {renderEditorTabStrip(group)}
      <div className="editor-buffer">
        <SqlEditor
          ref={apiRef}
          value={query}
          onChange={onQueryChange}
          onSelectionChange={(selection) => {
            setActiveEditorGroup(group);
            setEditorSelection(group, selection);
          }}
          engine={editorEngine}
          metadata={activeMetadata}
          snippets={sqlSnippets}
          theme={theme}
          vimMode={vimMode}
          formatter={formatter}
          linter={sqlLinter}
          onMetadataJump={onMetadataJump}
          onMetadataToolWindow={onMetadataToolWindow}
        />
      </div>
    </div>
  );
}

export function editorShellBackgroundStyle(
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
