import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/features/preferences";
import { Sidebar } from "@/features/workbench/components/Sidebar";
import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import type { WorkbenchViewId } from "@/features/workbench";
import type { WorkspaceConnection } from "@/lib/workspace-connection";
import { renderUi } from "@/tests/helpers/render";

/**
 * Regression guard for cross-side drag-to-dock (#129).
 *
 * A view tab dragged from the opposite sidebar and dropped on this side's tab
 * strip must move the view here via `onMoveView`. Reordering within a side (the
 * drag originated here, so a local source ref is set) must NOT be mistaken for a
 * cross-side move, and a drag that is not one of our view tabs (e.g. a file)
 * must not light the strip up as a drop target.
 *
 * The two sidebars are separate `Sidebar` instances, so the dragged id travels
 * between them only through the typed drag payload — that is exactly what these
 * tests stand in for with a hand-built `dataTransfer`.
 */

const VIEW_DND_MIME = "application/x-irodori-view";

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
    side: "right",
    activeView: "plan",
    availableViews: ["plan", "git"],
    sideViews: ["plan", "git"],
    hiddenViews: {},
    onMoveView: vi.fn(),
    onSetViewHidden: vi.fn(),
    onReorderView: vi.fn(),
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

/** A drag payload as the app's typed drag start would leave it. */
function viewDataTransfer(viewId: string) {
  return {
    types: [VIEW_DND_MIME],
    getData: (type: string) => (type === VIEW_DND_MIME ? viewId : ""),
    setData: vi.fn(),
    dropEffect: "",
    effectAllowed: "",
  } as unknown as DataTransfer;
}

function strip() {
  const node = document.querySelector<HTMLElement>(".sidebar-view-switcher");
  if (!node) {
    throw new Error("view switcher strip not found");
  }
  return node;
}

beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
});

describe("Sidebar cross-side drag-to-dock", () => {
  it("docks a view dropped in from the other side onto this side", () => {
    const onMoveView = vi.fn();
    renderUi(<Sidebar {...sidebarProps({ side: "right", onMoveView })} />);

    // No dragStart happened on this instance, so this is a foreign drag.
    fireEvent.dragOver(strip(), { dataTransfer: viewDataTransfer("git") });
    expect(strip().className).toContain("side-drop-active");

    fireEvent.drop(strip(), { dataTransfer: viewDataTransfer("git") });
    expect(onMoveView).toHaveBeenCalledWith("git", "right");
    expect(strip().className).not.toContain("side-drop-active");
  });

  it("docks onto the left side too", () => {
    const onMoveView = vi.fn();
    renderUi(
      <Sidebar
        {...sidebarProps({
          side: "left",
          activeView: "objectBrowser",
          availableViews: ["objectBrowser", "queryHistory"],
          sideViews: ["objectBrowser", "queryHistory"],
          onMoveView,
        })}
      />,
    );

    fireEvent.drop(strip(), { dataTransfer: viewDataTransfer("plan") });
    expect(onMoveView).toHaveBeenCalledWith("plan", "left");
  });

  it("does not treat a same-side reorder as a cross-side move", () => {
    const onMoveView = vi.fn();
    const { getByRole } = renderUi(
      <Sidebar {...sidebarProps({ side: "right", onMoveView })} />,
    );

    // Start a drag on this side's own Git tab: the strip must ignore its drop.
    fireEvent.dragStart(getByRole("tab", { name: "Git" }), {
      dataTransfer: viewDataTransfer("git"),
    });
    fireEvent.dragOver(strip(), { dataTransfer: viewDataTransfer("git") });
    expect(strip().className).not.toContain("side-drop-active");

    fireEvent.drop(strip(), { dataTransfer: viewDataTransfer("git") });
    expect(onMoveView).not.toHaveBeenCalled();
  });

  it("ignores drags that are not view tabs", () => {
    const onMoveView = vi.fn();
    renderUi(<Sidebar {...sidebarProps({ side: "right", onMoveView })} />);

    const fileDrag = {
      types: ["Files"],
      getData: () => "",
    } as unknown as DataTransfer;
    fireEvent.dragOver(strip(), { dataTransfer: fileDrag });
    expect(strip().className).not.toContain("side-drop-active");

    fireEvent.drop(strip(), { dataTransfer: fileDrag });
    expect(onMoveView).not.toHaveBeenCalled();
  });

  it("ignores an unknown view id", () => {
    const onMoveView = vi.fn();
    renderUi(<Sidebar {...sidebarProps({ side: "right", onMoveView })} />);

    fireEvent.drop(strip(), {
      dataTransfer: viewDataTransfer("not-a-view" as WorkbenchViewId),
    });
    expect(onMoveView).not.toHaveBeenCalled();
  });
});
