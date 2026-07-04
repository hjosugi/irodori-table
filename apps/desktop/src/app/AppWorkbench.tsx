import { type CSSProperties, useEffect, useMemo } from "react";
import { useActionNotices } from "@/app/ActionToast";
import { uiZoomStyleVariables } from "@/app/app-workbench-utils";
import { useEditorWorkspace } from "@/app/controllers/use-editor-workspace";
import { useErdDiagram } from "@/app/controllers/use-erd-diagram";
import { useKeybindingManager } from "@/app/controllers/use-keybinding-manager";
import { useQueryWorkspace } from "@/app/controllers/use-query-workspace";
import { useSettingsController } from "@/app/controllers/use-settings-controller";
import { useSidebarViews } from "@/app/controllers/use-sidebar-views";
import { useThemeManager } from "@/app/controllers/use-theme-manager";
import { useWorkbenchActions } from "@/app/controllers/use-workbench-actions";
import { useWorkbenchConnections } from "@/app/controllers/use-workbench-connections";
import { useWorkbenchLayout } from "@/app/controllers/use-workbench-layout";
import { useWorkbenchOverlays } from "@/app/controllers/use-workbench-overlays";
import { WorkbenchProvider } from "@/app/workbench-context";
import { WorkbenchRoot } from "@/app/WorkbenchRoot";
import { useConfirm } from "@/components/ConfirmDialog";
import { usePreferencesStore } from "@/features/preferences";
import { useSchemaDesignerStore } from "@/features/schema-designer";
import { createTranslator } from "@/i18n";
import { cssVariables } from "@/theme";

// Suppress the native context menu everywhere; the workbench renders its own.
function useNativeContextMenuSuppression() {
  useEffect(() => {
    const preventNativeContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    const options = { capture: true } as AddEventListenerOptions;
    window.addEventListener("contextmenu", preventNativeContextMenu, options);
    document.addEventListener("contextmenu", preventNativeContextMenu, options);
    return () => {
      window.removeEventListener(
        "contextmenu",
        preventNativeContextMenu,
        options,
      );
      document.removeEventListener(
        "contextmenu",
        preventNativeContextMenu,
        options,
      );
    };
  }, []);
}

// The workbench composition root: create each part in dependency order, then
// hand the finished object to the view tree through context. Long controller
// hand-offs live inside the part files (use-query-workspace,
// use-workbench-actions, use-workbench-layout), not here.
// See src/app/README.md for the architecture guide.
function useWorkbench() {
  useNativeContextMenuSuppression();

  // Cross-cutting services: toasts, the shared confirm dialog, i18n.
  const { notices, showActionNotice, dismissNotice } = useActionNotices();
  const { confirm: confirmAction, confirmElement } = useConfirm();
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = useMemo(() => createTranslator(locale), [locale]);
  const uiZoom = usePreferencesStore((state) => state.uiZoom);

  // Domains with no dependencies on other controllers.
  const themes = useThemeManager();
  const sidebars = useSidebarViews();
  const overlays = useWorkbenchOverlays();
  const connections = useWorkbenchConnections({ showActionNotice, t });

  // Keybindings come next so the editor can render shortcut labels.
  // `actions` is created further down but only reached from event handlers,
  // so the lazy closures are safe.
  const keybindings = useKeybindingManager({
    runCommand: (commandId) => actions.runCommand(commandId),
    closeTransientOverlays: () => actions.closeTransientOverlaysFromEscape(),
    showActionNotice,
    t,
  });

  const editor = useEditorWorkspace({
    keymap: keybindings.keymap,
    showActionNotice,
    t,
  });
  const layout = useWorkbenchLayout({ editor });
  const settings = useSettingsController({
    themes,
    keybindings,
    showActionNotice,
    t,
  });

  const openObjectSchemaDesigner = useSchemaDesignerStore(
    (state) => state.openForObject,
  );
  const erd = useErdDiagram({
    activeConnectionId: connections.activeConnectionId,
    activeConnectionName: connections.activeConnection.name,
    activeMetadata: connections.activeMetadata,
    theme: themes.theme,
    setQuery: editor.setQuery,
    activeEditorApi: editor.activeEditorApi,
    openObjectSchemaDesigner,
    showActionNotice,
    t,
  });

  // The run-a-query pipeline: grid, runner, editor commands, history.
  const queryWorkspace = useQueryWorkspace({
    connections,
    editor,
    sidebars,
    settings,
    erd,
    confirm: confirmAction,
    showActionNotice,
    t,
  });

  // Workspace actions, runCommand, Escape handling, center-pane bundles.
  const actions = useWorkbenchActions({
    connections,
    editor,
    themes,
    overlays,
    sidebars,
    settings,
    erd,
    queryWorkspace,
    layout,
    showActionNotice,
    t,
  });

  const appStyle = useMemo(
    () =>
      ({
        ...cssVariables(themes.theme),
        ...uiZoomStyleVariables(uiZoom),
      }) as CSSProperties,
    [themes.theme, uiZoom],
  );

  return {
    // Cross-cutting services.
    t,
    appStyle,
    notices: { list: notices, show: showActionNotice, dismiss: dismissNotice },
    confirmElement,
    // Domain controllers, one per workspace concern.
    connections,
    themes,
    sidebars,
    overlays,
    keybindings,
    editor,
    grid: queryWorkspace.grid,
    queryRunner: queryWorkspace.queryRunner,
    editorCommands: queryWorkspace.editorCommands,
    historyActions: queryWorkspace.historyActions,
    workspace: actions.workspace,
    erd,
    settings,
    // Cross-domain surfaces produced by the parts above.
    runCommand: actions.runCommand,
    plan: queryWorkspace.plan,
    layout,
    importFileRef: queryWorkspace.importFileRef,
    queryEditorController: actions.queryEditorController,
    resultGridController: actions.resultGridController,
  };
}

export type Workbench = ReturnType<typeof useWorkbench>;

export function AppWorkbench() {
  const workbench = useWorkbench();
  return (
    <WorkbenchProvider workbench={workbench}>
      <WorkbenchRoot />
    </WorkbenchProvider>
  );
}
