import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/features/preferences";
import { Sidebar } from "@/features/workbench/components/Sidebar";
import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import type { WorkspaceConnection } from "@/lib/workspace-connection";
import { expectPortaledIntoViewport } from "@/tests/helpers/portal";
import { renderUi } from "@/tests/helpers/render";

/**
 * Regression guard for the four menus the sidebar portals to <body>.
 *
 * The sidebar sits inside scroll containers and dockview panels whose
 * overflow/stacking used to clip these popovers: they reported themselves open
 * (`aria-expanded="true"`, nodes in the DOM, text queryable) while being zero
 * pixels wide on screen. The fix — portal out to <body>, `position: fixed`, and
 * clamp the coordinates to the viewport — is documented at Sidebar.tsx:130 but
 * had no test, because no test ever opened these menus.
 *
 * `expectPortaledIntoViewport` spells out what jsdom can and cannot prove here.
 * The short version: this locks in the portal boundary, the fixed positioning
 * and the coordinate clamp, not the painted result.
 */

// Mirrors `clampObjectMenuPosition` in Sidebar.tsx: the box the clamp reserves.
const MENU_WIDTH = 218;
const MENU_HEIGHT = 150;

/** The sidebar/rail subtrees are the ancestors that used to clip the menus. */
const CLIPPING_ANCESTORS = ".sidebar, .connection-rail";

function objectMetadata(name: string): DbObjectMetadata {
  return {
    schema: "sales",
    name,
    kind: "table",
    columns: [{ name: "id", dataType: "int4", nullable: false, ordinal: 1 }],
    indexes: [],
    primaryKey: ["id"],
    foreignKeys: [],
  };
}

const metadata: DatabaseMetadata = {
  schemas: [{ name: "sales", objects: [objectMetadata("orders")] }],
};

const connection: WorkspaceConnection = {
  id: "c1",
  name: "Analytics",
  engine: "postgres",
  status: "connected",
  latencyMs: 4,
  proxy: "",
  objects: [],
};

type SidebarProps = Parameters<typeof Sidebar>[0];

function sidebarProps(overrides: Partial<SidebarProps> = {}): SidebarProps {
  return {
    sidebarOpen: true,
    side: "left",
    activeView: "objectBrowser",
    availableViews: ["objectBrowser", "queryHistory"],
    completionPanel: null,
    historyPanel: null,
    planPanel: null,
    lakehousePanel: null,
    biPanel: null,
    gitPanel: null,
    aiChatPanel: null,
    searchReplacePanel: null,
    rowDetailPanel: null,
    knowledgePanel: null,
    connections: [connection],
    profileById: new Map(),
    connectionColorFallback: "#888888",
    activeConnectionId: connection.id,
    activeConnection: connection,
    activeConnectionOpen: true,
    activeMetadata: metadata,
    activeMetadataLoading: false,
    activeMetadataError: undefined,
    connectedIds: new Set([connection.id]),
    objectActionMenu: null,
    objectKindLabel: () => "table",
    formatObjectName: (object) => object.name,
    onAddProfile: vi.fn(),
    onOpenConnectionManager: vi.fn(),
    onOpenSqliteSample: vi.fn(),
    onSelectConnection: vi.fn(),
    onOpenBlankSchemaDesigner: vi.fn(),
    onNewTableFromFile: vi.fn(),
    onOpenObjectSchemaDesigner: vi.fn(),
    onOpenDiagram: vi.fn(),
    onOpenSchemaDiagram: vi.fn(),
    onRefreshObjects: vi.fn(),
    onOpenTableData: vi.fn(),
    onOpenSnapshotObject: vi.fn(),
    onShowObjectInDiagram: vi.fn(),
    onSetObjectActionMenu: vi.fn(),
    onSelectView: vi.fn(),
    onCloseSidebar: vi.fn(),
    onBeginResize: vi.fn(),
    onResizeKey: vi.fn(),
    ...overrides,
  };
}

