import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { usePreferencesStore } from "@/features/preferences";
import { componentRenderer } from "@/tests/helpers/render";

// The real TerminalView spawns a PTY and mounts xterm.js; neither exists in
// jsdom. The panel under test only cares that one view exists per tab.
vi.mock("@/features/terminal/TerminalView", () => ({
  TerminalView: ({ active }: { active: boolean }) => (
    <div data-testid="terminal-view" data-active={active} />
  ),
}));

const renderPanel = componentRenderer(TerminalPanel, () => ({
  onClose: vi.fn(),
}));

beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
});

describe("TerminalPanel tab accessibility (#134)", () => {
  // Pre-fix each tab was a bare <div onClick>: the only focusable control on
  // a background terminal was its close button, so a keyboard user could
  // destroy a session but never switch to it.
  it("switches terminals with a keyboard-activated real tab", async () => {
    const { user } = renderPanel();

    await user.click(screen.getByRole("button", { name: "New terminal" }));

    const tablist = screen.getByRole("tablist", { name: "Terminal tabs" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAccessibleName("Terminal 1");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");

    // Keyboard only: focus the background tab and activate it with Enter.
    tabs[0].focus();
    expect(tabs[0]).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    const views = screen.getAllByTestId("terminal-view");
    expect(views[0]).toHaveAttribute("data-active", "true");
    expect(views[1]).toHaveAttribute("data-active", "false");
  });

  it("keeps the close control outside the tab button", async () => {
    const { user, props } = renderPanel();
    await user.click(screen.getByRole("button", { name: "New terminal" }));

    const close = screen.getByRole("button", { name: "Close Terminal 1" });
    // Nested interactive elements are invalid; the close button must be a
    // sibling of the tab, not its child.
    expect(close.closest('[role="tab"]')).toBeNull();

    await user.click(close);
    expect(screen.queryByRole("tab", { name: "Terminal 1" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Terminal 2" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Closing the last terminal closes the whole panel.
    await user.click(screen.getByRole("button", { name: "Close Terminal 2" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("localizes the tab strip", () => {
    usePreferencesStore.setState({ locale: "ja" });
    renderPanel();

    expect(
      screen.getByRole("tablist", { name: "ターミナルのタブ" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "ターミナル 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "新しいターミナル" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "ターミナル 1 を閉じる" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "パネルを閉じる" }),
    ).toBeInTheDocument();
  });
});
