import { useEffect, useMemo, useState } from "react";
import {
  commandHasConflict,
  defaultVimKeybindingResolutions,
  formatKeySequence,
  vimModeClipboardShortcuts,
  type CommandMeta,
  type Keymap,
  type KeymapConflicts,
  type VimKeybindingConflict,
  type VimKeybindingConflictResolution,
  type VimKeybindingConflictResolutions,
} from "@/core/keybindings";
import type { TranslateFn } from "./shared";

export interface KeymapTabProps {
  t: TranslateFn;
  commandCatalog: CommandMeta[];
  keymap: Keymap;
  keymapOverrides: Keymap;
  keymapConflicts: KeymapConflicts;
  vimMode: boolean;
  vimKeymapConflicts: VimKeybindingConflict[];
  recordingCommand: string | null;
  recordingSequence: string[];
  runCommand: (commandId: string) => void;
  beginRecording: (commandId: string) => void;
  resetKeybinding: (commandId: string) => void;
  applyVimKeybindingResolutions: (
    resolutions: VimKeybindingConflictResolutions,
  ) => void;
}

export function KeymapTab({
  t,
  commandCatalog,
  keymap,
  keymapOverrides,
  keymapConflicts,
  vimMode,
  vimKeymapConflicts,
  recordingCommand,
  recordingSequence,
  runCommand,
  beginRecording,
  resetKeybinding,
  applyVimKeybindingResolutions,
}: KeymapTabProps) {
  const commandById = useMemo(
    () => new Map(commandCatalog.map((command) => [command.id, command])),
    [commandCatalog],
  );
  const conflictSignature = vimKeymapConflicts
    .map(
      (conflict) =>
        `${conflict.commandId}:${conflict.sequence}:${conflict.suggestedSequence ?? ""}`,
    )
    .join("|");
  const [vimResolutions, setVimResolutions] =
    useState<VimKeybindingConflictResolutions>(() =>
      defaultVimKeybindingResolutions(vimKeymapConflicts),
    );

  useEffect(() => {
    setVimResolutions(defaultVimKeybindingResolutions(vimKeymapConflicts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictSignature]);

  function chooseVimResolution(
    commandId: string,
    resolution: VimKeybindingConflictResolution,
  ) {
    setVimResolutions((current) => ({ ...current, [commandId]: resolution }));
  }

  function applyRecommendedVimResolutions() {
    const resolutions = defaultVimKeybindingResolutions(vimKeymapConflicts);
    setVimResolutions(resolutions);
    applyVimKeybindingResolutions(resolutions);
  }

  return (
    <div className="settings-stack">
      {vimMode ? (
        <section className="vim-keymap-panel" aria-label={t("settings.keymap.vim.title")}>
          <div className="vim-keymap-header">
            <span>
              <strong>{t("settings.keymap.vim.title")}</strong>
              <small>
                {t("settings.keymap.vim.clipboard", {
                  copy: formatKeySequence(vimModeClipboardShortcuts.copy),
                  paste: formatKeySequence(vimModeClipboardShortcuts.paste),
                })}
              </small>
            </span>
            {vimKeymapConflicts.length > 0 ? (
              <button
                className="text-button"
                type="button"
                onClick={applyRecommendedVimResolutions}
              >
                {t("settings.keymap.vim.applyRecommended")}
              </button>
            ) : null}
          </div>
          {vimKeymapConflicts.length > 0 ? (
            <>
              <div className="vim-keymap-conflicts">
                {vimKeymapConflicts.map((conflict) => {
                  const command = commandById.get(conflict.commandId);
                  const resolution =
                    vimResolutions[conflict.commandId] ??
                    (conflict.suggestedSequence ? "suggested" : "keep");
                  return (
                    <div className="vim-keymap-conflict" key={conflict.commandId}>
                      <span className="vim-keymap-command">
                        <strong>{command?.title ?? conflict.commandId}</strong>
                        <small>
                          {formatKeySequence(conflict.sequence)} · {conflict.vimUse}
                        </small>
                      </span>
                      <select
                        value={resolution}
                        onChange={(event) =>
                          chooseVimResolution(
                            conflict.commandId,
                            event.currentTarget
                              .value as VimKeybindingConflictResolution,
                          )
                        }
                      >
                        {conflict.suggestedSequence ? (
                          <option value="suggested">
                            {t("settings.keymap.vim.moveTo", {
                              shortcut: formatKeySequence(
                                conflict.suggestedSequence,
                              ),
                            })}
                          </option>
                        ) : null}
                        <option value="unset">
                          {t("settings.keymap.vim.unset")}
                        </option>
                        <option value="keep">
                          {t("settings.keymap.vim.keep")}
                        </option>
                      </select>
                    </div>
                  );
                })}
              </div>
              <div className="vim-keymap-actions">
                <button
                  className="text-button"
                  type="button"
                  onClick={() => applyVimKeybindingResolutions(vimResolutions)}
                >
                  {t("settings.keymap.vim.applySelected")}
                </button>
              </div>
            </>
          ) : (
            <p className="settings-empty">{t("settings.keymap.vim.noConflicts")}</p>
          )}
        </section>
      ) : null}

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
          const overridden = Object.prototype.hasOwnProperty.call(
            keymapOverrides,
            command.id,
          );
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
              {overridden ? (
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
    </div>
  );
}
