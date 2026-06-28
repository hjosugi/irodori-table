import {
  PanelBottomClose,
  PanelRightClose,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Square,
} from "lucide-react";
import type { ReactNode } from "react";
import type { SqlFormatterId } from "../../sql/formatter";
import { editorToolbarCommands } from "./editor-commands";
import type {
  EditorSplitControlsProps,
  EditorSplitModeUpdater,
} from "./query-editor-pane-types";
import type { EditorSplitMode } from "../workbench";

type EditorCommandBarProps = EditorSplitControlsProps & {
  formatter: SqlFormatterId;
  running: boolean;
  runCommand: (commandId: string) => void;
  cancelQuery: () => Promise<void>;
};

export function EditorCommandBar({
  formatter,
  editorSplitOpen,
  editorSplitMode,
  setEditorSplitMode,
  running,
  runCommand,
  cancelQuery,
}: EditorCommandBarProps) {
  return (
    <div className="editor-command-bar">
      {editorToolbarCommands.map((command) => {
        const Icon = command.icon;
        const title =
          command.commandId === "editor.format"
            ? `${command.title} (${formatter})`
            : command.title;
        return (
          <button
            className="icon-button editor-toolbar-button"
            type="button"
            title={title}
            aria-label={command.ariaLabel}
            key={command.commandId}
            onClick={() => runCommand(command.commandId)}
          >
            <Icon size={15} />
            <span>{command.label}</span>
          </button>
        );
      })}
      <EditorSplitControls
        editorSplitOpen={editorSplitOpen}
        editorSplitMode={editorSplitMode}
        setEditorSplitMode={setEditorSplitMode}
      />
      <button
        className="icon-button editor-toolbar-button"
        type="button"
        title="Cancel query"
        aria-label="Cancel query"
        disabled={!running}
        onClick={() => void cancelQuery()}
      >
        <Square size={15} />
        <span>Cancel</span>
      </button>
    </div>
  );
}

function EditorSplitControls({
  editorSplitOpen,
  editorSplitMode,
  setEditorSplitMode,
}: EditorSplitControlsProps) {
  return (
    <div
      className="editor-split-controls"
      role="group"
      aria-label="Editor layout"
    >
      <EditorSplitButton
        active={editorSplitMode === "right"}
        title="Split editor right"
        ariaLabel="Split editor right"
        onClick={() => setEditorSplitMode("right")}
      >
        <SplitSquareHorizontal size={15} />
        <span>Split R</span>
      </EditorSplitButton>
      <EditorSplitButton
        active={editorSplitMode === "down"}
        title="Split editor down"
        ariaLabel="Split editor down"
        onClick={() => setEditorSplitMode("down")}
      >
        <SplitSquareVertical size={15} />
        <span>Split D</span>
      </EditorSplitButton>
      {editorSplitOpen ? (
        <button
          className="icon-button editor-toolbar-button"
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
          <span>Close</span>
        </button>
      ) : null}
    </div>
  );
}

function EditorSplitButton({
  active,
  title,
  ariaLabel,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  ariaLabel: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={
        active
          ? "icon-button editor-toolbar-button active"
          : "icon-button editor-toolbar-button"
      }
      type="button"
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export type { EditorSplitMode, EditorSplitModeUpdater };
