import { describe, expect, it } from "vitest";
import {
  appCommandCatalog,
  resultCopyDefaultKeymap,
  workspaceMenuSections,
} from "@/app/app-config";
import { defaultKeymap } from "@/keybindings";

describe("app command config", () => {
  it("keeps command ids unique", () => {
    const ids = appCommandCatalog.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("catalogs every default keybinding target", () => {
    const catalogIds = new Set(appCommandCatalog.map((command) => command.id));
    const keymapIds = [
      ...Object.keys(defaultKeymap),
      ...Object.keys(resultCopyDefaultKeymap),
    ];

    for (const commandId of keymapIds) {
      expect(catalogIds.has(commandId), commandId).toBe(true);
    }
  });

  it("only references known commands from the workspace menu", () => {
    const catalogIds = new Set(appCommandCatalog.map((command) => command.id));

    for (const section of workspaceMenuSections) {
      expect(section.items.length, section.label).toBeGreaterThan(0);
      for (const item of section.items) {
        expect(catalogIds.has(item.commandId), item.commandId).toBe(true);
      }
    }
  });
});
