export { WorkbenchShell } from "./components/WorkbenchShell";
export { Sidebar } from "./components/Sidebar";
export { Inspector } from "./components/Inspector";
export { createWorkbenchCommandHandler } from "./command-handlers";
export {
  useWorkbenchStore,
  type EditorSplitMode,
  type SidebarSide,
} from "./store/workbench-store";
export {
  defaultWorkbenchViewPlacements,
  workbenchViewIds,
} from "./types";
export type {
  CompletionHint,
  PanelResizeKind,
  WorkbenchKeyScope,
  WorkbenchSide,
  WorkbenchViewId,
  WorkbenchViewPlacements,
} from "./types";
