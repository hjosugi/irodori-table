import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/features/preferences";
import { Sidebar } from "@/features/workbench/components/Sidebar";
import type { WorkspaceConnection } from "@/lib/workspace-connection";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

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

function renderSidebar(
  engine: string,
  overrides: Partial<Parameters<typeof Sidebar>[0]> = {},
) {
  const activeConnection = connectionWith(engine);
  const props: Parameters<typeof Sidebar>[0] = {
    sidebarOpen: true,
    side: "left",
    activeView: "objectBrowser",
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
    ...overrides,
  };
  flushSync(() => root.render(<Sidebar {...props} />));
  return props;
}

function headingText() {
  return container.querySelector(".browser-section .section-heading span")
    ?.textContent;
}

function containerIconClass() {
  return container
    .querySelector(".schema-tree > summary > svg")
    ?.getAttribute("class");
}

describe("Sidebar object browser container vocabulary", () => {
  it("keeps schema wording for engines outside the lakehouse contract", () => {
    renderSidebar("postgres");

    expect(headingText()).toBe("2 schemas");
    expect(containerIconClass()).toContain("lucide-folder");
  });

  it("names Iceberg containers namespaces", () => {
    renderSidebar("iceberg");

    expect(headingText()).toBe("2 namespaces");
  });

  it("names Hive containers databases", () => {
    renderSidebar("hive");

    expect(headingText()).toBe("2 databases");
  });

  // databricks is a lakehouse engine whose contract still calls the level
  // schemas, so vocabulary and icon deliberately disagree here.
  it("keeps schema wording for Databricks but marks it as a lakehouse", () => {
    renderSidebar("databricks");

    expect(headingText()).toBe("2 schemas");
    expect(containerIconClass()).toContain("lucide-boxes");
  });

  it("marks lakehouse containers with the lakehouse icon", () => {
    renderSidebar("deltaLake");

    expect(containerIconClass()).toContain("lucide-boxes");
  });

  // Before metadata arrives the heading has no count to show. It used to fall
  // back to the literal "public", which is a Postgres schema name rather than
  // a container count, is wrong for engines that have no public schema, and
  // never went through t() so it stayed English under any locale.
  it("falls back to a translated label when metadata has not loaded", () => {
    renderSidebar("sqlite", {
      activeMetadata: undefined,
      activeConnectionOpen: false,
    });

    expect(headingText()).toBe("Database objects");
  });

  it("uses the same fallback for engines that do have a public schema", () => {
    renderSidebar("postgres", { activeMetadata: undefined });

    expect(headingText()).toBe("Database objects");
  });
});
