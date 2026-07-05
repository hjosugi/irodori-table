import { useWorkbenchContext } from "@/app/workbench-context";
import { AiChatPanel } from "@/features/ai/chat/AiChatPanel";
import { defaultConnectionColor } from "@/features/connections";
import { GitPanel } from "@/features/git";
import { BiPanel } from "@/features/results";
import { useSchemaDesignerStore } from "@/features/schema-designer";
import { SearchReplacePanel } from "@/features/search/SearchReplacePanel";
import {
  InspectorContent,
  LakehousePanel,
  PlanPanel,
  Sidebar,
  objectKindLabel,
  qualifiedObjectName,
} from "@/features/workbench";

// One side of the workbench: the view rail plus every dockable panel
// (completion, history, plan, lakehouse, BI, git, AI chat, search) wired to
// the workbench controllers from context.
export function WorkbenchSidebar({ side }: { side: "left" | "right" }) {
  const {
    connections,
    editor,
    editorCommands,
    erd,
    grid,
    importFileRef,
    layout,
    notices,
    plan,
    sidebars,
    workspace,
  } = useWorkbenchContext();
  const {
    activeConnection,
    activeConnectionId,
    activeConnectionOpen,
    activeMetadata,
    activeMetadataError,
    activeMetadataLoading,
    completionHints,
    connectedIds,
    connectionActions,
    connectionById,
    editorEngine,
    objectActionMenu,
    profileById,
    setConnectionManagerOpen,
    setObjectActionMenu,
  } = connections;
  const { editorGroups, activeEditorApi } = editor;
  const setQuery = editorGroups.setQuery;
  const openBlankSchemaDesigner = useSchemaDesignerStore(
    (state) => state.openBlank,
  );
  const openObjectSchemaDesigner = useSchemaDesignerStore(
    (state) => state.openForObject,
  );
  const right = side === "right";
  const inspectorPanel = (kind: "completion" | "history") => (
    <InspectorContent
      activeConnectionId={activeConnectionId}
      editorEngine={editorEngine}
      connectionById={connectionById}
      activeMetadataLoading={activeMetadataLoading}
      activeMetadataError={activeMetadataError}
      completionHints={completionHints}
      onInsertCompletionHint={workspace.insertCompletionHint}
      onInsertSql={(sql) => activeEditorApi()?.insertText(sql)}
      onLoadHistorySql={setQuery}
      onCloseCompletion={
        kind === "completion"
          ? () => sidebars.closeSidebarView("completion")
          : undefined
      }
      onCloseHistory={
        kind === "history"
          ? () => sidebars.closeSidebarView("queryHistory")
          : undefined
      }
      showCompletion={kind === "completion"}
      showHistory={kind === "history"}
    />
  );

  return (
    <Sidebar
      sidebarOpen={right ? sidebars.rightSidebarOpen : sidebars.sidebarOpen}
      side={side}
      activeView={
        right ? sidebars.activeRightSidebarView : sidebars.activeLeftSidebarView
      }
      availableViews={
        right ? sidebars.rightSidebarViews : sidebars.leftSidebarViews
      }
      showConnectionRail={false}
      completionPanel={inspectorPanel("completion")}
      historyPanel={inspectorPanel("history")}
      planPanel={
        <PlanPanel
          plan={plan.analysis}
          loading={plan.loading}
          error={plan.error}
          activeConnectionOpen={activeConnectionOpen}
          activeConnectionName={activeConnection.name}
          onExplainPlan={() => void editorCommands.explainCurrentQuery("plan")}
          onExplainAnalyze={() =>
            void editorCommands.explainCurrentQuery("analyze")
          }
          onCopyFormat={(format) => void editorCommands.copyPlanFormat(format)}
          onClose={() => sidebars.closeSidebarView("plan")}
        />
      }
      lakehousePanel={
        <LakehousePanel
          editorEngine={editorEngine}
          activeConnectionName={activeConnection.name}
          activeConnectionOpen={activeConnectionOpen}
          activeMetadata={activeMetadata}
          onInsertSql={(sql) => activeEditorApi()?.insertText(sql)}
          onLoadSql={setQuery}
          onClose={() => sidebars.closeSidebarView("lakehouse")}
        />
      }
      biPanel={
        <BiPanel
          result={grid.activeResult}
          chartModel={grid.chartResultModel}
          chartAvailable={grid.chartAvailable}
          onOpenChartMode={() => grid.setResultMode("chart")}
          onClose={() => sidebars.closeSidebarView("bi")}
        />
      }
      gitPanel={
        <GitPanel
          variant="sidebar"
          onClose={() => sidebars.closeSidebarView("git")}
        />
      }
      aiChatPanel={
        <AiChatPanel
          activeConnectionId={activeConnectionId}
          activeConnectionName={activeConnection.name}
          activeConnectionOpen={activeConnectionOpen}
          engine={editorEngine}
          onInsertSql={(sql) => activeEditorApi()?.insertText(sql)}
          onClose={() => sidebars.closeSidebarView("aiChat")}
          notify={notices.show}
        />
      }
      searchReplacePanel={
        <SearchReplacePanel
          tabs={editorGroups.searchTabs}
          onReveal={editorGroups.revealSearchMatch}
          onReplaceTab={editorGroups.replaceSearchTab}
          onClose={() => sidebars.closeSidebarView("searchReplace")}
        />
      }
      connections={connections.connections}
      profileById={profileById}
      connectionColorFallback={defaultConnectionColor}
      activeConnectionId={activeConnectionId}
      activeConnection={activeConnection}
      activeConnectionOpen={activeConnectionOpen}
      activeMetadata={activeMetadata}
      activeMetadataLoading={activeMetadataLoading}
      activeMetadataError={activeMetadataError}
      connectedIds={connectedIds}
      objectActionMenu={objectActionMenu}
      objectKindLabel={objectKindLabel}
      formatObjectName={(object) => qualifiedObjectName(editorEngine, object)}
      onAddProfile={() => {
        connectionActions.addProfile();
        setConnectionManagerOpen(true);
      }}
      onOpenConnectionManager={() => setConnectionManagerOpen(true)}
      onOpenSqliteSample={() => void connectionActions.openSqliteSample()}
      onSelectConnection={connectionActions.selectSidebarConnection}
      onOpenBlankSchemaDesigner={openBlankSchemaDesigner}
      onNewTableFromFile={() => importFileRef.current?.click()}
      onOpenObjectSchemaDesigner={openObjectSchemaDesigner}
      onOpenDiagram={() => erd.setDiagramOpen(true)}
      onOpenSchemaDiagram={erd.openSchemaDiagramDesigner}
      onRefreshObjects={() =>
        connectionActions.refreshObjects(activeConnectionId, true, true)
      }
      onOpenTableData={(object) => void workspace.openTableData(object)}
      onOpenSnapshotObject={workspace.openSnapshotObject}
      onShowObjectInDiagram={workspace.showObjectInDiagram}
      onSetObjectActionMenu={setObjectActionMenu}
      onSelectView={sidebars.setActiveSidebarView}
      onCloseSidebar={() =>
        right
          ? sidebars.setRightSidebarOpen(false)
          : sidebars.setSidebarOpen(false)
      }
      dockResize
      onBeginResize={(event) =>
        layout.beginPanelResize(right ? "rightSidebar" : "sidebar", event)
      }
      onResizeKey={(event) =>
        layout.onPanelResizeKey(right ? "rightSidebar" : "sidebar", event)
      }
    />
  );
}
