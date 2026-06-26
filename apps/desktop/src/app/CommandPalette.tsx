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
  return (
    <div className="palette-overlay" onClick={onClose} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          className="palette-input"
          autoFocus
          placeholder="Type a command..."
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onClose();
            } else if (event.key === "Enter") {
              const first = commands[0];
              if (first) {
                onClose();
                onRunCommand(first.id);
              }
            }
          }}
        />
        <div className="palette-list">
          {commands.length > 0 ? (
            commands.map((command) => (
              <button
                key={command.id}
                className="palette-item"
                type="button"
                onClick={() => {
                  onClose();
                  onRunCommand(command.id);
                }}
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
      </div>
    </div>
  );
}
