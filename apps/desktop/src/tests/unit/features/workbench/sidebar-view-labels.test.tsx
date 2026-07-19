// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/features/preferences";
import { Sidebar } from "@/features/workbench/components/Sidebar";
import { renderUi } from "../../../helpers/render";

// The labelled switcher wrapped to a second row once a side held enough views
// (Find / BI dropped to their own line). The owner's call: icons only by
// default, one row, with text labels as an opt-in setting. The accessible name
// must not depend on that setting — the label text moves, the aria-label stays.
const initial = usePreferencesStore.getState();

afterEach(() => {
  usePreferencesStore.setState(initial, true);
});

describe("sidebar view tab labels preference", () => {
  it("defaults to icons only", () => {
    expect(initial.sidebarViewLabels).toBe(false);
  });

  it("round-trips the opt-in through the setter", () => {
    usePreferencesStore.getState().setSidebarViewLabels(true);
    expect(usePreferencesStore.getState().sidebarViewLabels).toBe(true);
    usePreferencesStore.getState().setSidebarViewLabels((v) => !v);
    expect(usePreferencesStore.getState().sidebarViewLabels).toBe(false);
  });
});

describe("switcher rendering", () => {
  function renderSwitcher() {
    const connection = {
      id: "c1",
      name: "Analytics",
      engine: "postgres",
      status: "connected",
      latencyMs: 4,
      proxy: "",
      objects: [],
    };
    const props = {
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
      connections: [connection],
      profileById: new Map(),
      connectionColorFallback: "#888888",
      activeConnectionId: connection.id,
      activeConnection: connection,
      activeConnectionOpen: false,
      activeMetadata: undefined,
      activeMetadataLoading: false,
      activeMetadataError: undefined,
      connectedIds: new Set<string>(),
      objectActionMenu: null,
      objectKindLabel: () => "table",
      formatObjectName: (object: { name: string }) => object.name,
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
    } as unknown as Parameters<typeof Sidebar>[0];
    return renderUi(<Sidebar {...props} />);
  }

  it("renders tabs with an accessible name but no visible label by default", () => {
    usePreferencesStore.setState({ sidebarViewLabels: false });
    renderSwitcher();

    const tab = screen.getAllByRole("tab")[0];
    expect(tab.getAttribute("aria-label")).toBeTruthy();
    expect(tab.querySelector("span")).toBeNull();
  });

  it("shows the label text when the setting is on", () => {
    usePreferencesStore.setState({ sidebarViewLabels: true });
    renderSwitcher();

    const tab = screen.getAllByRole("tab")[0];
    expect(tab.querySelector("span")?.textContent).toBeTruthy();
  });
});
