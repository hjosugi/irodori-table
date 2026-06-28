export {
  WorkbenchShell,
  type WorkbenchStatusBarItem,
} from "./components/WorkbenchShell";
export { Sidebar } from "./components/Sidebar";
export { LakehousePanel } from "./components/LakehousePanel";
export { PlanPanel } from "./components/PlanPanel";
export { Inspector, InspectorContent } from "./components/Inspector";
export { completionHintsFromMetadata } from "./completion-hints";
export { createWorkbenchCommandHandler } from "./command-handlers";
export {
  createPanelResizeController,
  INSPECTOR_WIDTH_MAX,
  INSPECTOR_WIDTH_MIN,
  RESULTS_HEIGHT_MAX,
  RESULTS_HEIGHT_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  type PanelResizeKind,
} from "./panel-resize";
export {
  objectKindLabel,
  qualifiedObjectName,
  quoteSqlIdentifier,
  tablePreviewSql,
} from "./object-sql";
export {
  useWorkbenchStore,
  type EditorSplitMode,
  type SidebarSide,
} from "./store/workbench-store";
export {
  activeWorkbenchView,
  defaultWorkbenchViewPlacements,
  defaultWorkbenchViewVisibility,
  workbenchViewIds,
} from "./types";
export type {
  CompletionHint,
  WorkbenchKeyScope,
  WorkbenchSide,
  WorkbenchViewId,
  WorkbenchViewPlacements,
  WorkbenchViewVisibility,
} from "./types";