/**
 * `objectActionMenu` is a controlled prop, so the object menu only opens if
 * something feeds the new value back. The app does that; this stands in for it.
 */
function StatefulSidebar(props: SidebarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  return (
    <Sidebar
      {...props}
      objectActionMenu={openMenu}
      onSetObjectActionMenu={(value) =>
        setOpenMenu((current) =>
          typeof value === "function" ? value(current) : value,
        )
      }
    />
  );
}

/**
 * A corner the menu cannot fit into: without the clamp the popover would hang
 * off the right and bottom edges, which is the "menu opened off-screen" bug.
 */
function bottomRightCorner() {
  return { clientX: window.innerWidth - 4, clientY: window.innerHeight - 4 };
}

beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
});

describe("Sidebar portaled menus", () => {
  it("opens the connection context menu inside the viewport", () => {
    renderUi(<Sidebar {...sidebarProps()} />);

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Switch to Analytics" }),
      bottomRightCorner(),
    );

    const menu = screen.getByRole("menu");
    expect(
      screen.getByRole("menuitem", { name: "Edit connection…" }),
    ).toBeVisible();
    expectPortaledIntoViewport(menu, {
      clippedBy: CLIPPING_ANCESTORS,
      width: MENU_WIDTH,
      height: MENU_HEIGHT,
    });
  });

  it("opens the view configuration menu inside the viewport", () => {
    renderUi(
      <Sidebar
        {...sidebarProps({ onMoveView: vi.fn(), onSetViewHidden: vi.fn() })}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("tab", { name: "History" }),
      bottomRightCorner(),
    );

    const menu = screen.getByRole("menu", { name: "Configure views" });
    expect(
      screen.getByRole("menuitem", { name: "Move to Right Sidebar" }),
    ).toBeEnabled();
    expectPortaledIntoViewport(menu, {
      clippedBy: CLIPPING_ANCESTORS,
      width: MENU_WIDTH,
      height: MENU_HEIGHT,
    });
  });

  it("opens the create menu inside the viewport", async () => {
    const { user } = renderUi(<Sidebar {...sidebarProps()} />);

    await user.click(screen.getByRole("button", { name: "New table" }));

    const menu = screen.getByRole("menu");
    expect(screen.getByRole("menuitem", { name: "New Table" })).toBeVisible();
    expectPortaledIntoViewport(menu, {
      clippedBy: CLIPPING_ANCESTORS,
      width: MENU_WIDTH,
      height: MENU_HEIGHT,
    });
  });

  it("opens the object action menu inside the viewport", async () => {
    const { user } = renderUi(<StatefulSidebar {...sidebarProps()} />);

    await user.click(
      screen.getByRole("button", { name: "Actions for orders" }),
    );

    const menu = screen.getByRole("menu");
    expect(screen.getByRole("menuitem", { name: "Open Data" })).toBeVisible();
    expectPortaledIntoViewport(menu, {
      clippedBy: CLIPPING_ANCESTORS,
      width: MENU_WIDTH,
      height: MENU_HEIGHT,
    });
  });

  it("opens the object action menu from a right-click inside the viewport", () => {
    renderUi(<StatefulSidebar {...sidebarProps()} />);

    // The tree row's own context menu anchors at the pointer rather than under
    // the `⋯` button, so it takes a different path through the clamp.
    fireEvent.contextMenu(
      screen
        .getByRole("button", { name: "Actions for orders" })
        .closest("summary") as HTMLElement,
      bottomRightCorner(),
    );

    expectPortaledIntoViewport(screen.getByRole("menu"), {
      clippedBy: CLIPPING_ANCESTORS,
      width: MENU_WIDTH,
      height: MENU_HEIGHT,
    });
  });

  it("keeps every menu closed until it is opened", () => {
    renderUi(<StatefulSidebar {...sidebarProps()} />);

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
