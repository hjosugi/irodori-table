import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/features/preferences";
import { Sidebar } from "@/features/workbench/components/Sidebar";
import type { WorkspaceConnection } from "@/lib/workspace-connection";
import { componentRenderer } from "@/tests/helpers/render";

function connectionWith(engine: string): WorkspaceConnection {
  return {
    id: "c1",
    name: "Analytics",
    engine,
    status: "connected",
    latencyMs: 4,
    proxy: "",
    objects: [],
  };
}

const renderSidebar = componentRenderer(Sidebar, () => {
  const activeConnection = connectionWith("postgres");
  return {
    sidebarOpen: true,
    side: "left" as const,
    activeView: "objectBrowser" as const,
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
    connections: [activeConnection],
    profileById: new Map(),
    connectionColorFallback: "#888888",
    activeConnectionId: activeConnection.id,
    activeConnection,
    activeConnectionOpen: true,
    activeMetadata: {
      schemas: [
        { name: "sales", objects: [] },
        { name: "ops", objects: [] },
      ],
    },
    activeMetadataLoading: false,
    activeMetadataError: undefined,
    connectedIds: new Set([activeConnection.id]),
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
  } satisfies Parameters<typeof Sidebar>[0];
});

/** Render for `engine`, keeping the connection fields consistent. */
function renderForEngine(
  engine: string,
  overrides: Partial<Parameters<typeof Sidebar>[0]> = {},
) {
  const activeConnection = connectionWith(engine);
  return renderSidebar({
    connections: [activeConnection],
    activeConnection,
    activeConnectionId: activeConnection.id,
    connectedIds: new Set([activeConnection.id]),
    ...overrides,
  });
}

// The container heading and the tree icon are styling-level details with no
// accessible name of their own, so they stay on CSS selectors.
function headingText(container: HTMLElement) {
  return container.querySelector(".browser-section .section-heading span")
    ?.textContent;
}

function containerIconClass(container: HTMLElement) {
  return container
    .querySelector(".schema-tree > summary > svg")
    ?.getAttribute("class");
}

beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
});

describe("Sidebar object browser container vocabulary", () => {
  it("keeps schema wording for engines outside the lakehouse contract", () => {
    const { container } = renderForEngine("postgres");

    expect(headingText(container)).toBe("2 schemas");
    expect(containerIconClass(container)).toContain("lucide-folder");
  });

  it("names Iceberg containers namespaces", () => {
    const { container } = renderForEngine("iceberg");

    expect(headingText(container)).toBe("2 namespaces");
  });

  it("names Hive containers databases", () => {
    const { container } = renderForEngine("hive");

    expect(headingText(container)).toBe("2 databases");
  });

  // databricks is a lakehouse engine whose contract still calls the level
  // schemas, so vocabulary and icon deliberately disagree here.
  it("keeps schema wording for Databricks but marks it as a lakehouse", () => {
    const { container } = renderForEngine("databricks");

    expect(headingText(container)).toBe("2 schemas");
    expect(containerIconClass(container)).toContain("lucide-boxes");
  });

  it("marks lakehouse containers with the lakehouse icon", () => {
    const { container } = renderForEngine("deltaLake");

    expect(containerIconClass(container)).toContain("lucide-boxes");
  });

  // Before metadata arrives the heading has no count to show. It used to fall
  // back to the literal "public", which is a Postgres schema name rather than
  // a container count, is wrong for engines that have no public schema, and
  // never went through t() so it stayed English under any locale.
  it("falls back to a translated label when metadata has not loaded", () => {
    const { container } = renderForEngine("sqlite", {
      activeMetadata: undefined,
      activeConnectionOpen: false,
    });

    expect(headingText(container)).toBe("Database objects");
  });

  it("uses the same fallback for engines that do have a public schema", () => {
    const { container } = renderForEngine("postgres", {
      activeMetadata: undefined,
    });

    expect(headingText(container)).toBe("Database objects");
  });

  // textContent alone would also pass on a tree collapsed to zero height; this
  // at least holds the schema rows to being rendered and not hidden.
  it("shows a row for every schema", () => {
    renderForEngine("postgres");

    expect(screen.getByText("sales")).toBeVisible();
    expect(screen.getByText("ops")).toBeVisible();
  });
});
