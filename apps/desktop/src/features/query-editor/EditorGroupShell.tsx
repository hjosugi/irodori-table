import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import SqlEditor, {
  type SqlEditorHandle,
  type SqlMetadataToolWindowRequest,
} from "./SqlEditor";
import { LogFilterBar } from "./LogFilterBar";
import {
  computeLogFilterRanges,
  emptyLogFilter,
  isLogFilterActive,
  splitLogFilterLines,
  type LogFilterSpec,
} from "./editor-log-filter";
import { editorLanguageForTabLabel } from "@/lib/editor-language";
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
  /** Active tab's file-style label; routes the buffer language (EDITOR-178). */
  tabLabel: string;
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
  tabLabel,
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
  const language = editorLanguageForTabLabel(tabLabel);

  // Log filter state (issue #177). It belongs to the shell, not the editor,
  // so the bar and the CodeMirror view share one source of truth. A filter
  // tuned for one file must not silently hide lines in another, so switching
  // tabs resets it (render-time reset keeps the editor and bar in step).
  const [logFilter, setLogFilter] = useState<LogFilterSpec>(emptyLogFilter);
  const lastTabLabel = useRef(tabLabel);
  if (lastTabLabel.current !== tabLabel) {
    lastTabLabel.current = tabLabel;
    if (isLogFilterActive(logFilter)) {
      setLogFilter(emptyLogFilter);
    }
  }
  const logFilterStats = useMemo(() => {
    if (language !== "log" || !isLogFilterActive(logFilter)) {
      return null;
    }
    return computeLogFilterRanges(splitLogFilterLines(query), logFilter);
  }, [language, query, logFilter]);

  const className = `editor-shell editor-group${active ? " active" : ""}${
    editorBackgroundStyle ? " editor-shell-has-background" : ""
  }${language === "log" ? " editor-shell-with-log-filter" : ""}`;

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
      {language === "log" ? (
        <LogFilterBar
          filter={logFilter}
          hiddenLineCount={logFilterStats?.hiddenLineCount ?? 0}
          onFilterChange={setLogFilter}
        />
      ) : null}
      <div className="editor-buffer">
        <SqlEditor
          ref={apiRef}
          value={query}
          tabLabel={tabLabel}
          logFilter={language === "log" ? logFilter : undefined}
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
