import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview-react";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";

type WorkbenchDockPanelId =
  | "leftSidebar"
  | "editor"
  | "results"
  | "rightSidebar";

type WorkbenchDockPanelContent = Record<WorkbenchDockPanelId, ReactNode>;

type Disposable = {
  dispose: () => void;
};

export type WorkbenchDockLayoutProps = {
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  sidebarWidth: number;
  inspectorWidth: number;
  resultsHeight: number;
  leftSidebar: ReactNode;
  rightSidebar: ReactNode;
  editor: ReactNode;
  results: ReactNode;
};

// v2: sidebars dock at the root edges (full workspace height, VS Code-style)
// instead of splitting only the editor row; old layouts would keep the
// results pane at full window width, so they are not restored.
const dockLayoutStorageKey = "irodori.workbench.dockview.layout.v2";
const legacyDockLayoutStorageKeys = ["irodori.workbench.dockview.layout.v1"];
const dockPanelIds: readonly WorkbenchDockPanelId[] = [
  "leftSidebar",
  "editor",
  "results",
  "rightSidebar",
];

const DockPanelContentContext = createContext<WorkbenchDockPanelContent | null>(
  null,
);

const dockComponents = {
  workbenchPanel: WorkbenchDockPanel,
};

export function WorkbenchDockLayout({
  leftSidebarOpen,
  rightSidebarOpen,
  sidebarWidth,
  inspectorWidth,
  resultsHeight,
  leftSidebar,
  rightSidebar,
  editor,
  results,
}: WorkbenchDockLayoutProps) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const apiRef = useRef<DockviewApi | null>(null);
  const readyRef = useRef(false);
  const layoutDisposableRef = useRef<Disposable | null>(null);
  const panelContent = useMemo<WorkbenchDockPanelContent>(
    () => ({
      leftSidebar,
      editor,
      results,
      rightSidebar,
    }),
    [editor, leftSidebar, results, rightSidebar],
  );

  const saveLayout = useCallback((api: DockviewApi) => {
    if (!readyRef.current || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      dockLayoutStorageKey,
      JSON.stringify(api.toJSON()),
    );
  }, []);

  const addEditorPanel = useCallback(
    (api: DockviewApi) => {
      if (api.getPanel("editor")) {
        return;
      }
      api.addPanel({
        id: "editor",
        component: "workbenchPanel",
        title: t("dock.sqlEditor"),
        renderer: "always",
        minimumWidth: 360,
        minimumHeight: 220,
      });
    },
    [t],
  );

  const addResultsPanel = useCallback(
    (api: DockviewApi) => {
      if (api.getPanel("results")) {
        return;
      }
      addEditorPanel(api);
      api.addPanel({
        id: "results",
        component: "workbenchPanel",
        title: t("dock.results"),
        renderer: "always",
        initialHeight: resultsHeight,
        minimumHeight: 180,
        position: {
          referencePanel: "editor",
          direction: "below",
        },
      });
    },
    [addEditorPanel, resultsHeight, t],
  );

  const addLeftSidebarPanel = useCallback(
    (api: DockviewApi) => {
      if (api.getPanel("leftSidebar")) {
        return;
      }
      addEditorPanel(api);
      const otherSidebar = api.getPanel("rightSidebar");
      const otherWidth = otherSidebar?.api.width;
      const panel = api.addPanel({
        id: "leftSidebar",
        component: "workbenchPanel",
        title: t("dock.explorer"),
        renderer: "always",
        initialWidth: sidebarWidth,
        minimumWidth: 180,
        // Dock at the root edge (no reference panel) so the sidebar spans
        // the full workspace height with the editor/results split inside.
        position: {
          direction: "left",
        },
      });
      // Dockview distributes the container proportionally when a root-edge
      // panel is inserted, ignoring initialWidth and rescaling the opposite
      // sidebar; pin both widths explicitly (the editor absorbs the change).
      // The rescale lands after this tick, so pin again on the next frame.
      const pinWidths = () => {
        panel.api.setSize({ width: sidebarWidth });
        if (otherSidebar && otherWidth) {
          otherSidebar.api.setSize({ width: otherWidth });
        }
      };
      pinWidths();
      requestAnimationFrame(pinWidths);
    },
    [addEditorPanel, sidebarWidth, t],
  );

  const addRightSidebarPanel = useCallback(
    (api: DockviewApi) => {
      if (api.getPanel("rightSidebar")) {
        return;
      }
      addEditorPanel(api);
      const otherSidebar = api.getPanel("leftSidebar");
      const otherWidth = otherSidebar?.api.width;
      const panel = api.addPanel({
        id: "rightSidebar",
        component: "workbenchPanel",
        title: t("dock.inspector"),
        renderer: "always",
        initialWidth: inspectorWidth,
        minimumWidth: 220,
        // Root-edge dock, same reason as the left sidebar.
        position: {
          direction: "right",
        },
      });
      // Same as the left sidebar: pin the new width and restore the opposite
      // sidebar's width, which the root-edge insertion rescales. The rescale
      // lands after this tick, so pin again on the next frame.
      const pinWidths = () => {
        panel.api.setSize({ width: inspectorWidth });
        if (otherSidebar && otherWidth) {
          otherSidebar.api.setSize({ width: otherWidth });
        }
      };
      pinWidths();
      requestAnimationFrame(pinWidths);
    },
    [addEditorPanel, inspectorWidth, t],
  );

  const addDefaultPanels = useCallback(
    (api: DockviewApi) => {
      addEditorPanel(api);
      addResultsPanel(api);
      if (leftSidebarOpen) {
        addLeftSidebarPanel(api);
      }
      if (rightSidebarOpen) {
        addRightSidebarPanel(api);
      }
    },
    [
      addEditorPanel,
      addLeftSidebarPanel,
      addResultsPanel,
      addRightSidebarPanel,
      leftSidebarOpen,
      rightSidebarOpen,
    ],
  );

  const syncPanels = useCallback(
    (api: DockviewApi) => {
      for (const panel of Array.from(api.panels)) {
        if (!isDockPanelId(panel.id)) {
          api.removePanel(panel);
        }
      }

      addEditorPanel(api);
      addResultsPanel(api);

      const leftPanel = api.getPanel("leftSidebar");
      if (leftSidebarOpen) {
        addLeftSidebarPanel(api);
      } else if (leftPanel) {
        api.removePanel(leftPanel);
      }

      const rightPanel = api.getPanel("rightSidebar");
      if (rightSidebarOpen) {
        addRightSidebarPanel(api);
      } else if (rightPanel) {
        api.removePanel(rightPanel);
      }
    },
    [
      addEditorPanel,
      addLeftSidebarPanel,
      addResultsPanel,
      addRightSidebarPanel,
      leftSidebarOpen,
      rightSidebarOpen,
    ],
  );

  const restoreLayout = useCallback(
    (api: DockviewApi) => {
      if (typeof window === "undefined") {
        addDefaultPanels(api);
        return;
      }
      for (const legacyKey of legacyDockLayoutStorageKeys) {
        window.localStorage.removeItem(legacyKey);
      }
      const raw = window.localStorage.getItem(dockLayoutStorageKey);
      if (!raw) {
        addDefaultPanels(api);
        return;
      }
      try {
        api.fromJSON(JSON.parse(raw) as SerializedDockview);
        syncPanels(api);
      } catch {
        window.localStorage.removeItem(dockLayoutStorageKey);
        api.clear();
        addDefaultPanels(api);
      }
    },
    [addDefaultPanels, syncPanels],
  );

  const handleReady = useCallback(
    (event: DockviewReadyEvent) => {
      const { api } = event;
      apiRef.current = api;
      restoreLayout(api);
      readyRef.current = true;
      saveLayout(api);
      layoutDisposableRef.current?.dispose();
      layoutDisposableRef.current = api.onDidLayoutChange(() =>
        saveLayout(api),
      );
    },
    [restoreLayout, saveLayout],
  );

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !readyRef.current) {
      return;
    }
    syncPanels(api);
    saveLayout(api);
  }, [saveLayout, syncPanels]);

  useEffect(
    () => () => {
      layoutDisposableRef.current?.dispose();
      layoutDisposableRef.current = null;
      apiRef.current = null;
      readyRef.current = false;
    },
    [],
  );

  return (
    <DockPanelContentContext.Provider value={panelContent}>
      <div className="workbench-dock dockview-theme-irodori">
        <DockviewReact
          components={dockComponents}
          defaultTabComponent={WorkbenchDockTab}
          dndStrategy="pointer"
          getTabContextMenuItems={() => []}
          keyboardNavigation
          onReady={handleReady}
        />
      </div>
    </DockPanelContentContext.Provider>
  );
}

function WorkbenchDockPanel({ api }: IDockviewPanelProps) {
  const content = useContext(DockPanelContentContext);
  const panelId = isDockPanelId(api.id) ? api.id : "editor";
  return (
    <div className={`workbench-dock-panel ${panelId}`}>
      {content?.[panelId] ?? null}
    </div>
  );
}

function WorkbenchDockTab({ api }: IDockviewPanelHeaderProps) {
  return <span className="workbench-dock-tab">{api.title ?? api.id}</span>;
}

function isDockPanelId(value: string): value is WorkbenchDockPanelId {
  return dockPanelIds.includes(value as WorkbenchDockPanelId);
}
