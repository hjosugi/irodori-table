import type { EditorWorkspace } from "@/app/controllers/use-editor-workspace";
import {
  createPanelResizeController,
  useWorkbenchStore,
} from "@/features/workbench";

type WorkbenchLayoutDeps = {
  editor: Pick<EditorWorkspace, "editorSplitMode" | "editorSplitRef">;
};

// Dock layout dimensions (persisted in the workbench store) plus the
// drag/keyboard resize controller shared by the sidebars, the results pane,
// and the editor split.
export function useWorkbenchLayout({ editor }: WorkbenchLayoutDeps) {
  const sidebarWidth = useWorkbenchStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkbenchStore((state) => state.setSidebarWidth);
  const inspectorWidth = useWorkbenchStore((state) => state.inspectorWidth);
  const setInspectorWidth = useWorkbenchStore(
    (state) => state.setInspectorWidth,
  );
  const resultsHeight = useWorkbenchStore((state) => state.resultsHeight);
  const setResultsHeight = useWorkbenchStore((state) => state.setResultsHeight);
  const editorSplitPercent = useWorkbenchStore(
    (state) => state.editorSplitPercent,
  );
  const setEditorSplitPercent = useWorkbenchStore(
    (state) => state.setEditorSplitPercent,
  );
  const { beginPanelResize, onPanelResizeKey } = createPanelResizeController({
    sidebarWidth,
    inspectorWidth,
    resultsHeight,
    editorSplitMode: editor.editorSplitMode,
    editorSplitRef: editor.editorSplitRef,
    setSidebarWidth,
    setInspectorWidth,
    setResultsHeight,
    setEditorSplitPercent,
  });

  return {
    sidebarWidth,
    inspectorWidth,
    resultsHeight,
    editorSplitPercent,
    beginPanelResize,
    onPanelResizeKey,
  };
}

export type WorkbenchLayout = ReturnType<typeof useWorkbenchLayout>;
