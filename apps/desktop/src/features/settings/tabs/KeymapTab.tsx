import {
  commandHasConflict,
  formatKeySequence,
  type CommandMeta,
  type Keymap,
  type KeymapConflicts,
} from "@/core/keybindings";
import type { TranslateFn } from "./shared";

export interface KeymapTabProps {
  t: TranslateFn;
  commandCatalog: CommandMeta[];
  keymap: Keymap;
  keymapOverrides: Keymap;
  keymapConflicts: KeymapConflicts;
  recordingCommand: string | null;
  recordingSequence: string[];
  runCommand: (commandId: string) => void;
  beginRecording: (commandId: string) => void;
  resetKeybinding: (commandId: string) => void;
}

export function KeymapTab({
  t,
  commandCatalog,
  keymap,
  keymapOverrides,
  keymapConflicts,
  recordingCommand,
  recordingSequence,
  runCommand,
  beginRecording,
  resetKeybinding,
}: KeymapTabProps) {
  return (
    <div className="command-list settings-command-list">
      {commandCatalog.map((command) => {
        const chord = keymap[command.id];
        const conflicted = commandHasConflict(
          keymapConflicts,
          command.id,
        );
        const recording = recordingCommand === command.id;
        const recordingLabel =
          recordingSequence.length > 0
            ? `${formatKeySequence(recordingSequence.join(" "))} ...`
            : t("settings.keymap.recordingLabel");
        return (
          <div className="command-item" key={command.id}>
            <button
              className="command-run"
              type="button"
              onClick={() => runCommand(command.id)}
              title={t("settings.keymap.runTitle", {
                title: command.title,
              })}
            >
              {command.title}
            </button>
            <small className={`command-scope ${command.scope}`}>
              {command.scope}
            </small>
            <button
              className={`command-chord${conflicted ? " conflict" : ""}`}
              type="button"
              title={
                recording
                  ? t("settings.keymap.recordingTitle")
                  : conflicted
                    ? t("settings.keymap.conflictTitle")
                    : t("settings.keymap.rebindTitle")
              }
              onClick={() => beginRecording(command.id)}
            >
              {recording
                ? recordingLabel
                : chord
                  ? formatKeySequence(chord)
                  : t("settings.keymap.unset")}
            </button>
            {keymapOverrides[command.id] ? (
              <button
                className="command-reset"
                type="button"
                title={t("settings.keymap.resetTitle")}
                onClick={() => resetKeybinding(command.id)}
              >
                {t("common.reset")}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
