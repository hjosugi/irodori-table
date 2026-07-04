import { describe, expect, it } from "vitest";

import {
  CURRENT_SETTINGS_SCHEMA_VERSION,
  migrateSettingsJson,
} from "@/app/settings-schema";

describe("settings schema migration", () => {
  it("marks legacy settings as the current schema version", () => {
    expect(migrateSettingsJson({ locale: "ja" })).toEqual({
      version: CURRENT_SETTINGS_SCHEMA_VERSION,
      locale: "ja",
    });
  });

  it("preserves current-version settings", () => {
    expect(
      migrateSettingsJson({
        version: CURRENT_SETTINGS_SCHEMA_VERSION,
        layout: { sidebarSide: "right" },
      }),
    ).toEqual({
      version: CURRENT_SETTINGS_SCHEMA_VERSION,
      layout: { sidebarSide: "right" },
    });
  });

  it("rejects future settings schemas", () => {
    expect(() =>
      migrateSettingsJson({ version: CURRENT_SETTINGS_SCHEMA_VERSION + 1 }),
    ).toThrow(/newer than this app supports/);
  });
});
