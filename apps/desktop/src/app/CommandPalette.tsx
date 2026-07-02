import { useEffect, useMemo, useRef, useState } from "react";
import { DialogShell } from "@/components/DialogShell";
import type { CommandMeta, Keymap } from "@/core/keybindings";
import { formatKeySequence } from "@/core/keybindings";

export function CommandPalette({
  query,
  commands,
  keymap,
  onQueryChange,
  onRunCommand,
  onClose,
}: {
  query: string;
  commands: CommandMeta[];
  keymap: Keymap;
  onQueryChange: (query: string) => void;
  onRunCommand: (commandId: string) => void;
  onClose: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Clamp the highlight as the filtered list shrinks/grows with the query.
  const highlightedIndex = Math.min(
    activeIndex,
    Math.max(0, commands.length - 1),
  );
  const activeCommand = commands[highlightedIndex];
  const activeOptionId = useMemo(
    () => (activeCommand ? `palette-option-${activeCommand.id}` : undefined),
    [activeCommand],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!activeOptionId) {
      return;
    }
    listRef.current
      ?.querySelector(`[id="${CSS.escape(activeOptionId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);

  function runCommand(command: CommandMeta | undefined) {
    if (!command) {
      return;
    }
    onClose();
    onRunCommand(command.id);
  }

  return (
    <DialogShell
      onClose={onClose}
      className="palette"
      overlayClassName="palette-overlay"
      label="Command palette"
    >
      <input
        className="palette-input"
        autoFocus
        placeholder="Type a command..."
        value={query}
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-command-list"
        aria-activedescendant={activeOptionId}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) =>
              Math.min(index + 1, Math.max(0, commands.length - 1)),
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Home" && !query) {
            event.preventDefault();
            setActiveIndex(0);
          } else if (event.key === "End" && !query) {
            event.preventDefault();
            setActiveIndex(Math.max(0, commands.length - 1));
          } else if (event.key === "Enter") {
            runCommand(commands[highlightedIndex]);
          }
        }}
      />
      <div
        className="palette-list"
        id="palette-command-list"
        role="listbox"
        aria-label="Commands"
        ref={listRef}
      >
        {commands.length > 0 ? (
          commands.map((command, index) => (
            <button
              key={command.id}
              id={`palette-option-${command.id}`}
              className={`palette-item${
                index === highlightedIndex ? " active" : ""
              }`}
              type="button"
              role="option"
              aria-selected={index === highlightedIndex}
              tabIndex={-1}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runCommand(command)}
            >
              <span>{command.title}</span>
              <small>{command.category}</small>
              {keymap[command.id] ? (
                <kbd>{formatKeySequence(keymap[command.id])}</kbd>
              ) : null}
            </button>
          ))
        ) : (
          <div className="palette-empty">No matching commands</div>
        )}
      </div>
    </DialogShell>
  );
}
