import { describe, expect, it } from "vitest";
import {
  canonicalKeySequence,
  commandHasConflict,
  defaultKeymap,
  findConflicts,
  formatKeySequence,
  resolveKeybinding,
  type Keymap,
} from "@/keybindings";
import { appCommandCatalog } from "@/app/app-config";

describe("keybinding resolver", () => {
  it("resolves global commands everywhere and scoped commands only in scope", () => {
    expect(
      resolveKeybinding({
        keymap: defaultKeymap,
        scope: "editor",
        chord: "Mod+Enter",
      }),
    ).toMatchObject({ kind: "command", commandId: "query.run" });

    expect(
      resolveKeybinding({
        keymap: defaultKeymap,
        scope: "grid",
        chord: "Mod+Enter",
      }),
    ).toMatchObject({ kind: "none" });

    expect(
      resolveKeybinding({
        keymap: defaultKeymap,
        scope: "editor",
        chord: "Mod+Alt+Shift+Enter",
      }),
    ).toMatchObject({ kind: "command", commandId: "query.runFromStart" });

    expect(
      resolveKeybinding({
        keymap: defaultKeymap,
        scope: "grid",
        chord: "Mod+,",
        commands: appCommandCatalog,
      }),
    ).toMatchObject({ kind: "command", commandId: "settings.open" });

    expect(
      resolveKeybinding({
        keymap: defaultKeymap,
        scope: "grid",
        chord: "Mod+Shift+P",
      }),
    ).toMatchObject({ kind: "command", commandId: "palette.open" });

    expect(
      resolveKeybinding({
        keymap: defaultKeymap,
        scope: "grid",
        chord: "Mod+Z",
      }),
    ).toMatchObject({ kind: "command", commandId: "edit.undo" });

    expect(
      resolveKeybinding({
        keymap: defaultKeymap,
        scope: "editor",
        chord: "Mod+Z",
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("tracks two-chord sequences", () => {
    const keymap: Keymap = {
      ...defaultKeymap,
      "editor.format": "Mod+K Mod+F",
    };
    const first = resolveKeybinding({
      keymap,
      scope: "editor",
      chord: "Mod+K",
    });
    expect(first).toMatchObject({ kind: "pending", pending: ["Mod+K"] });

    const second = resolveKeybinding({
      keymap,
      scope: "editor",
      chord: "Mod+F",
      pending: first.pending,
    });
    expect(second).toMatchObject({
      kind: "command",
      commandId: "editor.format",
      sequence: "Mod+K Mod+F",
    });
  });

  it("does not resolve bare key sequences while typing", () => {
    const keymap: Keymap = {
      ...defaultKeymap,
      "editor.format": "G G",
    };
    expect(
      resolveKeybinding({
        keymap,
        scope: "editor",
        chord: "G",
        allowBare: false,
      }),
    ).toMatchObject({ kind: "none" });
    expect(
      resolveKeybinding({
        keymap,
        scope: "editor",
        chord: "G",
        allowBare: true,
      }),
    ).toMatchObject({ kind: "pending" });
  });

  it("detects conflicts per effective scope", () => {
    const editorConflict: Keymap = {
      ...defaultKeymap,
      "editor.format": "Mod+Enter",
    };
    const editorConflicts = findConflicts(editorConflict);
    expect(commandHasConflict(editorConflicts, "editor.format", "editor")).toBe(
      true,
    );
    expect(commandHasConflict(editorConflicts, "editor.format", "grid")).toBe(
      false,
    );

    const separatedScopes: Keymap = {
      ...defaultKeymap,
      "result.export": "Mod+Enter",
    };
    const scopedConflicts = findConflicts(separatedScopes);
    expect(commandHasConflict(scopedConflicts, "result.export", "grid")).toBe(
      false,
    );
  });

  it("canonicalizes and formats key sequences", () => {
    expect(canonicalKeySequence("mod+k   mod+f")).toBe("Mod+K Mod+F");
    expect(formatKeySequence("Mod+K Mod+F")).toContain("K");
  });
});
