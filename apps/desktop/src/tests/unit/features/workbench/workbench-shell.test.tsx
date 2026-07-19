import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/features/preferences";
import { WorkbenchShell } from "@/features/workbench/components/WorkbenchShell";
import { componentRenderer } from "@/tests/helpers/render";

const renderShell = componentRenderer(WorkbenchShell, () => ({
  appName: "Irodori Table",
  themeKind: "light" as const,
  activeKeyScope: "global" as const,
  leftSidebarOpen: true,
  rightSidebarOpen: false,
  completionOpen: false,
  historyOpen: false,
  planOpen: false,
  sidebarWidth: 260,
  inspectorWidth: 360,
  resultsHeight: 280,
  editorSplitPercent: 50,
  menuBarSections: [],
  commandCatalog: [],
  keymap: { "palette.open": "Mod+Shift+P" },
  activeConnectionName: "Local Postgres",
  activeConnectionEngine: "PostgreSQL",
  activeConnectionColor: "#8ac7a3",
  activeConnectionStatus: "connected",
  activeConnectionOpen: true,
  activeTransportLabel: "Direct connection",
  vimMode: false,
  queryLineCount: 1,
  sqlLintEnabled: true,
  running: false,
  selectionStatus: null,
  shellStyle: {},
  leftSidebar: <aside />,
  children: <section className="test-workspace-body">Body</section>,
  onScopeFocus: vi.fn(),
  onScopeMouseDown: vi.fn(),
  onToggleLeftSidebar: vi.fn(),
  onToggleRightSidebar: vi.fn(),
  onOpenConnectionManager: vi.fn(),
  onRunCommand: vi.fn(),
  onCloseWorkspaceMenu: vi.fn(),
}));

/** The shell's context menu anchors at the pointer, so it needs coordinates. */
function rightClick(target: Element) {
  return fireEvent.contextMenu(target, { clientX: 80, clientY: 88 });
}

beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
});

describe("WorkbenchShell", () => {
  it("keeps left and right sidebar widths independent", () => {
    const { container } = renderShell({
      sidebarWidth: 240,
      inspectorWidth: 420,
    });

    // Layout custom properties have no accessible surface to query by.
    const shell = container.querySelector<HTMLElement>(".app-shell");

    expect(shell?.style.getPropertyValue("--sidebar-width")).toBe("240px");
    expect(shell?.style.getPropertyValue("--right-sidebar-width")).toBe(
      "420px",
    );
  });

  it("drops the connection colour from the status dot while disconnected", () => {
    const { container } = renderShell({
      activeConnectionOpen: false,
      activeConnectionColor: "#2e7a56",
      activeConnectionStatus: "Disconnected",
    });

    const dot = container.querySelector<HTMLElement>(
      ".statusbar-connection .connection-color-dot",
    );

    // A green dot next to "Disconnected" reads as connected. The neutral
    // colour comes from CSS keyed on this attribute, so the inline profile
    // colour has to be absent for it to apply.
    expect(dot?.dataset.connected).toBe("false");
    expect(dot?.style.background).toBe("");
  });

  it("keeps the connection colour on the status dot while connected", () => {
    const { container } = renderShell({
      activeConnectionOpen: true,
      activeConnectionColor: "#2e7a56",
    });

    const dot = container.querySelector<HTMLElement>(
      ".statusbar-connection .connection-color-dot",
    );

    expect(dot?.dataset.connected).toBe("true");
    expect(dot?.style.background).not.toBe("");
  });

  it("opens a fallback context menu from empty workbench space", async () => {
    const { props, user, container } = renderShell();
    const workspace = container.querySelector<HTMLElement>(".workspace");
    expect(workspace).not.toBeNull();

    expect(rightClick(workspace as HTMLElement)).toBe(false);

    expect(screen.getByRole("menu")).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Connections" })).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "Command palette" }),
    ).toBeNull();

    await user.click(screen.getByRole("menuitem", { name: "Connections" }));

    expect(props.onRunCommand).toHaveBeenCalledWith("connection.manager");
  });

  it("can activate an icon-only control from the context menu", async () => {
    const { props, user, container } = renderShell();
    const sidebarButton = container.querySelector<HTMLElement>(
      '[data-sidebar-toggle="left"]',
    );
    expect(sidebarButton).not.toBeNull();

    rightClick(sidebarButton as HTMLElement);

    // The control is icon-only, so the menu has to name it from its label
    // rather than its (empty) text content.
    const activate = screen.getByRole("menuitem", {
      name: "Activate Hide left sidebar",
    });
    expect(activate).toBeVisible();

    await user.click(activate);

    expect(props.onToggleLeftSidebar).toHaveBeenCalledTimes(1);
  });
});
