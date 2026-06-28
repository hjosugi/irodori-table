import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchShell } from "@/features/workbench/components/WorkbenchShell";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

function renderShell(
  overrides: Partial<Parameters<typeof WorkbenchShell>[0]> = {},
) {
  const props: Parameters<typeof WorkbenchShell>[0] = {
    appName: "Irodori Table",
    themeKind: "light",
    activeKeyScope: "global",
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
    ...overrides,
  };
  flushSync(() => root.render(<WorkbenchShell {...props} />));
  return props;
}

function rightClick(target: Element) {
  let dispatched = true;
  flushSync(() => {
    dispatched = target.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 88,
      }),
    );
  });
  return dispatched;
}

describe("WorkbenchShell", () => {
  it("keeps left and right sidebar widths independent", () => {
    renderShell({ sidebarWidth: 240, inspectorWidth: 420 });

    const shell = container.querySelector<HTMLElement>(".app-shell");

    expect(shell?.style.getPropertyValue("--sidebar-width")).toBe("240px");
    expect(shell?.style.getPropertyValue("--right-sidebar-width")).toBe(
      "420px",
    );
  });

  it("opens a fallback context menu from empty workbench space", () => {
    const props = renderShell();
    const workspace = container.querySelector<HTMLElement>(".workspace");

    expect(workspace).not.toBeNull();
    expect(rightClick(workspace as HTMLElement)).toBe(false);

    const menu = container.querySelector<HTMLElement>(
      ".workbench-context-menu",
    );
    expect(menu?.textContent).toContain("Command Palette");

    const commandButton = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.includes("Command Palette"));
    flushSync(() => commandButton?.click());

    expect(props.onRunCommand).toHaveBeenCalledWith("palette.open");
  });

  it("can activate an icon-only control from the context menu", () => {
    const onToggleLeftSidebar = vi.fn();
    renderShell({ onToggleLeftSidebar });
    const sidebarButton = container.querySelector<HTMLElement>(
      '[data-sidebar-toggle="left"]',
    );

    expect(sidebarButton).not.toBeNull();
    rightClick(sidebarButton as HTMLElement);

    const menu = container.querySelector<HTMLElement>(
      ".workbench-context-menu",
    );
    expect(menu?.textContent).toContain("Activate Hide left sidebar");

    const activateButton = menu?.querySelector<HTMLButtonElement>("button");
    flushSync(() => activateButton?.click());

    expect(onToggleLeftSidebar).toHaveBeenCalledTimes(1);
  });
});
