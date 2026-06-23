import { describe, expect, it } from "vitest";
import { commandCatalog, defaultKeymap, findConflicts } from "./keybindings";

describe("keybindings", () => {
  it("ships editor format and comment toggle commands", () => {
    expect(commandCatalog.map((command) => command.id)).toContain("editor.format");
    expect(commandCatalog.map((command) => command.id)).toContain(
      "editor.comment.toggle",
    );
    expect(defaultKeymap["editor.format"]).toBe("Alt+Shift+F");
    expect(defaultKeymap["editor.comment.toggle"]).toBe("Mod+/");
  });

  it("keeps default keybindings conflict-free", () => {
    expect(findConflicts(defaultKeymap)).toEqual({});
  });
});
