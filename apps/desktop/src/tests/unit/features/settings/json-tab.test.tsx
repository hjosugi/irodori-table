import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JsonTab } from "@/features/settings/tabs/JsonTab";
import { createTranslator } from "@/i18n";
import { componentRenderer } from "@/tests/helpers/render";

const { t } = createTranslator("en");

const renderTab = componentRenderer(JsonTab, () => ({
  t,
  settingsJsonDraft: "{}",
  setSettingsJsonDraft: vi.fn(),
  settingsJsonError: null,
  setSettingsJsonError: vi.fn(),
  resetSettingsJsonDraft: vi.fn(),
  applySettingsJson: vi.fn(),
}));

describe("JsonTab", () => {
  // #138: the JSON editor is the tab's central control, yet it exposed no
  // accessible name at all — a screen reader landed on a bare "edit text".
  it("names the settings JSON editor", () => {
    renderTab();

    expect(screen.getByRole("textbox", { name: "Settings JSON" })).toHaveValue(
      "{}",
    );
  });
});
