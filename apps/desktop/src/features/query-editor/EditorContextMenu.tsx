import { Fragment, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // The menu is portaled outside the React root, so a pointerdown inside it no
    // longer stops propagation to this window listener; guard with the ref
    // instead so clicking a menu item does not close before its click fires.
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      onClose();
    };
    const close = () => onClose();

    window.addEventListener("pointerdown", closeOnOutsidePointerDown);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointerDown);
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

  // Rendered through a portal to document.body: the editor lives inside a
  // dockview panel whose ancestors set `transform`/`contain`, which would
  // otherwise become the containing block for this `position: fixed` menu and
  // offset it from the pointer.
  return createPortal(
    <div
      ref={menuRef}
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
    </div>,
    document.body,
  );
}
