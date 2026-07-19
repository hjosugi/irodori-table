import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GeneralTab } from "@/features/settings/tabs/GeneralTab";
import { createTranslator } from "@/i18n";
import { componentRenderer } from "@/tests/helpers/render";

const { t } = createTranslator("en");

const renderTab = componentRenderer(
  GeneralTab,
  () =>
    ({
      t,
      locale: "en",
      setLocale: vi.fn(),
      uiZoom: 1,
      setUiZoom: vi.fn(),
      vimMode: false,
      setVimMode: vi.fn(),
      editorBackgroundImage: "",
      setEditorBackgroundImage: vi.fn(),
      editorBackgroundOpacity: 0.08,
      setEditorBackgroundOpacity: vi.fn(),
      animationsEnabled: true,
      setAnimationsEnabled: vi.fn(),
      autoCommit: true,
      setAutoCommit: vi.fn(),
      updateCheckOnStartup: true,
      setUpdateCheckOnStartup: vi.fn(),
      formatter: "sql-formatter",
      setFormatter: vi.fn(),
      sqlLinter: "gentle",
      setSqlLinter: vi.fn(),
      resultOffloadEnabled: true,
      setResultOffloadEnabled: vi.fn(),
      resultMemoryBudget: 20_000,
      setResultMemoryBudget: vi.fn(),
      queryHistoryMaxItems: 100,
      setQueryHistoryMaxItems: vi.fn(),
      queryHistoryResultRows: 50,
      setQueryHistoryResultRows: vi.fn(),
      sidebarOpen: true,
      setSidebarOpen: vi.fn(),
      resetLayout: vi.fn(),
    }) satisfies Parameters<typeof GeneralTab>[0],
);

// The row is a <label>, which (matching the existing Sidebar toggle row) hands
// the button its accessible name from the row title, so reach it by its visible
// label text rather than by accessible name.
function resetLayoutButton() {
  const button = screen.getByText("Reset layout").closest("button");
  if (!button) throw new Error("Reset layout button not found");
  return button;
}

describe("GeneralTab layout reset", () => {
  it("offers a discoverable Reset layout control", () => {
    renderTab();
    expect(screen.getByText("Panel layout")).toBeVisible();
    expect(resetLayoutButton()).toBeVisible();
  });

  it("invokes resetLayout when the button is clicked", async () => {
    const { props, user } = renderTab();
    await user.click(resetLayoutButton());
    expect(props.resetLayout).toHaveBeenCalledTimes(1);
  });
});
