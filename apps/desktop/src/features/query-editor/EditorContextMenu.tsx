import { Fragment, useEffect } from "react";
import {
  editorContextCommandGroups,
  type EditorContextCommand,
} from "./editor-commands";

export type EditorContextMenuPosition = {
  x: number;
  y: number;
};

export type EditorContextMenuProps = {
  position: EditorContextMenuPosition;
  runPrimaryLabel: string;
  runShortcutLabel: string;
  resultActionsAvailable: boolean;
  onCommand: (commandId: string) => void;
  onClose: () => void;
};

export function EditorContextMenu({
  position,
  runPrimaryLabel,
  runShortcutLabel,
  resultActionsAvailable,
  onCommand,
  onClose,
}: EditorContextMenuProps) {
  useEffect(() => {
    const close = () => onClose();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      onClose();
    };

    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

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
        onClick={() => onCommand(command.commandId)}
      >
        <span>{label}</span>
        {shortcut ? <kbd>{shortcut}</kbd> : null}
      </button>
    );
  };

  return (
    <div
      className="app-menu-popover editor-context-menu"
      role="menu"
      style={{ left: position.x, top: position.y }}
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
        onClick={() => onCommand("result.copySqlInserts")}
      >
        <span>Copy result as INSERT SQL</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!resultActionsAvailable}
        onClick={() => onCommand("result.exportSqlInserts")}
      >
        <span>Download result as INSERT SQL</span>
      </button>
    </div>
  );
}
