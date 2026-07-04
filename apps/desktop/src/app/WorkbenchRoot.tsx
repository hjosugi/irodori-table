import { ActionToastStack } from "@/app/ActionToast";
import {
  APP_NAME,
  appMenuCommandCatalog,
  menuBarSections,
} from "@/app/app-config";
import { WorkbenchDialogs } from "@/app/WorkbenchDialogs";
import { WorkbenchSidebar } from "@/app/WorkbenchSidebar";
import { useWorkbenchContext } from "@/app/workbench-context";
import { usePreferencesStore } from "@/features/preferences";
import { QueryEditorPane } from "@/features/query-editor";
import { ResultsPane } from "@/features/results";
import { WorkbenchDockLayout, WorkbenchShell } from "@/features/workbench";

// The single top-level view: shell chrome, dock layout, the two center panes,
// both sidebars, every dialog, and the toast stack. Purely presentational —
// all state and behavior comes from the Workbench context.
export function WorkbenchRoot() {
  const {
    appStyle,
    confirmElement,
    connections,
    editor,
    grid,
    keybindings,
    layout,
    notices,
    overlays,
    queryEditorController,
    queryRunner,
    resultGridController,
    runCommand,
    sidebars,
    themes,
  } = useWorkbenchContext();
  const { theme, themeSwitching } = themes;
  const { activeKeyScope, syncScopeFromTarget } = keybindings;
  const vimMode = usePreferencesStore((state) => state.vimMode);
  const sqlLinter = usePreferencesStore((state) => state.sqlLinter);
  const animationsEnabled = usePreferencesStore(
    (state) => state.animationsEnabled,
  );

  return (
    <div
      className="app-root"
      data-theme={theme.kind}
      data-animations={animationsEnabled ? "on" : "off"}
      data-theme-switching={themeSwitching ? "on" : undefined}
      style={appStyle}
    >
      <WorkbenchShell
        appName={APP_NAME}
        themeKind={theme.kind}
        activeKeyScope={activeKeyScope}
        leftSidebarOpen={sidebars.sidebarOpen}
        rightSidebarOpen={sidebars.rightSidebarOpen}
        completionOpen={sidebars.completionOpen}
        historyOpen={sidebars.historyOpen}
        planOpen={sidebars.planOpen}
        sidebarWidth={layout.sidebarWidth}
        inspectorWidth={layout.inspectorWidth}
        resultsHeight={layout.resultsHeight}
        editorSplitPercent={layout.editorSplitPercent}
        menuBarSections={menuBarSections}
        commandCatalog={appMenuCommandCatalog}
        keymap={keybindings.keymap}
        activeConnectionName={connections.activeConnection.name}
        activeConnectionEngine={connections.activeConnection.engine}
        activeConnectionColor={connections.activeConnectionColor}
        activeConnectionStatus={connections.activeConnectionStatus}
        activeTransportLabel={connections.activeTransportLabel}
        vimMode={vimMode}
        queryLineCount={editor.query.split("\n").length}
        sqlLintEnabled={sqlLinter === "gentle"}
        running={queryRunner.running}
        selectionStatus={grid.selectionStatus}
        shellStyle={appStyle}
        onScopeFocus={(event) => syncScopeFromTarget(event.target, "global")}
        onScopeMouseDown={(event) =>
          syncScopeFromTarget(event.target, activeKeyScope)
        }
        onToggleLeftSidebar={() => sidebars.setSidebarOpen((open) => !open)}
        onToggleRightSidebar={sidebars.toggleRightSidebar}
        onOpenConnectionManager={() =>
          connections.setConnectionManagerOpen(true)
        }
        onRunCommand={runCommand}
        onCloseWorkspaceMenu={() => overlays.setWorkspaceMenuOpen(false)}
        dockLayout
        leftSidebar={null}
        rightSidebar={null}
      >
        <WorkbenchDockLayout
          leftSidebarOpen={sidebars.sidebarOpen}
          rightSidebarOpen={sidebars.rightSidebarOpen}
          sidebarWidth={layout.sidebarWidth}
          inspectorWidth={layout.inspectorWidth}
          resultsHeight={layout.resultsHeight}
          leftSidebar={<WorkbenchSidebar side="left" />}
          rightSidebar={<WorkbenchSidebar side="right" />}
          editor={
            <div className="editor-and-inspector">
              <QueryEditorPane {...queryEditorController} />
            </div>
          }
          results={<ResultsPane {...resultGridController} />}
        />
      </WorkbenchShell>

      <WorkbenchDialogs />

      {confirmElement}

      <ActionToastStack notices={notices.list} onDismiss={notices.dismiss} />
    </div>
  );
}
