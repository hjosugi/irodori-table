import { useEffect, useRef, useState } from "react";
import { appCommandCatalog, resultCopyDefaultKeymap } from "@/app/app-config";
import {
  KEY_SEQUENCE_TIMEOUT_MS,
  applyVimKeybindingResolutions as applyVimKeybindingResolutionOverrides,
  effectiveKeymap,
  eventToChord,
  findConflicts,
  findVimKeybindingConflicts,
  loadOverrides,
  resolveKeybinding,
  saveOverrides,
  type KeybindingScope,
  type Keymap,
  type VimKeybindingConflictResolutions,
} from "@/core";
import type { ShowActionNotice } from "@/app/ActionToast";
import type { Translator } from "@/i18n";
import {
  isCellEditorClipboardShortcut,
  keyScopeFromTarget,
} from "@/app/app-workbench-utils";

type KeybindingManagerDeps = {
  // Read through refs inside the stable keydown listener, so the latest render's
  // command handler and overlay state are always used.
  runCommand: (commandId: string) => void;
  // Returns true when an open transient overlay consumed the Escape press.
  closeTransientOverlays: () => boolean;
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

// Remappable keybindings: defaults merged with user overrides (localStorage),
// chord-sequence resolution on a window-level listener, rebind recording for
// the Settings keymap tab, and Vim-conflict resolution plans.
export function useKeybindingManager({
  runCommand,
  closeTransientOverlays,
  showActionNotice,
  t,
}: KeybindingManagerDeps) {
  const [keymapOverrides, setKeymapOverrides] = useState<Keymap>(loadOverrides);
  const keymap = {
    ...resultCopyDefaultKeymap,
    ...effectiveKeymap(keymapOverrides),
  };
  const [activeKeyScope, setActiveKeyScope] =
    useState<KeybindingScope>("global");
  const [recordingCommand, setRecordingCommand] = useState<string | null>(null);
  const [recordingSequence, setRecordingSequence] = useState<string[]>([]);

  // Keep the keydown listener stable while reading the latest state via refs.
  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;
  const closeTransientOverlaysRef = useRef(closeTransientOverlays);
  closeTransientOverlaysRef.current = closeTransientOverlays;
  const activeKeyScopeRef = useRef(activeKeyScope);
  activeKeyScopeRef.current = activeKeyScope;
  const recordingRef = useRef(recordingCommand);
  recordingRef.current = recordingCommand;
  const pendingKeySequenceRef = useRef<string[]>([]);
  const pendingKeyTimerRef = useRef<number | null>(null);
  const recordingSequenceRef = useRef<string[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  function clearPendingKeySequence() {
    pendingKeySequenceRef.current = [];
    if (pendingKeyTimerRef.current !== null) {
      window.clearTimeout(pendingKeyTimerRef.current);
      pendingKeyTimerRef.current = null;
    }
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function cancelRecording() {
    clearRecordingTimer();
    recordingRef.current = null;
    recordingSequenceRef.current = [];
    setRecordingCommand(null);
    setRecordingSequence([]);
  }

  function commitRecordedKeybinding(
    commandId: string,
    sequence: readonly string[],
  ) {
    const chord = sequence.join(" ");
    if (!chord) {
      cancelRecording();
      return;
    }
    clearRecordingTimer();
    setKeymapOverrides((prev) => {
      const next = { ...prev, [commandId]: chord };
      saveOverrides(next);
      return next;
    });
    recordingRef.current = null;
    recordingSequenceRef.current = [];
    setRecordingCommand(null);
    setRecordingSequence([]);
  }

  function beginRecording(commandId: string) {
    if (recordingRef.current === commandId) {
      cancelRecording();
      return;
    }
    clearRecordingTimer();
    recordingRef.current = commandId;
    recordingSequenceRef.current = [];
    setRecordingCommand(commandId);
    setRecordingSequence([]);
  }

  function resetKeybinding(commandId: string) {
    if (recordingRef.current === commandId) {
      cancelRecording();
    }
    setKeymapOverrides((prev) => {
      const next = { ...prev };
      delete next[commandId];
      saveOverrides(next);
      return next;
    });
  }

  // Replace the full override set (settings JSON import).
  function replaceKeymapOverrides(next: Keymap) {
    setKeymapOverrides(next);
    saveOverrides(next);
  }

  function applyVimKeybindingPlan(
    resolutions: VimKeybindingConflictResolutions,
  ) {
    cancelRecording();
    setKeymapOverrides((prev) => {
      const currentKeymap = {
        ...resultCopyDefaultKeymap,
        ...effectiveKeymap(prev),
      };
      const conflicts = findVimKeybindingConflicts(
        currentKeymap,
        appCommandCatalog,
      );
      const next = applyVimKeybindingResolutionOverrides(
        prev,
        conflicts,
        resolutions,
      );
      saveOverrides(next);
      return next;
    });
    showActionNotice(
      "success",
      t("notice.workbench.vimShortcutsUpdated"),
      t("notice.workbench.vimShortcutsUpdatedDetail"),
    );
  }

  function syncScopeFromTarget(
    target: EventTarget | null,
    fallback: KeybindingScope,
  ) {
    const scope = keyScopeFromTarget(target, fallback);
    activeKeyScopeRef.current = scope;
    setActiveKeyScope(scope);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Recording a rebind: one or two non-modifier chords become the new sequence.
      const recording = recordingRef.current;
      if (recording) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelRecording();
          return;
        }
        const chord = eventToChord(event);
        if (!chord) {
          return;
        }
        event.preventDefault();
        clearRecordingTimer();
        const next = [...recordingSequenceRef.current, chord];
        recordingSequenceRef.current = next;
        setRecordingSequence(next);
        if (next.length >= 2) {
          commitRecordedKeybinding(recording, next);
        } else {
          recordingTimerRef.current = window.setTimeout(() => {
            commitRecordedKeybinding(recording, recordingSequenceRef.current);
          }, KEY_SEQUENCE_TIMEOUT_MS);
        }
        return;
      }
      if (event.key === "Escape" && closeTransientOverlaysRef.current()) {
        event.preventDefault();
        event.stopPropagation();
        clearPendingKeySequence();
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing && isCellEditorClipboardShortcut(event, target)) {
        return;
      }
      const scope = keyScopeFromTarget(target, activeKeyScopeRef.current);
      if (scope !== activeKeyScopeRef.current) {
        activeKeyScopeRef.current = scope;
        setActiveKeyScope(scope);
      }
      const chord = eventToChord(event);
      if (!chord) {
        return;
      }
      const map = keymapRef.current;
      const hadPending = pendingKeySequenceRef.current.length > 0;
      const resolution = resolveKeybinding({
        keymap: map,
        scope,
        chord,
        pending: pendingKeySequenceRef.current,
        commands: appCommandCatalog,
        allowBare: !typing,
      });
      if (resolution.kind === "pending") {
        event.preventDefault();
        pendingKeySequenceRef.current = resolution.pending;
        if (pendingKeyTimerRef.current !== null) {
          window.clearTimeout(pendingKeyTimerRef.current);
        }
        pendingKeyTimerRef.current = window.setTimeout(
          clearPendingKeySequence,
          KEY_SEQUENCE_TIMEOUT_MS,
        );
        return;
      }
      clearPendingKeySequence();
      if (resolution.kind === "command") {
        event.preventDefault();
        runCommandRef.current(resolution.commandId);
        return;
      }
      if (hadPending) {
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearPendingKeySequence();
      clearRecordingTimer();
    };
  }, []);

  const keymapConflicts = findConflicts(keymap, appCommandCatalog);
  const vimKeymapConflicts = findVimKeybindingConflicts(
    keymap,
    appCommandCatalog,
  );

  return {
    keymap,
    keymapOverrides,
    replaceKeymapOverrides,
    activeKeyScope,
    syncScopeFromTarget,
    recordingCommand,
    recordingSequence,
    beginRecording,
    resetKeybinding,
    applyVimKeybindingPlan,
    keymapConflicts,
    vimKeymapConflicts,
  };
}

export type KeybindingManager = ReturnType<typeof useKeybindingManager>;
