import { Square } from "lucide-react";
import type { SqlFormatterId } from "../../sql/formatter";
import { editorToolbarCommands } from "./editor-commands";

type EditorCommandBarProps = {
  formatter: SqlFormatterId;
  running: boolean;
  runCommand: (commandId: string) => void;
  cancelQuery: () => Promise<void>;
};

export function EditorCommandBar({
  formatter,
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
