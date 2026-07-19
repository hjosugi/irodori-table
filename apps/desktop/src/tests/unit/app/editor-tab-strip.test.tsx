import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorTabStrip } from "@/app/EditorTabStrip";
import type { EditorGroupState } from "@/app/editor-tabs";
import { usePreferencesStore } from "@/features/preferences";
import { componentRenderer } from "@/tests/helpers/render";

function stripState(): EditorGroupState {
  return {
    tabs: [
      { id: "one", label: "Query 1" },
      { id: "two", label: "Query 2" },
    ],
    activeTabId: "one",
    openTabIds: ["one", "two"],
    queryByTabId: { one: "", two: "" },
    selectionsByTabId: {
      one: [{ from: 0, to: 0 }],
      two: [{ from: 0, to: 0 }],
    },
  };
}

const renderStrip = componentRenderer(EditorTabStrip, () => ({
  group: "primary" as const,
  state: stripState(),
  menu: null,
  onSelectTab: vi.fn(),
  onOpenMenu: vi.fn(),
  onCloseMenu: vi.fn(),
  onNewTab: vi.fn(),
  onRenameTab: vi.fn(),
  onDuplicateTab: vi.fn(),
  onCloseTab: vi.fn(),
  onCloseOtherTabs: vi.fn(),
  onReopenClosedTab: vi.fn(),
}));

beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
  // jsdom has no layout; the strip scrolls the active tab into view on mount.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("EditorTabStrip tablist structure", () => {
  // #142: role="tablist" wrapped the whole strip, so the "+" and "..." action
  // buttons — which are not tabs — were exposed to AT as tablist children.
  // Only the scroll container holding the tabs may carry the role.
  it("keeps only tabs inside the tablist", () => {
    renderStrip();

    const tablist = screen.getByRole("tablist", { name: "SQL editor tabs" });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(2);
    expect(
      within(tablist).queryByRole("button", { name: "New SQL tab" }),
    ).toBeNull();
    expect(
      within(tablist).queryByRole("button", { name: "Tab actions" }),
    ).toBeNull();

    // The action buttons stay reachable — just outside the tablist.
    expect(screen.getByRole("button", { name: "New SQL tab" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Tab actions" })).toBeVisible();
  });

  it("marks the active tab selected", () => {
    renderStrip();

    expect(screen.getByRole("tab", { name: "Query 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Query 2" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});
