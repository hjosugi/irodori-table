import {
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Plus } from "lucide-react";
import { runQuerySpill, runQueryStream } from "@/lib/tauri/db-stream";
import {
  createQueryHistoryResultSnapshot,
  queryHistoryMaxItemsHardLimit,
  queryHistoryResultRowsHardLimit,
  useQueryHistoryStore,
  type QueryHistoryItem,
} from "@/features/query-history/query-history-store";
import {
  APP_IDENTIFIER,
  APP_NAME,
  APP_VERSION,
  appCommandCatalog,
  appMenuCommandCatalog,
  fallbackSnapshot,
  loadSavedQuery,
  menuBarSections,
  resultCopyDefaultKeymap,
  savedQueryStorageKey,
  tabs,
} from "@/app/app-config";
import { AboutDialog } from "@/app/AboutDialog";
import { useResultGridScroll } from "@/app/hooks/useResultGridScroll";
import { useResultGridFiltering } from "@/app/hooks/useResultGridFiltering";
import { useResultGridSelection } from "@/app/hooks/useResultGridSelection";
import { ActionToast, type ActionNotice } from "@/app/ActionToast";
import { CommandPalette } from "@/app/CommandPalette";
import { GitPanel, useGitStore } from "@/features/git";
import {
  BiPanel,
  ResultsPane,
  WindowedRows,
  buildChartResultModel,
  buildGraphResultModel,
  buildResultExport,
  buildResultGridViewModel,
  calculateResultGridVirtualColumnWindow,
  calculateResultGridVirtualRowWindow,
  createWindowedRowsProxy,
  buildSelectedRowChangeSql,
  deriveResultEditTarget,
  findTableMetadata,
  formatResultSelectionStatus,
  formatResultGridCell as formatCell,
  formatResultGridTsv,
  formatResultGridTsvRow,
  historySnapshotToQueryResult,
  parseSourceTable,
  resultExportFileName,
  resultGridRowKey,
  toCount,
  useResultGridStore,
  useResultsStore,
  type ResultEditTarget,
  type ResultExportFormat,
  type ResultGridEditDraft,
  type ResultGridDraftCell as GridCellDraft,
  type ResultGridRowLike,
  type ResultGridRowOrigin,
} from "@/features/results";
import {
  ConnectionManagerDialog,
  defaultConnectionColor,
  describeConnection,
  engineLabel,
  exportConnectionProfiles,
  importConnectionProfiles,
  memoryDefaults,
  newDraft,
  portableProfile,
  profileFromDraft,
  repairBuiltinSampleProfile,
  sanitizedProfile,
  settingsProfileFromJson,
  useConnectionStore,
  validateDraft,
  withStarterProfiles,
  withUniqueProfileIds,
  type ConnectionTransferFormat,
  type ConnectionDraft,
  type WorkspaceConnection,
} from "@/features/connections";
import {
  QueryEditorPane,
  QueryParameterDialog,
  parseQueryMagic,
  buildParameterInputs,
  loadQueryParameterMemory,
  queryParameterMemoryStorageKey,
  type PendingQueryParameters,
  type EditorGroup,
  type EditorSelection,
  type EditorSelections,
  type QueryParameterMemory,
  type QueryMagicAction,
  type SqlEditorHandle,
} from "@/features/query-editor";
import {
  ImportDialog,
  detectImportFileKind,
  generateImportSql,
  inferImportTableName,
  parseImportText,
  type ImportPreview,
} from "@/features/import";
import {
  ErdDialog,
  buildErdModel,
  downloadBlob,
  erdFileName,
  erdSvgStyle,
  hasDiagram,
  layoutErdModel,
  serializeSvgElement,
  svgMarkupToPngBlob,
  toMermaidErd,
  writePngBlobToClipboard,
  writeTextToClipboard,
  type ErdLayout,
} from "@/features/erd";
import {
  SchemaDesignerDialog,
  buildSchemaSql,
  buildTableSpecDocument,
  ddlFromTableSpecDocument,
  exportTableSpecJson,
  exportTableSpecMarkdown,
  parseTableSpecDocument,
  tableSpecFileName,
  useSchemaDesignerStore,
} from "@/features/schema-designer";
import { SettingsDialog, type SettingsTab } from "@/features/settings";
import { AiGenerateDialog } from "@/features/ai/AiGenerateDialog";
import { AiChatPanel } from "@/features/ai/chat/AiChatPanel";
import {
  SearchReplacePanel,
  type SearchTab,
} from "@/features/search/SearchReplacePanel";
import { useSearchStore } from "@/features/search/search-store";
import type { TextMatch } from "@/sql/text-search";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import {
  UI_ZOOM_DEFAULT,
  UI_ZOOM_STEP,
  normalizeEditorBackgroundOpacity,
  normalizeUiZoom,
  usePreferencesStore,
  type ThemePreference,
} from "@/features/preferences";
import { createTranslator, normalizeLocale } from "@/i18n";
import {
  activeWorkbenchViewForSide,
  createWorkbenchCommandHandler,
  InspectorContent,
  INSPECTOR_WIDTH_MAX,
  INSPECTOR_WIDTH_MIN,
  LakehousePanel,
  PlanPanel,
  RESULTS_HEIGHT_MAX,
  RESULTS_HEIGHT_MIN,
  Sidebar,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  WorkbenchShell,
  completionHintsFromMetadata,
  createPanelResizeController,
  objectKindLabel,
  qualifiedObjectName,
  quoteSqlIdentifier,
  tablePreviewSql,
  useWorkbenchStore,
  workbenchViewsForSide,
  workbenchViewIds,
  type CompletionHint,
  type WorkbenchViewId,
  type WorkbenchViewPlacements,
  type WorkbenchViewVisibility,
} from "@/features/workbench";
import {
  KEY_SEQUENCE_TIMEOUT_MS,
  applyVimKeybindingResolutions as applyVimKeybindingResolutionOverrides,
  errorMessage,
  effectiveKeymap,
  eventToChord,
  findConflicts,
  findVimKeybindingConflicts,
  formatKeySequence,
  type KeybindingScope,
  type Keymap,
  type VimKeybindingConflictResolutions,
  loadOverrides,
  resolveKeybinding,
  saveOverrides,
} from "@/core";
import {
  dbApplyEdits,
  dbCancel,
  dbConnect,
  dbDisconnect,
  dbExplainQuery,
  dbListObjects,
  dbQueryParameters,
  dbReleaseResult,
  dbResultWindow,
  jobsList,
  openDeveloperTools,
  type CellValue,
  type DbEngine,
  type DbObjectMetadata,
  type JobList,
  type QueryParameterInput,
  type QueryPlanAnalysis,
  type QueryPlanCopyFormat,
  type QueryPlanMode,
  type QueryResult,
  type QueryResultSet,
  type RowDelete,
  type RowInsert,
  type RowUpdate,
  type SpillRunResult,
  type TableEdits,
  workspaceSnapshot,
  type WorkspaceSnapshot,
} from "@/generated/irodori-api";
import { sqlSnippetsFromJson } from "@/sql/completion";
import { isSqlFormatterId } from "@/sql/formatter";
import { isSqlLinterId } from "@/sql/linter";
import type { SqlEditorTransformAction } from "@/sql/editor-transforms";
import type { SqlMetadataTarget } from "@/sql/metadata-inspection";
import { selectedOrCurrentStatement } from "@/sql/statements";
import { sqlMayWrite } from "@/sql/read-only";
import {
  cssVariables,
  customThemeEntryFromJson,
  defaultThemeById,
  defaultThemeEntryForKind,
  importThemeJson,
  upsertCustomThemeEntry,
  type ThemeKind,
} from "@/theme";
import {
  EMPTY_CELL_EDITS,
  EMPTY_DELETED_ROWS,
  EMPTY_FILTER_RULES,
  EMPTY_NEW_ROWS,
  EMPTY_SORT_RULES,
  GRID_COLUMN_OVERSCAN,
  GRID_COLUMN_WIDTH,
  GRID_COPY_ROW_LIMIT,
  GRID_GUTTER_WIDTH,
  GRID_OVERSCAN,
  GRID_ROW_HEIGHT,
  GRID_WINDOWED_CELL_THRESHOLD,
  GRID_WINDOWED_ROW_THRESHOLD,
  RESULT_WINDOW_MAX_RESIDENT_PAGES,
  RESULT_WINDOW_PAGE_SIZE,
  builtInTheme,
  clampNumber,
  emptyJobList,
  isCellEditorClipboardShortcut,
  isEditableTarget,
  isRecord,
  keyScopeFromTarget,
  parseClipboardTable,
  tauriRuntimeError,
} from "./app-workbench-utils";

function scaledUiPixels(value: number, zoom: number) {
  return Math.max(1, Math.round(value * zoom));
}

function scaledUiFont(value: number, zoom: number) {
  return `${Math.round(value * zoom * 100) / 100}px`;
}

function uiZoomStyleVariables(zoom: number): Record<string, string> {
  const normalized = normalizeUiZoom(zoom);
  return {
    "--ui-zoom": normalized.toFixed(2),
    "--font-ui-xs": scaledUiFont(11, normalized),
    "--font-ui-sm": scaledUiFont(12, normalized),
    "--font-ui-md": scaledUiFont(13, normalized),
    "--font-ui-lg": scaledUiFont(14, normalized),
    "--font-code": scaledUiFont(13, normalized),
    "--editor-line-height": `${scaledUiPixels(20, normalized)}px`,
    "--control-xxs": `${scaledUiPixels(22, normalized)}px`,
    "--control-xs": `${scaledUiPixels(24, normalized)}px`,
    "--control-sm": `${scaledUiPixels(25, normalized)}px`,
    "--control-md": `${scaledUiPixels(27, normalized)}px`,
    "--bar-sm": `${scaledUiPixels(31, normalized)}px`,
    "--bar-md": `${scaledUiPixels(33, normalized)}px`,
    "--status-height": `${scaledUiPixels(22, normalized)}px`,
  };
}

function formatUiZoom(zoom: number) {
  return `${Math.round(normalizeUiZoom(zoom) * 100)}%`;
}

function isQueryCancelledMessage(message: string) {
  const normalized = message.trim().toLowerCase();
  return normalized === "cancelled" || normalized.includes("query cancelled");
}

function isPrimaryRefreshShortcut(event: KeyboardEvent) {
  const isRKey = event.key.toLowerCase() === "r" || event.code === "KeyR";
  if (!isRKey || event.altKey || event.shiftKey) {
    return false;
  }
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  return mac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

function sqlDownloadFileName(label: string) {
  const base = label
    .replace(/\.sql$/i, "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "query"}.sql`;
}

type EditorGroupState = {
  activeTabId: string;
  openTabIds: string[];
  queryByTabId: Record<string, string>;
  selectionsByTabId: Record<string, EditorSelections>;
};

type EditorGroupStates = Record<EditorGroup, EditorGroupState>;

const defaultEditorSelections: EditorSelections = [{ from: 0, to: 0 }];

function createEditorGroupState(initialQuery: string): EditorGroupState {
  return {
    activeTabId: tabs[0].id,
    openTabIds: tabs.map((tab) => tab.id),
    queryByTabId: Object.fromEntries(
      tabs.map((tab, index) => [tab.id, index === 0 ? initialQuery : ""]),
    ) as Record<string, string>,
    selectionsByTabId: Object.fromEntries(
      tabs.map((tab) => [tab.id, defaultEditorSelections]),
    ) as Record<string, EditorSelections>,
  };
}

function queryForEditorGroup(state: EditorGroupState) {
  return state.queryByTabId[state.activeTabId] ?? "";
}

function selectionsForEditorGroup(state: EditorGroupState) {
  return state.selectionsByTabId[state.activeTabId] ?? defaultEditorSelections;
}

function openTabsForEditorGroup(state: EditorGroupState) {
  return tabs.filter((tab) => state.openTabIds.includes(tab.id));
}

function activeTabLabelForEditorGroup(state: EditorGroupState) {
  return (
    openTabsForEditorGroup(state).find((tab) => tab.id === state.activeTabId)
      ?.label ?? "Scratch"
  );
}

const MigrationStudioDialog = lazy(() =>
  import("@/features/migration").then((module) => ({
    default: module.MigrationStudioDialog,
  })),
);
const QueryHistoryDialog = lazy(() =>
  import("@/features/query-history/QueryHistoryDialog").then((module) => ({
    default: module.QueryHistoryDialog,
  })),
);

export function AppWorkbench() {
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
  const gridRef = useRef<HTMLDivElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const schemaSpecFileRef = useRef<HTMLInputElement | null>(null);
  const diagramSvgRef = useRef<SVGSVGElement | null>(null);
  const diagramCanvasRef = useRef<HTMLDivElement | null>(null);
  const pendingDiagramSearchRef = useRef<string | null>(null);
  const actionNoticeTimerRef = useRef<number | null>(null);
  const editorApiRef = useRef<SqlEditorHandle>(null);
  const secondaryEditorApiRef = useRef<SqlEditorHandle>(null);
  const editorSplitRef = useRef<HTMLDivElement | null>(null);
  const [editorGroupStates, setEditorGroupStates] = useState<EditorGroupStates>(
    () => ({
      primary: createEditorGroupState(loadSavedQuery()),
      secondary: createEditorGroupState(""),
    }),
  );
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(fallbackSnapshot);
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const setActiveConnectionId = useConnectionStore(
    (state) => state.setActiveConnectionId,
  );
  const locale = usePreferencesStore((state) => state.locale);
  const setLocale = usePreferencesStore((state) => state.setLocale);
  const { t } = useMemo(() => createTranslator(locale), [locale]);
  const themePreference = usePreferencesStore((state) => state.themePreference);
  const setThemePreference = usePreferencesStore(
    (state) => state.setThemePreference,
  );
  const themeKind = usePreferencesStore((state) => state.themeKind);
  const setThemeKind = usePreferencesStore((state) => state.setThemeKind);
  const activeDefaultThemeId = usePreferencesStore(
    (state) => state.activeDefaultThemeId,
  );
  const setActiveDefaultThemeId = usePreferencesStore(
    (state) => state.setActiveDefaultThemeId,
  );
  const activeCustomThemeId = usePreferencesStore(
    (state) => state.activeCustomThemeId,
  );
  const setActiveCustomThemeId = usePreferencesStore(
    (state) => state.setActiveCustomThemeId,
  );
  const customThemes = usePreferencesStore((state) => state.customThemes);
  const setCustomThemes = usePreferencesStore((state) => state.setCustomThemes);
  const activeCustomTheme = useMemo(
    () =>
      customThemes.find((entry) => entry.id === activeCustomThemeId) ?? null,
    [activeCustomThemeId, customThemes],
  );
  const activeDefaultTheme = useMemo(
    () => defaultThemeEntryForKind(themeKind, activeDefaultThemeId),
    [activeDefaultThemeId, themeKind],
  );
  const theme =
    activeCustomTheme?.theme ?? builtInTheme(themeKind, activeDefaultThemeId);
  const vimMode = usePreferencesStore((state) => state.vimMode);
  const setStoredVimMode = usePreferencesStore((state) => state.setVimMode);
  const formatter = usePreferencesStore((state) => state.formatter);
  const setFormatter = usePreferencesStore((state) => state.setFormatter);
  const sqlLinter = usePreferencesStore((state) => state.sqlLinter);
  const setSqlLinter = usePreferencesStore((state) => state.setSqlLinter);
  const sqlSnippets = usePreferencesStore((state) => state.sqlSnippets);
  const setSqlSnippets = usePreferencesStore((state) => state.setSqlSnippets);
  const editorBackgroundImage = usePreferencesStore(
    (state) => state.editorBackgroundImage,
  );
  const setEditorBackgroundImage = usePreferencesStore(
    (state) => state.setEditorBackgroundImage,
  );
  const editorBackgroundOpacity = usePreferencesStore(
    (state) => state.editorBackgroundOpacity,
  );
  const setEditorBackgroundOpacity = usePreferencesStore(
    (state) => state.setEditorBackgroundOpacity,
  );
  const animationsEnabled = usePreferencesStore(
    (state) => state.animationsEnabled,
  );
  const setAnimationsEnabled = usePreferencesStore(
    (state) => state.setAnimationsEnabled,
  );
  const autoCommit = usePreferencesStore((state) => state.autoCommit);
  const setAutoCommit = usePreferencesStore((state) => state.setAutoCommit);
  const uiZoom = usePreferencesStore((state) => state.uiZoom);
  const setUiZoom = usePreferencesStore((state) => state.setUiZoom);
  const sidebarOpen = useWorkbenchStore((state) => state.sidebarOpen);
  const setSidebarOpen = useWorkbenchStore((state) => state.setSidebarOpen);
  const rightSidebarOpen = useWorkbenchStore((state) => state.rightSidebarOpen);
  const setRightSidebarOpen = useWorkbenchStore(
    (state) => state.setRightSidebarOpen,
  );
  const viewPlacements = useWorkbenchStore((state) => state.viewPlacements);
  const setViewPlacements = useWorkbenchStore(
    (state) => state.setViewPlacements,
  );
  const setViewOpen = useWorkbenchStore((state) => state.setViewOpen);
  const viewVisibility = useWorkbenchStore((state) => state.viewVisibility);
  const setViewVisibility = useWorkbenchStore(
    (state) => state.setViewVisibility,
  );
  const leftSidebarViews = workbenchViewsForSide(viewPlacements, "left");
  const rightSidebarViews = workbenchViewsForSide(viewPlacements, "right");
  const activeLeftSidebarView = activeWorkbenchViewForSide(
    viewVisibility,
    viewPlacements,
    "left",
  );
  const activeRightSidebarView = activeWorkbenchViewForSide(
    viewVisibility,
    viewPlacements,
    "right",
  );
  const sidebarWidth = useWorkbenchStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkbenchStore((state) => state.setSidebarWidth);
  const inspectorWidth = useWorkbenchStore((state) => state.inspectorWidth);
  const setInspectorWidth = useWorkbenchStore(
    (state) => state.setInspectorWidth,
  );
  const resultsHeight = useWorkbenchStore((state) => state.resultsHeight);
  const setResultsHeight = useWorkbenchStore((state) => state.setResultsHeight);
  const editorSplitMode = useWorkbenchStore((state) => state.editorSplitMode);
  const setEditorSplitMode = useWorkbenchStore(
    (state) => state.setEditorSplitMode,
  );
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
    editorSplitMode,
    editorSplitRef,
    setSidebarWidth,
    setInspectorWidth,
    setResultsHeight,
    setEditorSplitPercent,
  });
  const [preferredEditorGroup, setActiveEditorGroup] =
    useState<EditorGroup>("primary");
  const activeEditorGroup: EditorGroup =
    editorSplitMode === "single" ? "primary" : preferredEditorGroup;
  const activeEditorGroupState = editorGroupStates[activeEditorGroup];
  const query = queryForEditorGroup(activeEditorGroupState);
  const editorSelections = selectionsForEditorGroup(activeEditorGroupState);
  const activeTabLabel = activeTabLabelForEditorGroup(activeEditorGroupState);
  const [running, setRunning] = useState(false);

  function updateEditorGroupState(
    group: EditorGroup,
    updater: (state: EditorGroupState) => EditorGroupState,
  ) {
    setEditorGroupStates((current) => ({
      ...current,
      [group]: updater(current[group]),
    }));
  }

  function setEditorGroupQuery(group: EditorGroup, nextQuery: string) {
    updateEditorGroupState(group, (state) => ({
      ...state,
      queryByTabId: {
        ...state.queryByTabId,
        [state.activeTabId]: nextQuery,
      },
    }));
  }

  function setQuery(nextQuery: string) {
    setEditorGroupQuery(activeEditorGroup, nextQuery);
  }

  function setEditorGroupSelection(
    group: EditorGroup,
    selection: EditorSelections,
  ) {
    updateEditorGroupState(group, (state) => ({
      ...state,
      selectionsByTabId: {
        ...state.selectionsByTabId,
        [state.activeTabId]: selection,
      },
    }));
  }

  function selectEditorTab(group: EditorGroup, tabId: string) {
    setActiveEditorGroup(group);
    updateEditorGroupState(group, (state) => ({
      ...state,
      activeTabId: tabId,
    }));
  }

  function setActiveSidebarView(viewId: WorkbenchViewId) {
    const side = viewPlacements[viewId] ?? "left";
    if (side === "right") {
      setRightSidebarOpen(true);
    } else {
      setSidebarOpen(true);
    }
    // The chat panel needs more room than a tree view; open it comfortably wide
    // (without shrinking a side the user already widened).
    if (viewId === "aiChat") {
      const comfortable = 420;
      if (side === "right") {
        setInspectorWidth((current) => Math.max(current, comfortable));
      } else {
        setSidebarWidth((current) => Math.max(current, comfortable));
      }
    }
    setViewVisibility((current) => {
      const next = { ...current };
      workbenchViewIds.forEach((id) => {
        if (viewPlacements[id] === side) {
          next[id] = id === viewId;
        }
      });
      return next;
    });
  }

  function closeSidebarView(viewId: WorkbenchViewId) {
    const side = viewPlacements[viewId] ?? "left";
    setViewOpen(viewId, false);
    if (side === "right") {
      setRightSidebarOpen(false);
      return;
    }
    setActiveSidebarView("objectBrowser");
  }

  function toggleSidebarView(
    viewId: Exclude<WorkbenchViewId, "objectBrowser">,
  ) {
    const side = viewPlacements[viewId] ?? "left";
    const sideOpen = side === "right" ? rightSidebarOpen : sidebarOpen;
    if (sideOpen && viewVisibility[viewId]) {
      closeSidebarView(viewId);
      return;
    }
    setActiveSidebarView(viewId);
  }

  function toggleRightSidebar() {
    if (rightSidebarOpen) {
      setRightSidebarOpen(false);
      return;
    }
    setActiveSidebarView(activeRightSidebarView);
  }

  function openGitPanel() {
    setActiveSidebarView("git");
    void useGitStore.getState().refresh();
  }

  // Every open editor tab (per group, since split groups hold independent text),
  // surfaced to the cross-tab Search & Replace panel.
  const searchTabs = useMemo<SearchTab[]>(() => {
    const groups: EditorGroup[] =
      editorSplitMode === "single" ? ["primary"] : ["primary", "secondary"];
    return groups.flatMap((group) => {
      const state = editorGroupStates[group];
      return openTabsForEditorGroup(state).map((tab) => ({
        key: `${group}:${tab.id}`,
        group,
        tabId: tab.id,
        label: editorSplitMode === "single" ? tab.label : `${tab.label} · ${group}`,
        text: state.queryByTabId[tab.id] ?? "",
      }));
    });
  }, [editorGroupStates, editorSplitMode]);

  function replaceSearchTab(tab: SearchTab, nextText: string) {
    updateEditorGroupState(tab.group as EditorGroup, (state) => ({
      ...state,
      queryByTabId: { ...state.queryByTabId, [tab.tabId]: nextText },
    }));
  }

  function revealSearchMatch(tab: SearchTab, match: TextMatch) {
    const group = tab.group as EditorGroup;
    selectEditorTab(group, tab.tabId);
    // Let the editor re-render the selected tab before selecting the range.
    window.setTimeout(() => {
      const api =
        group === "secondary"
          ? secondaryEditorApiRef.current
          : editorApiRef.current;
      api?.revealRange({ from: match.start, to: match.end });
      api?.focus();
    }, 0);
  }
  // Id of the in-flight query so the Cancel button can stop that specific run.
  const runningQueryIdRef = useRef<string | null>(null);
  const cancelRequestedQueryIdRef = useRef<string | null>(null);
  const profiles = useConnectionStore((state) => state.profiles);
  const setProfiles = useConnectionStore((state) => state.setProfiles);
  const selectedProfileId = useConnectionStore(
    (state) => state.selectedProfileId,
  );
  const setSelectedProfileId = useConnectionStore(
    (state) => state.setSelectedProfileId,
  );
  const draft = useConnectionStore((state) => state.draft);
  const setDraft = useConnectionStore((state) => state.setDraft);
  const connectionManagerOpen = useConnectionStore(
    (state) => state.connectionManagerOpen,
  );
  const setConnectionManagerOpen = useConnectionStore(
    (state) => state.setConnectionManagerOpen,
  );
  const connectionSearch = useConnectionStore(
    (state) => state.connectionSearch,
  );
  const setConnectionSearch = useConnectionStore(
    (state) => state.setConnectionSearch,
  );
  const connectedIds = useConnectionStore((state) => state.connectedIds);
  const setConnectedIds = useConnectionStore((state) => state.setConnectedIds);
  const liveConnections = useConnectionStore((state) => state.liveConnections);
  const setLiveConnections = useConnectionStore(
    (state) => state.setLiveConnections,
  );
  const connecting = useConnectionStore((state) => state.connecting);
  const setConnecting = useConnectionStore((state) => state.setConnecting);
  const testingConnection = useConnectionStore(
    (state) => state.testingConnection,
  );
  const setTestingConnection = useConnectionStore(
    (state) => state.setTestingConnection,
  );
  const connectionError = useConnectionStore((state) => state.connectionError);
  const setConnectionError = useConnectionStore(
    (state) => state.setConnectionError,
  );
  const metadataByConnection = useConnectionStore(
    (state) => state.metadataByConnection,
  );
  const setMetadataByConnection = useConnectionStore(
    (state) => state.setMetadataByConnection,
  );
  const metadataLoading = useConnectionStore((state) => state.metadataLoading);
  const setMetadataLoading = useConnectionStore(
    (state) => state.setMetadataLoading,
  );
  const metadataErrors = useConnectionStore((state) => state.metadataErrors);
  const setMetadataErrors = useConnectionStore(
    (state) => state.setMetadataErrors,
  );
  const objectActionMenu = useConnectionStore(
    (state) => state.objectActionMenu,
  );
  const setObjectActionMenu = useConnectionStore(
    (state) => state.setObjectActionMenu,
  );
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  // EXEC-010: when a run spills past the in-memory budget, the grid pages rows from
  // disk through this handle instead of holding them all in JS. `spillInfo` drives
  // the windowed grid path; `spillRef` holds the live LRU page source; the version
  // counter forces the grid view model to recompute as pages arrive.
  const resultOffloadEnabled = useResultsStore(
    (state) => state.resultOffloadEnabled,
  );
  const setResultOffloadEnabled = useResultsStore(
    (state) => state.setResultOffloadEnabled,
  );
  const resultMemoryBudget = useResultsStore(
    (state) => state.resultMemoryBudget,
  );
  const setResultMemoryBudget = useResultsStore(
    (state) => state.setResultMemoryBudget,
  );
  const spillInfo = useResultGridStore((state) => state.spillInfo);
  const setSpillInfo = useResultGridStore((state) => state.setSpillInfo);
  const gridWindowVersion = useResultGridStore(
    (state) => state.gridWindowVersion,
  );
  const setGridWindowVersion = useResultGridStore(
    (state) => state.setGridWindowVersion,
  );
  const bumpGridWindowVersion = useResultGridStore(
    (state) => state.bumpGridWindowVersion,
  );
  const spillRef = useRef<{ handle: string; source: WindowedRows } | null>(
    null,
  );
  const pendingPagesRef = useRef<Set<number>>(new Set());
  const activeResultIndex = useResultGridStore(
    (state) => state.activeResultIndex,
  );
  const setActiveResultIndex = useResultGridStore(
    (state) => state.setActiveResultIndex,
  );
  const resultMode = useResultGridStore((state) => state.resultMode);
  const setResultMode = useResultGridStore((state) => state.setResultMode);
  const tableViewObject = useResultGridStore((state) => state.tableViewObject);
  const setTableViewObject = useResultGridStore(
    (state) => state.setTableViewObject,
  );
  const [queryError, setQueryError] = useState<string | null>(null);
  const [planAnalysis, setPlanAnalysis] = useState<QueryPlanAnalysis | null>(
    null,
  );
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  // SQL of the last run, used to infer the editable target table.
  const [lastRunSql, setLastRunSql] = useState<string>("");
  // Staged (non-immediate) result editing: changes accumulate until Commit.
  const editMode = useResultGridStore((state) => state.editMode);
  const setEditMode = useResultGridStore((state) => state.setEditMode);
  const cellEdits = useResultGridStore((state) => state.cellEdits);
  const newRows = useResultGridStore((state) => state.newRows);
  const deletedRows = useResultGridStore((state) => state.deletedRows);
  const editUndoDepth = useResultGridStore(
    (state) => state.editUndoStack.length,
  );
  const updateEditDraft = useResultGridStore((state) => state.updateEditDraft);
  const undoEdit = useResultGridStore((state) => state.undoEdit);
  const editingCell = useResultGridStore((state) => state.editingCell);
  const setEditingCell = useResultGridStore((state) => state.setEditingCell);
  const selectedCell = useResultGridStore((state) => state.selectedCell);
  const setSelectedCell = useResultGridStore((state) => state.setSelectedCell);
  const selectedRange = useResultGridStore((state) => state.selectedRange);
  const setSelectedRange = useResultGridStore(
    (state) => state.setSelectedRange,
  );
  const selectedRowKey = useResultGridStore((state) => state.selectedRowKey);
  const setSelectedRowKey = useResultGridStore(
    (state) => state.setSelectedRowKey,
  );
  const committing = useResultGridStore((state) => state.committing);
  const setCommitting = useResultGridStore((state) => state.setCommitting);
  const commitError = useResultGridStore((state) => state.commitError);
  const setCommitError = useResultGridStore((state) => state.setCommitError);
  const resetGridStoreEdits = useResultGridStore((state) => state.resetEdits);
  const resetGridStoreView = useResultGridStore((state) => state.resetGridView);
  const gridRowHeight = scaledUiPixels(GRID_ROW_HEIGHT, uiZoom);
  const gridColumnWidth = scaledUiPixels(GRID_COLUMN_WIDTH, uiZoom);
  const gridGutterColumnWidth = scaledUiPixels(GRID_GUTTER_WIDTH, uiZoom);
  const gridGutterWidth = editMode ? gridGutterColumnWidth : 0;
  const {
    gridScrollTop,
    gridScrollLeft,
    gridViewportHeight,
    gridViewportWidth,
    setGridScrollTop,
    setGridScrollLeft,
    onGridScroll,
    resetGridScrollPosition,
    scrollGridCellIntoView,
  } = useResultGridScroll({
    gridRef,
    result,
    gridRowHeight,
    gridGutterWidth,
    gridColumnWidth,
    setSelectedRowKey,
    setSelectedCell,
    setSelectedRange,
  });
  const {
    sortRules,
    filtersOpen,
    setFiltersOpen,
    quickFilter,
    filterJoin,
    setFilterJoin,
    filterRules,
    updateQuickFilter,
    clearQuickFilter,
    toggleSort,
    addFilterRule,
    updateFilterRule,
    removeFilterRule,
    clearResultFilters,
  } = useResultGridFiltering({ resetGridScrollPosition });
  // Remappable keybindings: defaults merged with user overrides (localStorage).
  const [keymapOverrides, setKeymapOverrides] = useState<Keymap>(loadOverrides);
  const keymap = {
    ...resultCopyDefaultKeymap,
    ...effectiveKeymap(keymapOverrides),
  };
  const [activeKeyScope, setActiveKeyScope] =
    useState<KeybindingScope>("global");
  const [recordingCommand, setRecordingCommand] = useState<string | null>(null);
  const [recordingSequence, setRecordingSequence] = useState<string[]>([]);
  // Command palette (Ctrl/Cmd+Shift+P).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [migrationStudioOpen, setMigrationStudioOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [settingsJsonDraft, setSettingsJsonDraft] = useState("");
  const [settingsJsonError, setSettingsJsonError] = useState<string | null>(
    null,
  );
  const [jobs, setJobs] = useState<JobList>(emptyJobList);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  // ER diagram modal (rendered from metadata through our SVG layout).
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [diagramError, setDiagramError] = useState<string | null>(null);
  const [diagramSearch, setDiagramSearch] = useState("");
  const [diagramSchemaNames, setDiagramSchemaNames] = useState<string[]>([]);
  const [diagramZoom, setDiagramZoom] = useState(1);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const transientOverlayStateRef = useRef({
    workspaceMenuOpen: false,
    runMenuOpen: false,
    exportMenuOpen: false,
    filtersOpen: false,
    objectActionMenu: null as string | null,
  });
  transientOverlayStateRef.current = {
    workspaceMenuOpen,
    runMenuOpen,
    exportMenuOpen,
    filtersOpen,
    objectActionMenu,
  };
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);
  const schemaDesignerOpen = useSchemaDesignerStore((state) => state.open);
  const setSchemaDesignerOpen = useSchemaDesignerStore(
    (state) => state.setOpen,
  );
  const schemaDraft = useSchemaDesignerStore((state) => state.draft);
  const setSchemaDraft = useSchemaDesignerStore((state) => state.setDraft);
  const openBlankSchemaDesigner = useSchemaDesignerStore(
    (state) => state.openBlank,
  );
  const openObjectSchemaDesigner = useSchemaDesignerStore(
    (state) => state.openForObject,
  );
  const diagramInitializedFor = useRef<string | null>(null);
  const appendHistory = useQueryHistoryStore((state) => state.append);
  const queryHistoryMaxItems = useQueryHistoryStore((state) => state.maxItems);
  const setQueryHistoryMaxItems = useQueryHistoryStore(
    (state) => state.setMaxItems,
  );
  const queryHistoryResultRows = useQueryHistoryStore(
    (state) => state.resultRowLimit,
  );
  const setQueryHistoryResultRows = useQueryHistoryStore(
    (state) => state.setResultRowLimit,
  );
  const openQueryHistoryDialog = useQueryHistoryStore(
    (state) => state.openDialog,
  );
  const closeQueryHistoryDialog = useQueryHistoryStore(
    (state) => state.closeDialog,
  );
  const queryHistoryDialogOpen = useQueryHistoryStore((state) => state.open);
  const [queryParameterMemory, setQueryParameterMemory] =
    useState<QueryParameterMemory>(loadQueryParameterMemory);
  const [pendingQueryParameters, setPendingQueryParameters] =
    useState<PendingQueryParameters | null>(null);
  const [parameterDraftValues, setParameterDraftValues] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    workspaceSnapshot()
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setActiveConnectionId(nextSnapshot.activeConnectionId);
      })
      .catch(() => {
        setSnapshot(fallbackSnapshot);
      });
  }, []);

  useEffect(() => {
    if (settingsOpen && settingsTab === "jobs") {
      void refreshJobs();
    }
  }, [settingsOpen, settingsTab]);

  useEffect(() => {
    window.localStorage.setItem(
      queryParameterMemoryStorageKey,
      JSON.stringify(queryParameterMemory),
    );
  }, [queryParameterMemory]);

  useEffect(() => {
    return () => {
      if (actionNoticeTimerRef.current !== null) {
        window.clearTimeout(actionNoticeTimerRef.current);
      }
    };
  }, []);

  const connections = useMemo(() => {
    const byId = new Map<string, WorkspaceConnection>();
    snapshot.connections.forEach((connection) => {
      byId.set(connection.id, connection);
    });
    Object.values(liveConnections).forEach((connection) => {
      byId.set(connection.id, connection);
    });
    return Array.from(byId.values()).map((connection) => ({
      ...connection,
      status: connectedIds.has(connection.id) ? "connected" : connection.status,
    }));
  }, [connectedIds, liveConnections, snapshot.connections]);
  const connectionById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  );
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );
  const filteredProfiles = useMemo(() => {
    const needle = connectionSearch.trim().toLowerCase();
    if (!needle) {
      return profiles;
    }
    return profiles.filter((profile) =>
      `${profile.name} ${profile.id} ${engineLabel(profile.engine)} ${profile.host} ${profile.database} ${profile.url}`
        .toLowerCase()
        .includes(needle),
    );
  }, [connectionSearch, profiles]);

  const activeConnection = useMemo(
    () =>
      connections.find((item) => item.id === activeConnectionId) ??
      connections[0],
    [activeConnectionId, connections],
  );
  const activeProfile = profiles.find(
    (profile) => profile.id === activeConnectionId,
  );
  const activeEngine = activeProfile?.engine ?? draft.engine;
  const editorSplitOpen = editorSplitMode !== "single";
  const activeConnectionOpen = connectedIds.has(activeConnectionId);
  const activeConnectionReadOnly = activeProfile?.readOnly ?? false;
  const activeConnectionColor =
    activeProfile?.color ||
    profileById.get(activeConnectionId)?.color ||
    defaultConnectionColor;
  const activeConnectionStatus = activeConnectionOpen
    ? `${activeConnectionReadOnly ? "Read-only · " : ""}Connected · ${activeConnection.latencyMs} ms`
    : "Disconnected";
  const activeTransportLabel =
    activeConnection.proxy === "direct"
      ? "Direct connection"
      : activeConnection.proxy || "Transport not configured";

  const activeMetadata = metadataByConnection[activeConnectionId];
  const activeMetadataLoading = metadataLoading.has(activeConnectionId);
  const activeMetadataError = metadataErrors[activeConnectionId];
  const completionHints = useMemo(
    () => completionHintsFromMetadata(activeMetadata),
    [activeMetadata],
  );

  function activeEditorApi() {
    if (editorSplitOpen && activeEditorGroup === "secondary") {
      return secondaryEditorApiRef.current ?? editorApiRef.current;
    }
    return editorApiRef.current;
  }

  function activeEditorSelections() {
    return activeEditorApi()?.getSelections() ?? [...editorSelections];
  }

  function activeMainEditorSelection(): EditorSelection {
    return (
      activeEditorApi()?.getSelection() ??
      editorSelections[0] ?? { from: 0, to: 0 }
    );
  }

  function selectedSqlFromSelections(
    sql: string,
    selections: readonly EditorSelection[],
  ) {
    return selections
      .filter((selection) => selection.from !== selection.to)
      .map((selection) =>
        sql
          .slice(
            Math.min(selection.from, selection.to),
            Math.max(selection.from, selection.to),
          )
          .trim(),
      )
      .filter(Boolean)
      .join("\n\n");
  }

  const availableDiagramSchemas = useMemo(
    () =>
      activeMetadata?.schemas
        .filter((schema) =>
          schema.objects.some((object) => object.kind === "table"),
        )
        .map((schema) => schema.name) ?? [],
    [activeMetadata],
  );
  const diagramModel = useMemo(
    () =>
      activeMetadata
        ? buildErdModel(activeMetadata, {
            schemaNames: diagramSchemaNames,
            search: diagramSearch,
          })
        : null,
    [activeMetadata, diagramSchemaNames, diagramSearch],
  );
  const diagramLayout = useMemo<ErdLayout | null>(
    () => (diagramModel ? layoutErdModel(diagramModel) : null),
    [diagramModel],
  );
  const diagramSvgStyle = useMemo(() => erdSvgStyle(theme), [theme]);
  const diagramMermaid = useMemo(
    () => (activeMetadata ? toMermaidErd(activeMetadata) : ""),
    [activeMetadata],
  );

  useEffect(() => {
    if (
      activeConnectionOpen &&
      !activeMetadata &&
      !activeMetadataLoading &&
      !activeMetadataError
    ) {
      void refreshObjects(activeConnectionId);
    }
  }, [
    activeConnectionId,
    activeConnectionOpen,
    activeMetadata,
    activeMetadataError,
    activeMetadataLoading,
  ]);

  // Dialect for the editor: prefer the active connection's profile engine,
  // then the connection-form draft, then Postgres.
  const editorEngine = useMemo<DbEngine>(() => {
    const profile = profiles.find((item) => item.id === activeConnectionId);
    return profile?.engine ?? draft.engine ?? "postgres";
  }, [profiles, activeConnectionId, draft.engine]);

  const selectedEditorSql = selectedSqlFromSelections(query, editorSelections);
  const hasSelectedEditorSql = selectedEditorSql.length > 0;
  const runPrimaryLabel = hasSelectedEditorSql
    ? "Run Selection"
    : "Run Current";
  const runShortcutLabel = formatKeySequence(keymap["query.run"] ?? "");
  const runCurrentShortcutLabel = formatKeySequence(
    keymap["query.runCurrent"] ?? "",
  );
  const runFromStartShortcutLabel = formatKeySequence(
    keymap["query.runFromStart"] ?? "",
  );
  const runAllShortcutLabel = formatKeySequence(keymap["query.runAll"] ?? "");
  const shortcutTip = (label: string, commandId: string) => ({
    label,
    shortcut: formatKeySequence(keymap[commandId] ?? "") || null,
  });
  const resultShortcutTips = [
    shortcutTip("New Tab", "tab.new"),
    shortcutTip("Show Commands", "palette.open"),
    shortcutTip("Export CSV", "result.export"),
    shortcutTip("Copy TSV", "result.copyVisible"),
    shortcutTip("Toggle Edit Data", "edit.toggle"),
    shortcutTip("Add Row", "edit.addRow"),
    shortcutTip("Undo Edit", "edit.undo"),
    shortcutTip("Commit Edits", "edit.commit"),
  ];

  const resultSets = useMemo<QueryResultSet[]>(() => {
    if (!result) {
      return [];
    }
    if (result.resultSets && result.resultSets.length > 0) {
      return result.resultSets;
    }
    return [
      {
        statementIndex: 0,
        statement: "statement 1",
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
        elapsedMs: result.elapsedMs,
        truncated: result.truncated,
        message: result.message,
      },
    ];
  }, [result]);
  const activeResultIndexView = Math.min(
    activeResultIndex,
    Math.max(0, resultSets.length - 1),
  );
  const activeResult = resultSets[activeResultIndexView] ?? null;

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.scrollTop = 0;
      gridRef.current.scrollLeft = 0;
    }
    setGridScrollTop(0);
    setGridScrollLeft(0);
    setSelectedRowKey(null);
    setSelectedCell(null);
    setSelectedRange(null);
  }, [activeResultIndexView, result]);

  const resultColumns = activeResult?.columns ?? [];
  const graphResultModel = useMemo(() => {
    if (
      (editorEngine !== "neo4j" && editorEngine !== "memgraph") ||
      !activeResult ||
      spillInfo
    ) {
      return null;
    }
    const rows = activeResult.rows
      .slice(0, 500)
      .filter((row): row is unknown[] => Array.isArray(row));
    if (rows.length === 0) {
      return null;
    }
    const model = buildGraphResultModel(activeResult.columns, rows);
    return model.nodes.length > 0 || model.edges.length > 0 ? model : null;
  }, [activeResult, editorEngine, spillInfo]);
  const graphAvailable = Boolean(graphResultModel);
  const webGlAvailable = Boolean(activeResult && resultColumns.length > 0);
  // Resolve which table the active result came from so foreign-key cells become
  // navigable in the row-detail drawer. Falls back to column matching; a null table
  // simply disables FK links while the rest of the detail view still works.
  const rowDetailTable = findTableMetadata(
    activeMetadata,
    parseSourceTable(query),
    resultColumns,
  );
  // The raw (unformatted) values of the selected original row. Staged "new" rows
  // (keys starting with "n") have no backing result row, so they have no detail view.
  const selectedRowValues =
    activeResult && selectedRowKey && selectedRowKey.startsWith("o")
      ? (activeResult.rows[Number(selectedRowKey.slice(1))] ?? null)
      : null;
  const gridTotalWidth = Math.max(
    1,
    gridGutterWidth + resultColumns.length * gridColumnWidth,
  );
  const columnWindow = calculateResultGridVirtualColumnWindow({
    columnCount: resultColumns.length,
    scrollLeft: Math.max(0, gridScrollLeft - gridGutterWidth),
    viewportWidth: Math.max(0, gridViewportWidth - gridGutterWidth),
    columnWidth: gridColumnWidth,
    overscan: GRID_COLUMN_OVERSCAN,
  });
  const firstVisibleColumn = columnWindow.firstColumnIndex;
  const lastVisibleColumn = columnWindow.lastColumnIndex;
  const visibleColumnIndexes = Array.from(
    { length: Math.max(0, lastVisibleColumn - firstVisibleColumn) },
    (_, index) => firstVisibleColumn + index,
  );
  const leftColumnPad = columnWindow.leftPadPx;
  const rightColumnPad = columnWindow.rightPadPx;
  // In Edit Data mode a leading gutter column holds the per-row delete control.
  const gridTemplateColumns = [
    editMode ? `${gridGutterColumnWidth}px` : null,
    leftColumnPad > 0 ? `${leftColumnPad}px` : null,
    ...visibleColumnIndexes.map(() => `${gridColumnWidth}px`),
    rightColumnPad > 0 ? `${rightColumnPad}px` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const gridRowStyle: CSSProperties = {
    gridTemplateColumns,
    minWidth: gridTotalWidth,
    width: gridTotalWidth,
  };

  // Build the display rows from raw results plus staged edits, filters, and sort.
  // A disk-offloaded result (EXEC-010) forces the windowed path with empty
  // edits/filters/sort: its rows live on disk, so it is browse-only here and reads
  // through the `db_result_window` proxy. `gridWindowVersion` re-runs this as pages
  // arrive. Client-side sort/filter/edit over a spilled result need server-side
  // EXEC-005A / run-to-file EXEC-008 and are intentionally disabled.
  const spilled = spillInfo !== null;
  const resultGridView = useMemo(
    () =>
      buildResultGridViewModel(
        {
          rows: activeResult?.rows ?? [],
          cellEdits: spilled ? EMPTY_CELL_EDITS : cellEdits,
          newRows: spilled ? EMPTY_NEW_ROWS : newRows,
          deletedRows: spilled ? EMPTY_DELETED_ROWS : deletedRows,
          filterRules: spilled ? EMPTY_FILTER_RULES : filterRules,
          quickFilter: spilled ? "" : quickFilter,
          filterJoin,
          sortRules: spilled ? EMPTY_SORT_RULES : sortRules,
        },
        {
          windowedRowThreshold: spilled ? 0 : GRID_WINDOWED_ROW_THRESHOLD,
          windowedCellThreshold: spilled ? 0 : GRID_WINDOWED_CELL_THRESHOLD,
        },
      ),
    [
      activeResult?.rows,
      cellEdits,
      newRows,
      deletedRows,
      filterRules,
      quickFilter,
      filterJoin,
      sortRules,
      spilled,
      gridWindowVersion,
    ],
  );
  const {
    activeFilters,
    filteredOutCount,
    filtersActive,
    pendingCount,
    sortRuleByColumn,
    totalRowCount,
    unfilteredRowCount,
  } = resultGridView;

  useEffect(() => {
    if (pendingCount === 0) {
      return;
    }
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const interceptRefresh = (event: KeyboardEvent) => {
      if (!isPrimaryRefreshShortcut(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const discard = window.confirm(
        `Discard ${pendingCount} unsaved result change${pendingCount === 1 ? "" : "s"} and reload?`,
      );
      if (!discard) {
        showActionNotice(
          "info",
          "Reload cancelled",
          "Use Save Changes or Discard before refreshing.",
        );
        return;
      }
      resetEdits();
      window.location.reload();
    };
    window.addEventListener("beforeunload", preventUnload);
    window.addEventListener("keydown", interceptRefresh, { capture: true });
    return () => {
      window.removeEventListener("beforeunload", preventUnload);
      window.removeEventListener("keydown", interceptRefresh, {
        capture: true,
      });
    };
  }, [pendingCount]);

  const {
    selectedRangeBounds,
    selectionSummary,
    selectGridCell,
    selectGridRow,
    moveSelectedCell,
    selectedDisplayRow,
    selectedRowForCopy,
    selectedGridCopyText,
  } = useResultGridSelection({
    resultGridView,
    resultColumns,
    gridRef,
    totalRows: totalRowCount,
    selectedCell,
    selectedRange,
    selectedRowKey,
    setSelectedCell,
    setSelectedRange,
    setSelectedRowKey,
    scrollGridCellIntoView,
    copyCellsForRow,
  });
  const selectionStatus = selectionSummary
    ? formatResultSelectionStatus(selectionSummary)
    : null;
  const biOpen =
    viewVisibility.bi &&
    (viewPlacements.bi === "right" ? rightSidebarOpen : sidebarOpen);

  const chartCandidateAvailable =
    Boolean(activeResult) && !spillInfo && resultColumns.length > 0;
  const chartResultModel = useMemo(() => {
    if (!chartCandidateAvailable || !activeResult || spillInfo) {
      return null;
    }
    if (
      resultGridView.windowed &&
      resultMode !== "chart" &&
      !biOpen
    ) {
      return null;
    }
    const rows = resultGridView
      .rowsInRange(0, Math.min(resultGridView.totalRowCount, 5_000))
      .map((row) => row.cells);
    if (rows.length === 0) {
      return null;
    }
    const model = buildChartResultModel(resultColumns, rows);
    return model.defaultSelection ? model : null;
  }, [
    activeResult,
    biOpen,
    chartCandidateAvailable,
    resultColumns,
    resultGridView,
    resultMode,
    spillInfo,
  ]);
  const chartAvailable = resultGridView.windowed
    ? chartCandidateAvailable
    : Boolean(chartResultModel);

  // Virtualize the result grid: render only the rows in (and just around) the
  // viewport, with top/bottom spacers preserving the scrollbar. A 10k-row page is
  // ~30 DOM rows instead of 10k, so streaming stays smooth.
  const totalRows = totalRowCount;
  const rowWindow = calculateResultGridVirtualRowWindow({
    rowCount: totalRows,
    scrollTop: gridScrollTop,
    viewportHeight: gridViewportHeight,
    rowHeight: gridRowHeight,
    overscan: GRID_OVERSCAN,
  });
  const firstVisible = rowWindow.firstRowIndex;
  const lastVisible = rowWindow.lastRowIndex;
  const topPad = rowWindow.topPadPx;
  const bottomPad = rowWindow.bottomPadPx;
  const visibleRows = resultGridView.rowsInRange(firstVisible, lastVisible);
  const structureObject = resultMode === "structure" ? tableViewObject : null;
  const showingStructure = Boolean(structureObject);

  useEffect(() => {
    if (resultMode === "chart" && (!chartResultModel || editMode)) {
      setResultMode("data");
    }
    if (resultMode === "graph" && !graphAvailable) {
      setResultMode("data");
    }
    if (resultMode === "webgl" && (!webGlAvailable || editMode)) {
      setResultMode("data");
    }
  }, [
    chartResultModel,
    editMode,
    graphAvailable,
    resultMode,
    setResultMode,
    webGlAvailable,
  ]);

  // EXEC-010: fetch the disk pages the visible range needs, ingest them into the
  // LRU source, and bump the version so the grid repaints with real cells. The LRU
  // budget keeps resident rows flat no matter how far the user scrolls.
  useEffect(() => {
    const spill = spillRef.current;
    if (!spill || !spillInfo || spillInfo.handle !== spill.handle) {
      return;
    }
    const requests = spill.source.missingPages(firstVisible, lastVisible);
    if (requests.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const request of requests) {
        if (cancelled || pendingPagesRef.current.has(request.pageIndex)) {
          continue;
        }
        pendingPagesRef.current.add(request.pageIndex);
        try {
          const page = await dbResultWindow(
            spill.handle,
            request.offset,
            request.limit,
          );
          if (cancelled) {
            return;
          }
          spill.source.ingest(Number(page.offset), page.rows);
          bumpGridWindowVersion();
        } catch {
          // Leave the rows as placeholders; a later scroll retries the page.
        } finally {
          pendingPagesRef.current.delete(request.pageIndex);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spillInfo, firstVisible, lastVisible, gridWindowVersion]);

  function selectResultSet(index: number) {
    setActiveResultIndex(index);
    resetEdits();
    resetGridView();
    resetGridScrollPosition(true);
  }

  // Drop every staged edit (called on a new run and after a successful commit).
  function resetEdits() {
    resetGridStoreEdits();
  }

  function resetGridView() {
    resetGridStoreView();
  }

  // EXEC-010: drop the active disk-offloaded result and ask the backend to remove
  // its temp file. Safe to call when nothing is spilled.
  function releaseActiveSpill() {
    const previous = spillRef.current;
    spillRef.current = null;
    pendingPagesRef.current.clear();
    if (previous) {
      void dbReleaseResult(previous.handle).catch(() => {});
    }
    setSpillInfo(null);
    setGridWindowVersion(0);
  }

  function beginCellEdit(key: string, col: number, seed?: string) {
    if (!editMode) {
      return;
    }
    selectGridCell(key, col);
    setEditingCell(seed === undefined ? { key, col } : { key, col, seed });
  }

  function applyCellValueToDraft(
    draft: ResultGridEditDraft,
    origin: ResultGridRowOrigin,
    col: number,
    value: GridCellDraft,
  ): ResultGridEditDraft {
    if (col < 0 || col >= resultColumns.length) {
      return draft;
    }
    if (origin.kind === "orig") {
      const cellEdits = new Map(draft.cellEdits);
      const key = `o${origin.index}:${col}`;
      const originalRaw = activeResult?.rows[origin.index]?.[col] ?? null;
      const unchanged =
        value === null
          ? originalRaw === null
          : value === formatCell(originalRaw);
      if (unchanged) {
        cellEdits.delete(key);
      } else {
        cellEdits.set(key, value);
      }
      return { ...draft, cellEdits };
    }

    if (!draft.newRows[origin.index]) {
      return draft;
    }
    const newRows = draft.newRows.map((row, index) => {
      if (index !== origin.index) {
        return row;
      }
      const next = [...row];
      next[col] = value;
      return next;
    });
    return { ...draft, newRows };
  }

  // Stage a single cell's new value against its origin (an original row keeps the
  // edit in `cellEdits`; a staged new row mutates `newRows`).
  function setCellValue(
    origin: ResultGridRowOrigin,
    col: number,
    value: GridCellDraft,
  ) {
    updateEditDraft((draft) =>
      applyCellValueToDraft(draft, origin, col, value),
    );
  }

  function addNewRow() {
    if (!canEditActiveResult()) {
      setCommitError(
        "result editing needs a single table query with a visible key",
      );
      return;
    }
    updateEditDraft((draft) => ({
      ...draft,
      newRows: [...draft.newRows, resultColumns.map(() => "")],
    }));
    setEditMode(true);
  }

  // Stage a row delete (original rows) or drop a staged new row.
  function deleteRow(origin: ResultGridRowOrigin) {
    const rowKey = resultGridRowKey(origin);
    updateEditDraft((draft) => {
      if (origin.kind === "orig") {
        const deletedRows = new Set(draft.deletedRows).add(origin.index);
        const cellEdits = new Map(draft.cellEdits);
        for (const key of [...cellEdits.keys()]) {
          if (key.startsWith(`o${origin.index}:`)) {
            cellEdits.delete(key);
          }
        }
        return { ...draft, cellEdits, deletedRows };
      }
      return {
        ...draft,
        newRows: draft.newRows.filter((_, index) => index !== origin.index),
      };
    });
    setEditingCell(null);
    setSelectedRowKey((current) => (current === rowKey ? null : current));
    setSelectedRange(null);
  }

  // Paste a TSV/CSV block starting at `origin`/`startCol`, spilling across columns
  // and into staged new rows as needed.
  function pasteTableAt(
    origin: ResultGridRowOrigin,
    startCol: number,
    text: string,
  ) {
    const block = parseClipboardTable(text);
    if (block.length === 0) {
      return;
    }
    const startPos = resultGridView.displayIndexForKey(
      resultGridRowKey(origin),
    );
    if (startPos < 0) {
      return;
    }
    updateEditDraft((draft) => {
      let nextDraft = draft;
      block.forEach((cells, rowOffset) => {
        const target = resultGridView.rowAt(startPos + rowOffset)?.origin;
        if (target) {
          cells.forEach((value, colOffset) => {
            nextDraft = applyCellValueToDraft(
              nextDraft,
              target,
              startCol + colOffset,
              value,
            );
          });
          return;
        }
        const newRow = resultColumns.map((_, col) => {
          const colOffset = col - startCol;
          return colOffset >= 0 && colOffset < cells.length
            ? cells[colOffset]
            : "";
        });
        nextDraft = {
          ...nextDraft,
          newRows: [...nextDraft.newRows, newRow],
        };
      });
      return nextDraft;
    });
    setEditMode(true);
  }

  function undoLastEdit() {
    if (!editMode || editUndoDepth === 0 || showingStructure) {
      return;
    }
    if (undoEdit()) {
      setEditMode(true);
      showActionNotice("info", "Edit undone", "Reverted the last staged edit");
    }
  }

  function copyCellsForRow(row: ResultGridRowLike): string[] {
    return resultColumns.map((_, index) => row.cells[index] ?? "");
  }

  async function copyGridText(text: string | null) {
    if (text === null) {
      showActionNotice("info", "Nothing to copy");
      return;
    }
    try {
      await writeTextToClipboard(text);
      showActionNotice("success", "Copied", "Selection copied to clipboard");
    } catch (error) {
      const message = errorMessage(error);
      setQueryError(message);
      showActionNotice("error", "Copy failed", message);
    }
  }

  async function copySelectedGridCellOrRow() {
    if (editingCell) {
      return;
    }
    await copyGridText(selectedGridCopyText());
  }

  async function copySelectedGridRow() {
    if (editingCell) {
      return;
    }
    const row = selectedRowForCopy();
    await copyGridText(
      row ? formatResultGridTsvRow(copyCellsForRow(row)) : null,
    );
  }

  async function copyVisibleResult() {
    const errorResult = activeResult ? null : errorResultSetForExport();
    if (errorResult) {
      await copyGridText(
        formatResultGridTsv(errorResult.columns, [
          {
            cells: errorResult.rows[0]?.map((cell) => String(cell ?? "")) ?? [],
          },
        ]),
      );
      return;
    }
    if (editingCell || resultColumns.length === 0) {
      return;
    }
    if (totalRows > GRID_COPY_ROW_LIMIT) {
      setQueryError(
        `Copy is capped at ${toCount(GRID_COPY_ROW_LIMIT)} displayed rows; use Export for larger results.`,
      );
      return;
    }
    await copyGridText(
      formatResultGridTsv(
        resultColumns,
        resultGridView.rowsInRange(0, totalRows),
      ),
    );
  }

  function onGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ||
      editingCell
    ) {
      return;
    }
    const row = selectedDisplayRow() ?? resultGridView.rowAt(0);
    const col = selectedCell?.col ?? 0;
    if (!row || resultColumns.length === 0) {
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelectedCell(-1, 0, event.shiftKey);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelectedCell(1, 0, event.shiftKey);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelectedCell(0, -1, event.shiftKey);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSelectedCell(0, 1, event.shiftKey);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveSelectedCell(0, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      if (editMode) {
        event.preventDefault();
        beginCellEdit(row.key, col);
      }
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && editMode) {
      event.preventDefault();
      setCellValue(row.origin, col, event.ctrlKey || event.metaKey ? null : "");
      return;
    }
    if (
      editMode &&
      event.key.length === 1 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      beginCellEdit(row.key, col, event.key);
    }
  }

  function onGridPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    if (!editMode) {
      return;
    }
    const row = selectedDisplayRow();
    if (!row || !selectedCell) {
      return;
    }
    event.preventDefault();
    pasteTableAt(
      row.origin,
      selectedCell.col,
      event.clipboardData.getData("text"),
    );
  }

  function onGridCopy(event: ReactClipboardEvent<HTMLDivElement>) {
    if (editingCell || isEditableTarget(event.target)) {
      return;
    }
    const text = selectedGridCopyText();
    if (text === null) {
      return;
    }
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  }

  function inferEditTarget(): ResultEditTarget | null {
    return deriveResultEditTarget({
      sql: lastRunSql,
      metadata: metadataByConnection[activeConnectionId],
      resultColumns,
    });
  }

  function canEditActiveResult(): boolean {
    return !activeConnectionReadOnly && Boolean(result && inferEditTarget());
  }

  function generateSelectedRowChangeSql() {
    if (activeConnectionReadOnly) {
      const message = "read-only connection: data edits are blocked";
      setCommitError(message);
      showActionNotice("error", "Row SQL blocked", message);
      return;
    }
    const target = inferEditTarget();
    if (!target) {
      const message =
        "row SQL needs a single-table result with a visible primary or unique key";
      setCommitError(message);
      showActionNotice("error", "Row SQL unavailable", message);
      return;
    }
    if (!selectedRowValues) {
      showActionNotice("info", "Select a row first");
      return;
    }
    const sql = buildSelectedRowChangeSql({
      engine: activeEngine,
      target,
      columns: resultColumns,
      row: selectedRowValues,
    });
    activeEditorApi()?.insertText(`\n${sql}\n`);
    activeEditorApi()?.focus();
    showActionNotice(
      "success",
      "Row SQL generated",
      "Review the transaction in the SQL editor before running it",
    );
  }

  function originalCell(rowIndex: number, column: string): CellValue {
    const col = resultColumns.indexOf(column);
    return { column, value: activeResult?.rows[rowIndex]?.[col] ?? null };
  }

  async function commitEdits() {
    if (activeConnectionReadOnly) {
      const message = "read-only connection: data edits are blocked";
      setCommitError(message);
      showActionNotice("error", "Commit failed", message);
      return;
    }
    const target = inferEditTarget();
    if (!target) {
      const message =
        "could not detect an editable target table from the query";
      setCommitError(message);
      showActionNotice("error", "Commit failed", message);
      return;
    }
    const updates: RowUpdate[] = [];
    const editedByRow = new Map<number, number[]>();
    for (const key of cellEdits.keys()) {
      const [rowPart, colPart] = key.split(":");
      const rowIndex = Number(rowPart.slice(1));
      const list = editedByRow.get(rowIndex) ?? [];
      list.push(Number(colPart));
      editedByRow.set(rowIndex, list);
    }
    for (const [rowIndex, cols] of editedByRow) {
      updates.push({
        keys: target.keyColumns.map((column) => originalCell(rowIndex, column)),
        set: cols.map((col) => ({
          column: resultColumns[col],
          value:
            cellEdits.get(`o${rowIndex}:${col}`) === undefined
              ? null
              : cellEdits.get(`o${rowIndex}:${col}`)!,
        })),
      });
    }
    const inserts: RowInsert[] = newRows
      .filter((row) => row.some((cell) => cell !== ""))
      .map((row) => ({
        values: resultColumns
          .map((column, col) => ({ column, value: row[col] }))
          .filter((cell) => cell.value !== ""),
      }));
    const deletes: RowDelete[] = [...deletedRows].map((rowIndex) => ({
      keys: target.keyColumns.map((column) => originalCell(rowIndex, column)),
    }));
    const edits: TableEdits = {
      schema: target.schema,
      table: target.table,
      updates,
      inserts,
      deletes,
    };

    setCommitting(true);
    setCommitError(null);
    try {
      await dbApplyEdits(activeConnectionId, edits);
      resetEdits();
      setEditMode(false);
      // Re-run the last query so the grid shows the committed state.
      await runQuery();
      showActionNotice(
        "success",
        "Edits committed",
        `${toCount(updates.length)} updates, ${toCount(inserts.length)} inserts, ${toCount(deletes.length)} deletes`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setCommitError(message);
      showActionNotice("error", "Commit failed", message);
    } finally {
      setCommitting(false);
    }
  }

  // Run a command by id (the keybinding handler and the Commands list share this).
  function closeActiveSqlTab(group: EditorGroup = activeEditorGroup) {
    const state = editorGroupStates[group];
    const groupOpenTabs = openTabsForEditorGroup(state);
    const activeIndex = groupOpenTabs.findIndex(
      (tab) => tab.id === state.activeTabId,
    );
    if (groupOpenTabs.length <= 1 || activeIndex < 0) {
      showActionNotice(
        "info",
        "Tab kept open",
        "The last SQL tab stays open so Ctrl+W never closes the browser tab.",
      );
      return;
    }
    const closedTab = groupOpenTabs[activeIndex];
    const nextTab =
      groupOpenTabs[activeIndex + 1] ??
      groupOpenTabs[activeIndex - 1] ??
      groupOpenTabs[0];
    updateEditorGroupState(group, (current) => ({
      ...current,
      openTabIds: current.openTabIds.filter((id) => id !== closedTab.id),
      activeTabId: nextTab.id,
    }));
    showActionNotice("info", "Tab closed", closedTab.label);
  }

  function reopenSqlTab(group: EditorGroup = activeEditorGroup) {
    const state = editorGroupStates[group];
    const closedTab = tabs.find((tab) => !state.openTabIds.includes(tab.id));
    if (!closedTab) {
      showActionNotice("info", "Tabs already open");
      return;
    }
    setActiveEditorGroup(group);
    updateEditorGroupState(group, (current) => ({
      ...current,
      openTabIds: [...current.openTabIds, closedTab.id],
      activeTabId: closedTab.id,
    }));
    showActionNotice("success", "Tab restored", closedTab.label);
  }

  function updateUiZoom(nextZoom: number) {
    const normalized = normalizeUiZoom(nextZoom);
    setUiZoom(normalized);
    showActionNotice("info", "UI zoom", formatUiZoom(normalized));
  }

  const runCommand = createWorkbenchCommandHandler({
    editMode,
    openPalette: () => {
      setPaletteQuery("");
      setPaletteOpen(true);
    },
    openSettings: () => openSettingsSection("general"),
    openKeymap: () => openSettingsSection("keymap"),
    openHistory: openQueryHistoryDialog,
    openGit: openGitPanel,
    openHelp: () => setAboutOpen(true),
    openDeveloperTools: () => void openAppDeveloperTools(),
    openConnectionManager: () => setConnectionManagerOpen(true),
    openMigrationStudio: () => setMigrationStudioOpen(true),
    openDiagram: () => setDiagramOpen(true),
    toggleTheme: () =>
      activateBuiltInTheme((kind) => (kind === "dark" ? "light" : "dark")),
    toggleSidebar: () => setSidebarOpen((open) => !open),
    toggleCompletion: () => toggleSidebarView("completion"),
    toggleHistory: () => toggleSidebarView("queryHistory"),
    togglePlan: () => toggleSidebarView("plan"),
    toggleBi: () => toggleSidebarView("bi"),
    zoomIn: () => updateUiZoom(uiZoom + UI_ZOOM_STEP),
    zoomOut: () => updateUiZoom(uiZoom - UI_ZOOM_STEP),
    zoomReset: () => updateUiZoom(UI_ZOOM_DEFAULT),
    newSqlTab: reopenSqlTab,
    closeActiveTab: closeActiveSqlTab,
    saveQuery: saveCurrentQuery,
    saveQueryAs: saveCurrentQueryAsFile,
    exitApp: exitApplication,
    runQuery,
    runCurrentQuery,
    runFromStartQuery,
    runAllQuery,
    explainPlan: () => explainCurrentQuery("plan"),
    explainAnalyze: () => explainCurrentQuery("analyze"),
    cancelQuery,
    focusEditor: () => activeEditorApi()?.focus(),
    formatQuery,
    quickDefinition: () => activeEditorApi()?.quickDefinition(),
    showEditorQuickFix,
    cleanupQuery,
    toggleEditorComment: () => activeEditorApi()?.toggleComment(),
    indentEditorSelection,
    outdentEditorSelection,
    transformEditorSelection,
    exportCsv: () => exportActiveResult("csv"),
    exportSqlInserts: () => exportActiveResult("sql"),
    copySqlInserts: copyActiveResultSqlInserts,
    copySelectedGridCellOrRow,
    copySelectedGridRow,
    copyVisibleResult,
    canEditActiveResult,
    setEditMode,
    setCommitError,
    addNewRow,
    undoLastEdit,
    commitEdits,
    generateSql: () => setAiGenerateOpen(true),
    toggleTerminal: () => setTerminalOpen((open) => !open),
    toggleAiChat: () => toggleSidebarView("aiChat"),
    toggleSearch: () => toggleSidebarView("searchReplace"),
    searchInAllTabs: () => {
      const selection = activeEditorApi()?.getSelection();
      const selected =
        selection && selection.to > selection.from
          ? query.slice(selection.from, selection.to)
          : "";
      useSearchStore.getState().openWith(selected);
      setActiveSidebarView("searchReplace");
    },
  });

  const keymapConflicts = findConflicts(keymap, appCommandCatalog);
  const vimKeymapConflicts = findVimKeybindingConflicts(
    keymap,
    appCommandCatalog,
  );
  const paletteResults = appCommandCatalog.filter((command) =>
    `${command.title} ${command.category}`
      .toLowerCase()
      .includes(paletteQuery.trim().toLowerCase()),
  );

  function activateBuiltInTheme(
    value: ThemeKind | ((kind: ThemeKind) => ThemeKind),
  ) {
    const nextThemeKind =
      typeof value === "function" ? value(themeKind) : value;
    setThemeKind(nextThemeKind);
    setActiveDefaultThemeId(
      defaultThemeEntryForKind(nextThemeKind, activeDefaultThemeId)?.id ?? null,
    );
    setActiveCustomThemeId(null);
  }

  function activateThemePreference(value: ThemePreference) {
    setThemePreference(value);
    setActiveCustomThemeId(null);
  }

  function activateDefaultTheme(themeId: string | null) {
    const entry = defaultThemeById(themeId);
    if (!entry) {
      setActiveDefaultThemeId(
        defaultThemeEntryForKind(themeKind, activeDefaultThemeId)?.id ?? null,
      );
      setActiveCustomThemeId(null);
      return;
    }
    setThemeKind(entry.kind);
    setActiveDefaultThemeId(entry.id);
    setActiveCustomThemeId(null);
  }

  function activateCustomTheme(themeId: string | null) {
    if (!themeId) {
      setActiveCustomThemeId(null);
      return;
    }
    const entry = customThemes.find(
      (customTheme) => customTheme.id === themeId,
    );
    if (!entry) {
      setActiveCustomThemeId(null);
      return;
    }
    setThemeKind(entry.theme.kind);
    setActiveCustomThemeId(entry.id);
  }

  function buildSettingsJson() {
    return JSON.stringify(
      {
        version: 1,
        locale,
        theme: activeCustomTheme?.theme ?? themePreference,
        defaultThemeId: activeDefaultTheme?.id ?? activeDefaultThemeId,
        activeCustomThemeId,
        customThemes,
        editor: {
          animationsEnabled,
          vimMode,
          autoCommit,
          formatter,
          linter: sqlLinter,
          snippets: sqlSnippets,
          backgroundImage: editorBackgroundImage,
          backgroundOpacity: editorBackgroundOpacity,
        },
        queryHistory: {
          maxItems: queryHistoryMaxItems,
          resultRows: queryHistoryResultRows,
        },
        results: {
          offloadEnabled: resultOffloadEnabled,
          memoryBudget: resultMemoryBudget,
        },
        layout: {
          uiZoom,
          sidebarOpen,
          rightSidebarOpen,
          viewPlacements,
          viewVisibility,
          sidebarWidth,
          inspectorWidth,
          resultsHeight,
        },
        activeConnectionId,
        keymapOverrides,
        connections: profiles.map(portableProfile),
      },
      null,
      2,
    );
  }

  function openSettingsSection(tab: SettingsTab) {
    setSettingsTab(tab);
    setSettingsOpen(true);
    if (tab === "json") {
      setSettingsJsonDraft(buildSettingsJson());
      setSettingsJsonError(null);
    }
  }

  function setVimMode(value: boolean) {
    setStoredVimMode(value);
    if (value) {
      openSettingsSection("keymap");
    }
  }

  async function refreshJobs() {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const next = await jobsList();
      setJobs(next);
    } catch (error) {
      const message = errorMessage(error);
      setJobsError(message);
      setJobs(emptyJobList);
    } finally {
      setJobsLoading(false);
    }
  }

  function resetSettingsJsonDraft() {
    setSettingsJsonDraft(buildSettingsJson());
    setSettingsJsonError(null);
    showActionNotice("info", "Settings JSON reset", "Loaded current settings");
  }

  function applySettingsJson() {
    try {
      const parsed = JSON.parse(settingsJsonDraft) as unknown;
      if (!isRecord(parsed)) {
        throw new Error("settings JSON root must be an object");
      }
      if (typeof parsed.locale === "string") {
        const nextLocale = normalizeLocale(parsed.locale);
        setLocale(nextLocale);
        parsed.locale = nextLocale;
      }
      let themeNotice: string | null = null;
      let nextCustomThemes = customThemes;
      let nextActiveCustomThemeId: string | null | undefined;
      if (Array.isArray(parsed.customThemes)) {
        nextCustomThemes = [];
        for (const [index, value] of parsed.customThemes.entries()) {
          nextCustomThemes.push(
            customThemeEntryFromJson(value, index, nextCustomThemes),
          );
        }
        setCustomThemes(nextCustomThemes);
      }
      if (typeof parsed.theme === "string" && defaultThemeById(parsed.theme)) {
        const entry = defaultThemeById(parsed.theme);
        if (entry) {
          setThemeKind(entry.kind);
          setActiveDefaultThemeId(entry.id);
          setActiveCustomThemeId(null);
          parsed.theme = entry.kind;
          parsed.defaultThemeId = entry.id;
          nextActiveCustomThemeId = null;
          themeNotice = `Built-in theme: ${entry.name}`;
        }
      } else if (
        parsed.theme === "system" ||
        parsed.theme === "dark" ||
        parsed.theme === "light"
      ) {
        activateThemePreference(parsed.theme);
        nextActiveCustomThemeId = null;
      } else if (isRecord(parsed.theme)) {
        const themeSource = parsed.theme;
        const importResult = importThemeJson(themeSource, themeKind);
        const nextTheme = importResult.theme;
        parsed.theme = nextTheme;
        themeNotice =
          importResult.source === "vscode"
            ? importResult.warnings.length > 0
              ? `Converted VS Code theme: ${nextTheme.name} (${importResult.warnings.length} warning(s))`
              : `Converted VS Code theme: ${nextTheme.name}`
            : `Custom theme: ${nextTheme.name}`;
        const savedTheme = upsertCustomThemeEntry(nextCustomThemes, nextTheme);
        nextCustomThemes = savedTheme.entries;
        setCustomThemes(nextCustomThemes);
        setThemeKind(nextTheme.kind);
        setActiveCustomThemeId(savedTheme.id);
        nextActiveCustomThemeId = savedTheme.id;
        parsed.activeCustomThemeId = savedTheme.id;
        parsed.customThemes = nextCustomThemes;
      } else if (isRecord(parsed.vscodeTheme)) {
        const fallbackKind =
          parsed.theme === "light" || parsed.theme === "dark"
            ? parsed.theme
            : themeKind;
        const importResult = importThemeJson(parsed.vscodeTheme, fallbackKind);
        const savedTheme = upsertCustomThemeEntry(
          nextCustomThemes,
          importResult.theme,
        );
        nextCustomThemes = savedTheme.entries;
        setCustomThemes(nextCustomThemes);
        setThemeKind(importResult.theme.kind);
        setActiveCustomThemeId(savedTheme.id);
        parsed.theme = importResult.theme;
        parsed.activeCustomThemeId = savedTheme.id;
        parsed.customThemes = nextCustomThemes;
        delete parsed.vscodeTheme;
        nextActiveCustomThemeId = savedTheme.id;
        themeNotice =
          importResult.warnings.length > 0
            ? `Converted VS Code theme: ${importResult.theme.name} (${importResult.warnings.length} warning(s))`
            : `Converted VS Code theme: ${importResult.theme.name}`;
      } else if (
        typeof parsed.activeCustomThemeId === "string" &&
        nextCustomThemes.some(
          (entry) => entry.id === parsed.activeCustomThemeId,
        )
      ) {
        const entry = nextCustomThemes.find(
          (themeEntry) => themeEntry.id === parsed.activeCustomThemeId,
        );
        if (entry) {
          setThemeKind(entry.theme.kind);
          setActiveCustomThemeId(entry.id);
          nextActiveCustomThemeId = entry.id;
          themeNotice = `Custom theme: ${entry.name}`;
        }
      }
      if (typeof parsed.defaultThemeId === "string") {
        const entry = defaultThemeById(parsed.defaultThemeId);
        if (entry) {
          setActiveDefaultThemeId(entry.id);
          parsed.defaultThemeId = entry.id;
          if (!themeNotice) {
            themeNotice = `Built-in theme: ${entry.name}`;
          }
        }
      }
      if (
        nextActiveCustomThemeId === undefined &&
        Array.isArray(parsed.customThemes)
      ) {
        setActiveCustomThemeId(null);
      }
      if (isRecord(parsed.editor)) {
        if (typeof parsed.editor.animationsEnabled === "boolean") {
          setAnimationsEnabled(parsed.editor.animationsEnabled);
        }
        if (typeof parsed.editor.vimMode === "boolean") {
          setStoredVimMode(parsed.editor.vimMode);
        }
        if (typeof parsed.editor.autoCommit === "boolean") {
          setAutoCommit(parsed.editor.autoCommit);
        }
        if (
          typeof parsed.editor.formatter === "string" &&
          isSqlFormatterId(parsed.editor.formatter)
        ) {
          setFormatter(parsed.editor.formatter);
        }
        if (
          typeof parsed.editor.linter === "string" &&
          isSqlLinterId(parsed.editor.linter)
        ) {
          setSqlLinter(parsed.editor.linter);
        }
        if ("snippets" in parsed.editor) {
          const nextSnippets = sqlSnippetsFromJson(parsed.editor.snippets);
          setSqlSnippets(nextSnippets);
        }
        if (typeof parsed.editor.backgroundImage === "string") {
          setEditorBackgroundImage(parsed.editor.backgroundImage);
        }
        if ("backgroundOpacity" in parsed.editor) {
          const nextOpacity = Number(parsed.editor.backgroundOpacity);
          if (Number.isFinite(nextOpacity)) {
            setEditorBackgroundOpacity(nextOpacity);
            parsed.editor.backgroundOpacity =
              normalizeEditorBackgroundOpacity(nextOpacity);
          }
        }
      }
      if ("snippets" in parsed) {
        const nextSnippets = sqlSnippetsFromJson(parsed.snippets);
        setSqlSnippets(nextSnippets);
      }
      if (isRecord(parsed.queryHistory)) {
        const nextMaxItems = Number(parsed.queryHistory.maxItems);
        if (Number.isFinite(nextMaxItems)) {
          setQueryHistoryMaxItems(
            clampNumber(nextMaxItems, 0, queryHistoryMaxItemsHardLimit),
          );
        }
        const nextResultRows = Number(parsed.queryHistory.resultRows);
        if (Number.isFinite(nextResultRows)) {
          setQueryHistoryResultRows(
            clampNumber(nextResultRows, 0, queryHistoryResultRowsHardLimit),
          );
        }
      }
      if (isRecord(parsed.results)) {
        if (typeof parsed.results.offloadEnabled === "boolean") {
          setResultOffloadEnabled(parsed.results.offloadEnabled);
        }
        const nextMemoryBudget = Number(parsed.results.memoryBudget);
        if (Number.isFinite(nextMemoryBudget)) {
          setResultMemoryBudget(clampNumber(nextMemoryBudget, 1_000, 100_000));
        }
      }
      if (isRecord(parsed.layout)) {
        const nextUiZoom = Number(parsed.layout.uiZoom);
        if (Number.isFinite(nextUiZoom)) {
          setUiZoom(nextUiZoom);
          parsed.layout.uiZoom = normalizeUiZoom(nextUiZoom);
        }
        if (typeof parsed.layout.sidebarOpen === "boolean") {
          setSidebarOpen(parsed.layout.sidebarOpen);
        }
        if (typeof parsed.layout.rightSidebarOpen === "boolean") {
          setRightSidebarOpen(parsed.layout.rightSidebarOpen);
        }
        if (
          parsed.layout.sidebarSide === "left" ||
          parsed.layout.sidebarSide === "right"
        ) {
          setRightSidebarOpen(parsed.layout.sidebarSide === "right");
        }
        const viewPlacements = parsed.layout.viewPlacements;
        if (isRecord(viewPlacements)) {
          const importedPlacements: Partial<WorkbenchViewPlacements> = {};
          for (const viewId of workbenchViewIds) {
            const side = viewPlacements[viewId];
            if (side === "left" || side === "right") {
              importedPlacements[viewId] = side;
            }
          }
          setViewPlacements((current) => {
            return { ...current, ...importedPlacements };
          });
        }
        const viewVisibility = parsed.layout.viewVisibility;
        if (isRecord(viewVisibility)) {
          const importedVisibility: Partial<WorkbenchViewVisibility> = {};
          for (const viewId of workbenchViewIds) {
            const open = viewVisibility[viewId];
            if (typeof open === "boolean") {
              importedVisibility[viewId] = open;
            }
          }
          setViewVisibility((current) => {
            return { ...current, ...importedVisibility };
          });
        }
        const nextSidebarWidth = Number(parsed.layout.sidebarWidth);
        if (Number.isFinite(nextSidebarWidth)) {
          setSidebarWidth(
            clampNumber(nextSidebarWidth, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX),
          );
        }
        const nextInspectorWidth = Number(parsed.layout.inspectorWidth);
        if (Number.isFinite(nextInspectorWidth)) {
          setInspectorWidth(
            clampNumber(
              nextInspectorWidth,
              INSPECTOR_WIDTH_MIN,
              INSPECTOR_WIDTH_MAX,
            ),
          );
        }
        const nextResultsHeight = Number(parsed.layout.resultsHeight);
        if (Number.isFinite(nextResultsHeight)) {
          setResultsHeight(
            clampNumber(
              nextResultsHeight,
              RESULTS_HEIGHT_MIN,
              RESULTS_HEIGHT_MAX,
            ),
          );
        }
      }
      if (isRecord(parsed.keymapOverrides)) {
        const nextKeymap: Keymap = {};
        for (const [commandId, chord] of Object.entries(
          parsed.keymapOverrides,
        )) {
          if (typeof chord === "string") {
            nextKeymap[commandId] = chord;
          }
        }
        setKeymapOverrides(nextKeymap);
        saveOverrides(nextKeymap);
      }
      if (Array.isArray(parsed.connections)) {
        const nextProfiles = withStarterProfiles(
          withUniqueProfileIds(
            parsed.connections.map((profile, index) =>
              settingsProfileFromJson(profile, index),
            ),
          ),
        );
        if (nextProfiles.length > 0) {
          const selectedId =
            typeof parsed.activeConnectionId === "string" &&
            nextProfiles.some(
              (profile) => profile.id === parsed.activeConnectionId,
            )
              ? parsed.activeConnectionId
              : nextProfiles[0].id;
          const selectedProfile =
            nextProfiles.find((profile) => profile.id === selectedId) ??
            nextProfiles[0];
          setProfiles(nextProfiles);
          setSelectedProfileId(selectedProfile.id);
          setActiveConnectionId(selectedProfile.id);
          setDraft(selectedProfile);
        }
      }
      setSettingsJsonDraft(JSON.stringify(parsed, null, 2));
      setSettingsJsonError(null);
      showActionNotice(
        "success",
        "Settings applied",
        themeNotice ?? "JSON settings were loaded",
      );
    } catch (error) {
      const message = errorMessage(error);
      setSettingsJsonError(message);
      showActionNotice("error", "Settings JSON failed", message);
    }
  }

  async function openAppDeveloperTools() {
    try {
      await openDeveloperTools();
    } catch (error) {
      showActionNotice(
        "error",
        "Developer Tools unavailable",
        errorMessage(error),
      );
    }
  }

  function showActionNotice(
    kind: ActionNotice["kind"],
    title: string,
    detail?: string,
  ) {
    if (actionNoticeTimerRef.current !== null) {
      window.clearTimeout(actionNoticeTimerRef.current);
    }
    setActionNotice({
      id: Date.now(),
      kind,
      title,
      detail,
    });
    actionNoticeTimerRef.current = window.setTimeout(
      () => {
        setActionNotice(null);
        actionNoticeTimerRef.current = null;
      },
      kind === "error" ? 5200 : 3200,
    );
  }

  // Keep the keydown listener stable while reading the latest state via refs.
  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;
  const activeKeyScopeRef = useRef(activeKeyScope);
  activeKeyScopeRef.current = activeKeyScope;
  const recordingRef = useRef(recordingCommand);
  recordingRef.current = recordingCommand;
  const pendingKeySequenceRef = useRef<string[]>([]);
  const pendingKeyTimerRef = useRef<number | null>(null);
  const recordingSequenceRef = useRef<string[]>([]);
  const recordingTimerRef = useRef<number | null>(null);

  function clearPendingKeySequence() {
    pendingKeySequenceRef.current = [];
    if (pendingKeyTimerRef.current !== null) {
      window.clearTimeout(pendingKeyTimerRef.current);
      pendingKeyTimerRef.current = null;
    }
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function cancelRecording() {
    clearRecordingTimer();
    recordingRef.current = null;
    recordingSequenceRef.current = [];
    setRecordingCommand(null);
    setRecordingSequence([]);
  }

  function closeTransientOverlaysFromEscape() {
    const open = transientOverlayStateRef.current;
    if (
      !open.workspaceMenuOpen &&
      !open.runMenuOpen &&
      !open.exportMenuOpen &&
      !open.filtersOpen &&
      !open.objectActionMenu
    ) {
      return false;
    }
    setWorkspaceMenuOpen(false);
    setRunMenuOpen(false);
    setExportMenuOpen(false);
    setFiltersOpen(false);
    setObjectActionMenu(null);
    return true;
  }

  function commitRecordedKeybinding(
    commandId: string,
    sequence: readonly string[],
  ) {
    const chord = sequence.join(" ");
    if (!chord) {
      cancelRecording();
      return;
    }
    clearRecordingTimer();
    setKeymapOverrides((prev) => {
      const next = { ...prev, [commandId]: chord };
      saveOverrides(next);
      return next;
    });
    recordingRef.current = null;
    recordingSequenceRef.current = [];
    setRecordingCommand(null);
    setRecordingSequence([]);
  }

  function beginRecording(commandId: string) {
    if (recordingRef.current === commandId) {
      cancelRecording();
      return;
    }
    clearRecordingTimer();
    recordingRef.current = commandId;
    recordingSequenceRef.current = [];
    setRecordingCommand(commandId);
    setRecordingSequence([]);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Recording a rebind: one or two non-modifier chords become the new sequence.
      const recording = recordingRef.current;
      if (recording) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelRecording();
          return;
        }
        const chord = eventToChord(event);
        if (!chord) {
          return;
        }
        event.preventDefault();
        clearRecordingTimer();
        const next = [...recordingSequenceRef.current, chord];
        recordingSequenceRef.current = next;
        setRecordingSequence(next);
        if (next.length >= 2) {
          commitRecordedKeybinding(recording, next);
        } else {
          recordingTimerRef.current = window.setTimeout(() => {
            commitRecordedKeybinding(recording, recordingSequenceRef.current);
          }, KEY_SEQUENCE_TIMEOUT_MS);
        }
        return;
      }
      if (event.key === "Escape" && closeTransientOverlaysFromEscape()) {
        event.preventDefault();
        event.stopPropagation();
        clearPendingKeySequence();
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing && isCellEditorClipboardShortcut(event, target)) {
        return;
      }
      const scope = keyScopeFromTarget(target, activeKeyScopeRef.current);
      if (scope !== activeKeyScopeRef.current) {
        activeKeyScopeRef.current = scope;
        setActiveKeyScope(scope);
      }
      const chord = eventToChord(event);
      if (!chord) {
        return;
      }
      const map = keymapRef.current;
      const hadPending = pendingKeySequenceRef.current.length > 0;
      const resolution = resolveKeybinding({
        keymap: map,
        scope,
        chord,
        pending: pendingKeySequenceRef.current,
        commands: appCommandCatalog,
        allowBare: !typing,
      });
      if (resolution.kind === "pending") {
        event.preventDefault();
        pendingKeySequenceRef.current = resolution.pending;
        if (pendingKeyTimerRef.current !== null) {
          window.clearTimeout(pendingKeyTimerRef.current);
        }
        pendingKeyTimerRef.current = window.setTimeout(
          clearPendingKeySequence,
          KEY_SEQUENCE_TIMEOUT_MS,
        );
        return;
      }
      clearPendingKeySequence();
      if (resolution.kind === "command") {
        event.preventDefault();
        runCommandRef.current(resolution.commandId);
        return;
      }
      if (hadPending) {
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearPendingKeySequence();
      clearRecordingTimer();
    };
  }, []);

  // Initialize diagram filters per connection when the ERD modal opens.
  useEffect(() => {
    if (!diagramOpen) {
      diagramInitializedFor.current = null;
      return;
    }
    if (!activeMetadata || !hasDiagram(activeMetadata)) {
      setDiagramError(
        "No tables to diagram yet — connect and load metadata first.",
      );
      return;
    }
    setDiagramError(null);
    const initKey = `${activeConnectionId}:${activeMetadata.schemas
      .map((schema) => schema.name)
      .join("|")}`;
    if (diagramInitializedFor.current !== initKey) {
      setDiagramSchemaNames(
        activeMetadata.schemas
          .filter((schema) =>
            schema.objects.some((object) => object.kind === "table"),
          )
          .map((schema) => schema.name),
      );
      setDiagramSearch(pendingDiagramSearchRef.current ?? "");
      pendingDiagramSearchRef.current = null;
      setDiagramZoom(1);
      diagramInitializedFor.current = initKey;
    }
  }, [activeConnectionId, activeMetadata, diagramOpen]);

  function resetKeybinding(commandId: string) {
    if (recordingCommand === commandId) {
      cancelRecording();
    }
    setKeymapOverrides((prev) => {
      const next = { ...prev };
      delete next[commandId];
      saveOverrides(next);
      return next;
    });
  }

  function applyVimKeybindingPlan(
    resolutions: VimKeybindingConflictResolutions,
  ) {
    cancelRecording();
    setKeymapOverrides((prev) => {
      const currentKeymap = {
        ...resultCopyDefaultKeymap,
        ...effectiveKeymap(prev),
      };
      const conflicts = findVimKeybindingConflicts(
        currentKeymap,
        appCommandCatalog,
      );
      const next = applyVimKeybindingResolutionOverrides(
        prev,
        conflicts,
        resolutions,
      );
      saveOverrides(next);
      return next;
    });
    showActionNotice(
      "success",
      "Vim shortcuts updated",
      "Conflicting app shortcuts were adjusted for Vim mode.",
    );
  }

  const resultSummary = activeResult
    ? `${toCount(activeResult.rowCount)} rows${activeResult.truncated ? " capped" : ""} in ${toCount(
        activeResult.elapsedMs,
      )} ms`
    : "no result";
  const displayedResultSummary =
    activeResult && filtersActive
      ? `${toCount(totalRows)} / ${toCount(unfilteredRowCount)} shown · ${resultSummary}`
      : resultSummary;
  const importSqlPreview = importPreview
    ? generateImportSql(
        importPreview.tableName,
        importPreview.columns,
        importPreview.rows,
      )
    : "";
  const schemaSqlPreview = buildSchemaSql(schemaDraft);

  function updateDraft(patch: Partial<ConnectionDraft>) {
    setDraft((current) => {
      const next = patch.engine
        ? { ...current, ...memoryDefaults(patch.engine), ...patch }
        : { ...current, ...patch };
      return next;
    });
    setConnectionError(null);
  }

  function selectProfile(profile: ConnectionDraft) {
    const repaired = repairBuiltinSampleProfile(profile);
    setSelectedProfileId(repaired.id);
    setDraft(repaired);
    setConnectionError(null);
  }

  function selectSidebarConnection(
    connection: WorkspaceConnection,
    profile: ConnectionDraft | undefined,
  ) {
    setActiveConnectionId(connection.id);
    if (profile) {
      selectProfile(profile);
    }
  }

  function saveDraft(showSaved = true) {
    const validationError = validateDraft(draft);
    if (validationError) {
      setConnectionError(validationError);
      showActionNotice("error", "Connection was not saved", validationError);
      return false;
    }
    const cleanDraft = sanitizedProfile(repairBuiltinSampleProfile(draft));
    setProfiles((current) => {
      const existing = current.findIndex(
        (profile) => profile.id === cleanDraft.id,
      );
      if (existing === -1) {
        return [...current, cleanDraft];
      }
      return current.map((profile, index) =>
        index === existing ? cleanDraft : profile,
      );
    });
    setSelectedProfileId(cleanDraft.id);
    if (showSaved) {
      setConnectionError(null);
      showActionNotice("success", "Connection saved", cleanDraft.name);
    }
    return true;
  }

  function addProfile() {
    const next = newDraft(profiles.length + 1);
    setProfiles((current) => [...current, sanitizedProfile(next)]);
    setSelectedProfileId(next.id);
    setDraft(next);
    setConnectionError(null);
    showActionNotice("info", "New connection draft created", next.name);
  }

  async function importConnectionFile(file: File) {
    setConnectionError(null);
    try {
      const text = await file.text();
      const imported = importConnectionProfiles(text, file.name);
      const importedProfiles = imported.profiles;
      const firstImportedRef: { current: ConnectionDraft | null } = {
        current: null,
      };
      setProfiles((current) => {
        const merged = withUniqueProfileIds([...current, ...importedProfiles]);
        const mergedImported = merged.slice(current.length);
        firstImportedRef.current = mergedImported[0] ?? null;
        return withStarterProfiles(merged);
      });
      setConnectionSearch("");
      const firstImported = firstImportedRef.current;
      if (firstImported) {
        setSelectedProfileId(firstImported.id);
        setDraft(firstImported);
        setActiveConnectionId(firstImported.id);
      }
      showActionNotice(
        "success",
        "Connections imported",
        `${imported.source} · ${toCount(importedProfiles.length)} profile(s)`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", "Connection import failed", message);
    }
  }

  function exportConnectionFile(format: ConnectionTransferFormat) {
    try {
      const exported = exportConnectionProfiles(profiles, format);
      downloadBlob(
        new Blob([exported.content], {
          type: `${exported.mime};charset=utf-8`,
        }),
        exported.fileName,
      );
      const skipped =
        exported.skippedCount > 0
          ? ` · ${toCount(exported.skippedCount)} skipped`
          : "";
      showActionNotice(
        "success",
        "Connections exported",
        `${exported.label} · ${toCount(exported.profileCount)} profile(s)${skipped}`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", "Connection export failed", message);
    }
  }

  async function deleteProfile() {
    const id = draft.id;
    if (connectedIds.has(id)) {
      await dbDisconnect(id).catch(() => undefined);
    }
    setConnectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setProfiles((current) => {
      const next = current.filter((profile) => profile.id !== id);
      const fallback = next[0] ?? newDraft(1);
      setSelectedProfileId(fallback.id);
      setDraft(fallback);
      return next.length > 0 ? next : [sanitizedProfile(fallback)];
    });
    showActionNotice("success", "Connection deleted", id);
  }

  async function testActiveProfile() {
    const validationError = validateDraft(draft);
    if (validationError) {
      setConnectionError(validationError);
      showActionNotice("error", "Connection test failed", validationError);
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setConnectionError(runtimeError);
      showActionNotice("error", "Connection test failed", runtimeError);
      return;
    }
    setTestingConnection(true);
    setConnectionError(null);
    const testId = `__test_${draft.id}_${Date.now()}`;
    try {
      await dbConnect({
        ...profileFromDraft(draft),
        id: testId,
      });
      await dbDisconnect(testId);
      setConnectionError(null);
      showActionNotice(
        "success",
        "Connection test succeeded",
        `${draft.name.trim()} (${engineLabel(draft.engine)})`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", "Connection test failed", message);
    } finally {
      setTestingConnection(false);
    }
  }

  async function connectActiveProfile(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!saveDraft(false)) {
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setConnectionError(runtimeError);
      showActionNotice("error", "Connect failed", runtimeError);
      return;
    }
    setConnecting(true);
    setConnectionError(null);
    try {
      const started = performance.now();
      const info = await dbConnect(profileFromDraft(draft));
      const elapsedMs = Math.max(1, Math.round(performance.now() - started));
      const nextConnection = describeConnection(
        info,
        elapsedMs,
        draft.name.trim(),
      );
      setLiveConnections((current) => ({
        ...current,
        [nextConnection.id]: nextConnection,
      }));
      setConnectedIds((current) => new Set(current).add(nextConnection.id));
      setActiveConnectionId(nextConnection.id);
      void refreshObjects(nextConnection.id, true);
      setConnectionManagerOpen(false);
      showActionNotice(
        "success",
        "Connected",
        `${draft.name.trim()} · ${elapsedMs} ms`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", "Connect failed", message);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectActiveProfile() {
    const id = activeConnectionId;
    if (!connectedIds.has(id)) {
      return;
    }
    await dbDisconnect(id).catch(() => undefined);
    setConnectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setMetadataByConnection((current) => {
      const { [id]: _removed, ...next } = current;
      return next;
    });
    setMetadataErrors((current) => {
      const { [id]: _removed, ...next } = current;
      return next;
    });
    showActionNotice("success", "Disconnected", id);
  }

  async function refreshObjects(
    connectionId = activeConnectionId,
    force = false,
    notify = false,
  ) {
    if (!force && !connectedIds.has(connectionId)) {
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setMetadataErrors((current) => ({
        ...current,
        [connectionId]: runtimeError,
      }));
      if (notify) {
        showActionNotice("error", "Refresh failed", runtimeError);
      }
      return;
    }
    setMetadataLoading((current) => new Set(current).add(connectionId));
    setMetadataErrors((current) => {
      const { [connectionId]: _removed, ...next } = current;
      return next;
    });
    try {
      const metadata = await dbListObjects(connectionId);
      setMetadataByConnection((current) => ({
        ...current,
        [connectionId]: metadata,
      }));
      if (notify) {
        const objectCount = metadata.schemas.reduce(
          (count, schema) => count + schema.objects.length,
          0,
        );
        showActionNotice(
          "success",
          "Objects refreshed",
          `${toCount(objectCount)} objects loaded`,
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      setMetadataErrors((current) => ({
        ...current,
        [connectionId]: message,
      }));
      if (notify) {
        showActionNotice("error", "Refresh failed", message);
      }
    } finally {
      setMetadataLoading((current) => {
        const next = new Set(current);
        next.delete(connectionId);
        return next;
      });
    }
  }

  function loadHistoryItem(item: QueryHistoryItem) {
    if (item.connectionId !== activeConnectionId) {
      setActiveConnectionId(item.connectionId);
    }
    setQuery(item.sql);
    closeQueryHistoryDialog();
    window.setTimeout(() => activeEditorApi()?.focus(), 0);
    showActionNotice("success", "SQL loaded", item.connectionName);
  }

  async function runHistoryItem(item: QueryHistoryItem) {
    if (item.connectionId !== activeConnectionId) {
      loadHistoryItem(item);
      showActionNotice(
        "info",
        "SQL loaded",
        "Switched connection; run after it is connected",
      );
      return;
    }
    setQuery(item.sql);
    closeQueryHistoryDialog();
    await runEditorSql(item.sql, { allowMagic: false });
  }

  function restoreHistoryResult(item: QueryHistoryItem) {
    if (!item.result) {
      showActionNotice(
        "info",
        "No result retained",
        "This history entry has SQL only",
      );
      return;
    }
    releaseActiveSpill();
    setResult(historySnapshotToQueryResult(item.result));
    setLastRunSql(item.sql);
    setQueryError(null);
    setResultMode("data");
    setTableViewObject(null);
    setActiveResultIndex(0);
    resetEdits();
    resetGridView();
    setSelectedRowKey(null);
    setSelectedCell(null);
    setSelectedRange(null);
    closeQueryHistoryDialog();
    showActionNotice(
      "success",
      "Result restored",
      `${toCount(item.result.retainedRows)} retained rows`,
    );
  }

  function errorResultSetForExport(): QueryResultSet | null {
    const message = queryError ?? commitError;
    if (!message) {
      return null;
    }
    const kind = queryError ? "query" : "edit";
    return {
      statementIndex: 0,
      statement: lastRunSql || "query",
      columns: ["type", "message", "sql"],
      rows: [[kind, message, lastRunSql || query]],
      rowCount: 1n,
      elapsedMs: 0n,
      truncated: false,
    };
  }

  function exportActiveResult(format: ResultExportFormat) {
    const exportResult = activeResult ?? errorResultSetForExport();
    if (!exportResult) {
      showActionNotice("info", "No result to export");
      return;
    }
    const target = inferEditTarget();
    const exported = buildResultExport(
      exportResult,
      format,
      target?.table ?? (activeResult ? "query_result" : "query_error"),
    );
    const blob = new Blob([exported.bom ? "\uFEFF" : "", exported.content], {
      type: exported.mime,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = resultExportFileName(activeConnectionId, format);
    document.body.append(link);
    link.click();
    link.remove();
    setExportMenuOpen(false);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showActionNotice(
      "success",
      "Export started",
      resultExportFileName(activeConnectionId, format),
    );
  }

  async function copyActiveResultSqlInserts() {
    const exportResult = activeResult ?? errorResultSetForExport();
    if (!exportResult) {
      showActionNotice("info", "No result to copy");
      return;
    }
    const target = inferEditTarget();
    const exported = buildResultExport(
      exportResult,
      "sql",
      target?.table ?? (activeResult ? "query_result" : "query_error"),
    );
    try {
      await writeTextToClipboard(exported.content);
      showActionNotice(
        "success",
        "INSERT SQL copied",
        `${toCount(exportResult.rows.length)} rows`,
      );
    } catch (error) {
      showActionNotice("error", "Copy failed", errorMessage(error));
    }
  }

  function currentDiagramSvgMarkup() {
    const svg = diagramSvgRef.current;
    if (!svg || !diagramLayout) {
      throw new Error("No ERD is rendered");
    }
    return {
      markup: serializeSvgElement(svg),
      width: diagramLayout.width,
      height: diagramLayout.height,
    };
  }

  function downloadDiagramSvg() {
    try {
      const { markup } = currentDiagramSvgMarkup();
      downloadBlob(
        new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
        erdFileName(activeConnectionId, "svg"),
      );
      setDiagramError(null);
      showActionNotice(
        "success",
        "ERD SVG exported",
        erdFileName(activeConnectionId, "svg"),
      );
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", "ERD export failed", message);
    }
  }

  async function downloadDiagramPng() {
    try {
      const { markup, width, height } = currentDiagramSvgMarkup();
      const blob = await svgMarkupToPngBlob(markup, width, height);
      downloadBlob(blob, erdFileName(activeConnectionId, "png"));
      setDiagramError(null);
      showActionNotice(
        "success",
        "ERD PNG exported",
        erdFileName(activeConnectionId, "png"),
      );
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", "ERD export failed", message);
    }
  }

  async function copyDiagramSvg() {
    try {
      const { markup } = currentDiagramSvgMarkup();
      await writeTextToClipboard(markup);
      setDiagramError(null);
      showActionNotice("success", "ERD SVG copied");
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", "Copy failed", message);
    }
  }

  async function copyDiagramPng() {
    try {
      const { markup, width, height } = currentDiagramSvgMarkup();
      const blob = await svgMarkupToPngBlob(markup, width, height);
      await writePngBlobToClipboard(blob);
      setDiagramError(null);
      showActionNotice("success", "ERD PNG copied");
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", "Copy failed", message);
    }
  }

  function currentTableSpecDocument() {
    if (!activeMetadata) {
      throw new Error("No schema metadata is loaded");
    }
    return buildTableSpecDocument(activeMetadata, {
      connectionId: activeConnectionId,
      connectionName: activeConnection.name,
      schemaNames: diagramSchemaNames,
      search: diagramSearch,
    });
  }

  function downloadTableSpecMarkdown() {
    try {
      const exported = exportTableSpecMarkdown(currentTableSpecDocument());
      downloadBlob(
        new Blob([exported.content], { type: exported.mime }),
        tableSpecFileName(activeConnectionId, exported.extension),
      );
      setDiagramError(null);
      showActionNotice("success", "Table spec exported", "Markdown");
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", "Table spec export failed", message);
    }
  }

  function downloadTableSpecJson() {
    try {
      const exported = exportTableSpecJson(currentTableSpecDocument());
      downloadBlob(
        new Blob([exported.content], { type: exported.mime }),
        tableSpecFileName(activeConnectionId, exported.extension),
      );
      setDiagramError(null);
      showActionNotice("success", "Table spec exported", "JSON");
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", "Table spec export failed", message);
    }
  }

  async function handleSchemaSpecFile(file: File) {
    try {
      const spec = parseTableSpecDocument(await file.text());
      const sql = ddlFromTableSpecDocument(spec);
      setQuery(sql);
      setDiagramOpen(false);
      setDiagramError(null);
      showActionNotice("success", "DDL generated from table spec", file.name);
      window.setTimeout(() => activeEditorApi()?.focus(), 0);
    } catch (error) {
      const message = errorMessage(error);
      setDiagramError(message);
      showActionNotice("error", "Spec import failed", message);
    } finally {
      if (schemaSpecFileRef.current) {
        schemaSpecFileRef.current.value = "";
      }
    }
  }

  function fitDiagramToViewport() {
    if (!diagramLayout || !diagramCanvasRef.current) {
      return;
    }
    const bounds = diagramCanvasRef.current.getBoundingClientRect();
    const nextZoom = clampNumber(
      Math.min(
        bounds.width / diagramLayout.width,
        bounds.height / diagramLayout.height,
      ),
      0.25,
      1.25,
    );
    setDiagramZoom(nextZoom);
    window.requestAnimationFrame(() => {
      if (diagramCanvasRef.current) {
        diagramCanvasRef.current.scrollTop = 0;
        diagramCanvasRef.current.scrollLeft = 0;
      }
    });
  }

  async function handleImportFile(file: File) {
    const kind = detectImportFileKind(file.name);
    setImportPreview(null);
    setImportError(null);
    if (!kind) {
      const message = "Unsupported import file type";
      setImportError(message);
      showActionNotice("error", "Import failed", message);
      return;
    }
    const text = await file.text();
    if (kind === "sql") {
      setQuery(text);
      showActionNotice("success", "SQL loaded", file.name);
      return;
    }
    if (kind === "excel") {
      const message = "Excel import is not available in the desktop UI yet";
      setImportError(message);
      showActionNotice("error", "Import failed", message);
      return;
    }
    try {
      const parsed = parseImportText(text, kind);
      setImportPreview({
        ...parsed,
        fileName: file.name,
        format: kind,
        tableName: inferImportTableName(file.name),
      });
      showActionNotice(
        "success",
        "Import preview ready",
        `${file.name} · ${toCount(parsed.totalRows)} rows`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setImportError(message);
      showActionNotice("error", "Import failed", message);
    }
  }

  function putImportSqlInEditor() {
    if (!importPreview) {
      return;
    }
    setQuery(
      generateImportSql(
        importPreview.tableName,
        importPreview.columns,
        importPreview.rows,
      ),
    );
    setImportPreview(null);
    setImportError(null);
    showActionNotice(
      "success",
      "Import SQL generated",
      importPreview.tableName,
    );
  }

  function putMigrationTextInEditor(text: string) {
    setQuery(text);
    setMigrationStudioOpen(false);
    showActionNotice("success", "Migration output loaded");
  }

  async function copyMigrationText(text: string, label: string) {
    try {
      await writeTextToClipboard(text);
      showActionNotice("success", `${label} copied`);
    } catch (error) {
      showActionNotice("error", "Copy failed", errorMessage(error));
    }
  }

  async function openTableData(object: DbObjectMetadata) {
    if (object.kind !== "table" && object.kind !== "view") {
      return;
    }
    const sql = tablePreviewSql(editorEngine, object);
    setQuery(sql);
    setObjectActionMenu(null);
    setTableViewObject(object);
    setResultMode("data");
    if (activeConnectionOpen) {
      await executeQuery(sql, undefined, { sourceObject: object });
    }
  }

  function openSnapshotObject(object: WorkspaceConnection["objects"][number]) {
    if (object.kind === "procedure") {
      return;
    }
    const sql =
      editorEngine === "sqlserver"
        ? `select top (200) * from ${quoteSqlIdentifier(editorEngine, object.name)};`
        : `select * from ${quoteSqlIdentifier(editorEngine, object.name)} limit 200;`;
    setQuery(sql);
    if (activeConnectionOpen) {
      void executeQuery(sql);
    }
  }

  function showObjectInDiagram(object: DbObjectMetadata) {
    pendingDiagramSearchRef.current = object.name;
    setDiagramSearch(object.name);
    setDiagramOpen(true);
    setObjectActionMenu(null);
  }

  function jumpToSqlMetadata(target: SqlMetadataTarget) {
    openObjectSchemaDesigner(target.object);
    setObjectActionMenu(null);
  }

  function putSchemaSqlInEditor() {
    setQuery(buildSchemaSql(schemaDraft));
    setSchemaDesignerOpen(false);
    showActionNotice("success", "Schema SQL generated", schemaDraft.table);
  }

  async function copySchemaSql() {
    try {
      await writeTextToClipboard(schemaSqlPreview);
      showActionNotice("success", "Schema SQL copied");
    } catch (error) {
      showActionNotice("error", "Copy failed", errorMessage(error));
    }
  }

  function insertCompletionHint(hint: CompletionHint) {
    activeEditorApi()?.insertText(hint.insertText);
    activeEditorApi()?.focus();
  }

  function saveCurrentQuery() {
    try {
      window.localStorage.setItem(savedQueryStorageKey, query);
      showActionNotice("success", "Query saved", activeTabLabel ?? "scratch");
    } catch (error) {
      showActionNotice("error", "Query save failed", errorMessage(error));
    }
  }

  function saveCurrentQueryAsFile() {
    const fileName = sqlDownloadFileName(activeTabLabel ?? "query.sql");
    downloadBlob(
      new Blob([query], { type: "application/sql;charset=utf-8" }),
      fileName,
    );
    showActionNotice("success", "SQL export started", fileName);
  }

  async function exitApplication() {
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      showActionNotice(
        "info",
        "Exit unavailable",
        "Close the browser preview tab or open the Tauri desktop window.",
      );
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (error) {
      showActionNotice("error", "Exit failed", errorMessage(error));
    }
  }

  async function copyAppDiagnostics() {
    const diagnostics = [
      `${APP_NAME} ${APP_VERSION}`,
      `Identifier: ${APP_IDENTIFIER}`,
      `Runtime: ${tauriRuntimeError() ? "browser preview" : "Tauri desktop"}`,
      `Theme: ${theme.kind}`,
      `Active connection: ${activeConnectionId}`,
      `Connection status: ${activeConnectionOpen ? "connected" : "closed"}`,
      `Engine: ${activeEngine}`,
      `User agent: ${navigator.userAgent}`,
    ].join("\n");
    try {
      await navigator.clipboard?.writeText(diagnostics);
      showActionNotice("success", "Diagnostics copied");
    } catch (error) {
      showActionNotice("error", "Copy failed", errorMessage(error));
    }
  }

  async function formatQuery() {
    const error = (await activeEditorApi()?.format()) ?? null;
    setQueryError(error ?? null);
    if (error) {
      showActionNotice("error", "Format failed", error);
    } else {
      showActionNotice("success", "SQL formatted", formatter);
    }
  }

  function showEditorQuickFix() {
    const opened = activeEditorApi()?.showQuickFix() ?? false;
    if (!opened) {
      showActionNotice("info", "No problems to show");
    }
  }

  async function cleanupQuery() {
    const error = (await activeEditorApi()?.cleanup()) ?? null;
    setQueryError(error ?? null);
    if (error) {
      showActionNotice("error", "Cleanup failed", error);
    } else {
      showActionNotice("success", "Code cleanup complete");
    }
  }

  function transformEditorSelection(action: SqlEditorTransformAction) {
    const changed = activeEditorApi()?.transformSelection(action) ?? false;
    if (!changed) {
      showActionNotice("info", "Nothing changed");
      return;
    }
    const label: Record<SqlEditorTransformAction, string> = {
      uppercase: "Uppercase",
      lowercase: "Lowercase",
      unformat: "Unformatted to one line",
      appendCommas: "Commas added",
      doubleToSingleQuotes: "Quotes converted",
    };
    showActionNotice("success", label[action]);
  }

  function indentEditorSelection() {
    const changed = activeEditorApi()?.indentSelection() ?? false;
    showActionNotice(
      changed ? "success" : "info",
      changed ? "Indented" : "Nothing changed",
    );
  }

  function outdentEditorSelection() {
    const changed = activeEditorApi()?.outdentSelection() ?? false;
    showActionNotice(
      changed ? "success" : "info",
      changed ? "Outdented" : "Nothing changed",
    );
  }

  async function runQuery() {
    setRunMenuOpen(false);
    const selectedSql = selectedSqlFromSelections(
      query,
      activeEditorSelections(),
    );
    if (selectedSql) {
      await runEditorSql(selectedSql, { allowMagic: true });
      return;
    }
    const selection = activeMainEditorSelection();
    const sqlToRun = selectedOrCurrentStatement(
      selection.from,
      selection.to,
      query,
    );
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  async function copyPlanFormat(format: QueryPlanCopyFormat) {
    try {
      await writeTextToClipboard(format.content);
      showActionNotice("success", "Plan copied", format.label);
    } catch (error) {
      showActionNotice("error", "Copy failed", errorMessage(error));
    }
  }

  async function runSelectionQuery() {
    setRunMenuOpen(false);
    const sqlToRun = selectedSqlFromSelections(query, activeEditorSelections());
    if (!sqlToRun) {
      showActionNotice("info", "No selection to run");
      return;
    }
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  async function runCurrentQuery() {
    setRunMenuOpen(false);
    const selection = activeMainEditorSelection();
    const cursor = selection.to;
    const sqlToRun = selectedOrCurrentStatement(cursor, cursor, query);
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  function explainTargetSql() {
    const selectedSql = selectedSqlFromSelections(
      query,
      activeEditorSelections(),
    );
    if (selectedSql) {
      return selectedSql;
    }
    const selection = activeMainEditorSelection();
    const cursor = selection.to;
    return selectedOrCurrentStatement(cursor, cursor, query);
  }

  async function explainCurrentQuery(mode: QueryPlanMode) {
    setRunMenuOpen(false);
    const sqlToExplain = explainTargetSql().trim();
    if (!activeConnectionOpen) {
      const message = `not connected: ${activeConnectionId}`;
      setPlanError(message);
      showActionNotice("error", "Explain failed", message);
      setActiveSidebarView("plan");
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setPlanError(runtimeError);
      showActionNotice("error", "Explain failed", runtimeError);
      setActiveSidebarView("plan");
      return;
    }
    if (!sqlToExplain) {
      setPlanError("query is empty");
      showActionNotice("info", "Nothing to explain");
      setActiveSidebarView("plan");
      return;
    }
    setActiveSidebarView("plan");
    setPlanLoading(true);
    setPlanError(null);
    try {
      const plan = await dbExplainQuery(activeConnectionId, sqlToExplain, mode);
      setPlanAnalysis(plan);
      showActionNotice(
        "success",
        mode === "analyze" ? "Analyse complete" : "Plan ready",
        `${plan.nodes.length} nodes · ${plan.findings.length} findings`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setPlanError(message);
      showActionNotice("error", "Explain failed", message);
    } finally {
      setPlanLoading(false);
    }
  }

  async function runFromStartQuery() {
    setRunMenuOpen(false);
    const selection = activeMainEditorSelection();
    const cursor = Math.max(selection.from, selection.to);
    const sqlToRun = query.slice(0, cursor).trim();
    await runEditorSql(sqlToRun, { allowMagic: false });
  }

  async function runAllQuery() {
    setRunMenuOpen(false);
    await runEditorSql(query.trim(), { allowMagic: false });
  }

  async function runEditorSql(
    sqlToRun: string,
    options: { allowMagic: boolean },
  ) {
    if (!activeConnectionOpen) {
      const message = `not connected: ${activeConnectionId}`;
      setQueryError(message);
      showActionNotice("error", "Run failed", message);
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setQueryError(runtimeError);
      showActionNotice("error", "Run failed", runtimeError);
      return;
    }
    if (!sqlToRun) {
      setQueryError("query is empty");
      showActionNotice("info", "Nothing to run");
      return;
    }
    const magic = options.allowMagic
      ? parseQueryMagic(sqlToRun, activeEngine)
      : null;
    if (magic) {
      await runQueryMagic(magic);
      return;
    }
    await runSqlWithParameterPrompt(sqlToRun);
  }

  async function runQueryMagic(magic: QueryMagicAction) {
    switch (magic.kind) {
      case "error":
        setQueryError(magic.message);
        return;
      case "sql":
        setQuery(magic.sql);
        await runSqlWithParameterPrompt(magic.sql);
        return;
      case "erd":
        if (!activeConnectionOpen) {
          setQueryError(`not connected: ${activeConnectionId}`);
          return;
        }
        if (!activeMetadata && !activeMetadataLoading) {
          await refreshObjects(activeConnectionId, true);
        }
        pendingDiagramSearchRef.current = magic.search;
        setDiagramSearch(magic.search);
        setDiagramOpen(true);
        setQueryError(null);
        return;
      case "export":
        if (!activeResult) {
          setQueryError("No result to export yet.");
          return;
        }
        exportActiveResult(magic.format);
        setQueryError(null);
        return;
      case "params":
        setQuery(magic.sql);
        await openQueryParameterPrompt(magic.sql, true);
        return;
    }
  }

  function blockReadOnlySql(sqlToRun: string) {
    if (!activeConnectionReadOnly || !sqlMayWrite(sqlToRun)) {
      return false;
    }
    const message = "read-only connection: write statements are blocked";
    setQueryError(message);
    showActionNotice("error", "Read-only mode", message);
    return true;
  }

  async function runSqlWithParameterPrompt(sqlToRun: string) {
    if (blockReadOnlySql(sqlToRun)) {
      return;
    }
    const openedPrompt = await openQueryParameterPrompt(sqlToRun, false);
    if (openedPrompt) {
      return;
    }
    await executeQuery(sqlToRun);
  }

  async function openQueryParameterPrompt(
    sqlToRun: string,
    requirePrompt: boolean,
  ) {
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setQueryError(runtimeError);
      showActionNotice("error", "Parameter scan failed", runtimeError);
      return true;
    }
    try {
      const promptSet = await dbQueryParameters(sqlToRun);
      if (promptSet.prompts.length > 0) {
        const remembered = queryParameterMemory[promptSet.signature] ?? {};
        setParameterDraftValues(
          Object.fromEntries(
            promptSet.prompts.map((prompt) => [
              prompt.id,
              remembered[prompt.id] ?? "",
            ]),
          ),
        );
        setPendingQueryParameters({ sql: sqlToRun, promptSet });
        setQueryError(null);
        return true;
      }
      if (requirePrompt) {
        setQueryError("No query parameters found in this SQL.");
        showActionNotice("info", "No parameters found");
        return true;
      }
    } catch (error) {
      const message = errorMessage(error);
      setQueryError(message);
      showActionNotice("error", "Parameter scan failed", message);
      return true;
    }
    return false;
  }

  async function executeQuery(
    sqlToRun: string,
    params?: QueryParameterInput[],
    options: { sourceObject?: DbObjectMetadata } = {},
  ) {
    if (!activeConnectionOpen) {
      const message = `not connected: ${activeConnectionId}`;
      setQueryError(message);
      showActionNotice("error", "Run failed", message);
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setQueryError(runtimeError);
      showActionNotice("error", "Run failed", runtimeError);
      return;
    }
    if (!sqlToRun.trim()) {
      setQueryError("query is empty");
      showActionNotice("info", "Nothing to run");
      return;
    }
    if (blockReadOnlySql(sqlToRun)) {
      return;
    }
    setRunning(true);
    setQueryError(null);
    setLastRunSql(sqlToRun);
    setResultMode("data");
    setTableViewObject(options.sourceObject ?? null);
    setActiveResultIndex(0);
    // A new run invalidates any staged edits and resets the scroll/filter/sort view.
    resetEdits();
    resetGridView();
    // Release the previous disk-offloaded result (EXEC-010) so its temp file is
    // freed before this run replaces it.
    releaseActiveSpill();
    if (gridRef.current) {
      gridRef.current.scrollTop = 0;
      gridRef.current.scrollLeft = 0;
    }
    setGridScrollTop(0);
    setGridScrollLeft(0);
    setSelectedRowKey(null);
    setSelectedCell(null);
    setSelectedRange(null);
    const started = performance.now();
    const ranAt = new Date().toISOString();
    const queryId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    runningQueryIdRef.current = queryId;
    const cancelRequestedForRun = () =>
      cancelRequestedQueryIdRef.current === queryId;
    const showCancelledRun = () => {
      setQueryError(null);
      showActionNotice("info", "Query cancelled");
    };
    let publishRaf: number | null = null;
    try {
      // Stream the run so the grid fills as batches arrive instead of waiting for
      // the whole result. Query errors surface as an "error" event (the command
      // itself resolves); the catch below only handles invoke-level failures.
      const streamResultSets: QueryResultSet[] = [];
      const ensureResultSet = (index: number) => {
        while (streamResultSets.length <= index) {
          const statementIndex = streamResultSets.length;
          streamResultSets.push({
            statementIndex,
            statement: `statement ${statementIndex + 1}`,
            columns: [],
            rows: [],
            rowCount: 0n,
            elapsedMs: 0n,
            truncated: false,
          });
        }
        return streamResultSets[index];
      };
      const publishStreamResultNow = () => {
        if (publishRaf !== null) {
          window.cancelAnimationFrame(publishRaf);
          publishRaf = null;
        }
        const first = ensureResultSet(0);
        setResult({
          columns: first.columns,
          rows: [...first.rows],
          rowCount: first.rowCount,
          elapsedMs: first.elapsedMs,
          truncated: first.truncated,
          message: first.message,
          resultSets:
            streamResultSets.length > 1
              ? streamResultSets.map((set) => ({
                  ...set,
                  rows: [...set.rows],
                }))
              : undefined,
        });
      };
      const scheduleStreamResultPublish = () => {
        if (publishRaf !== null) {
          return;
        }
        publishRaf = window.requestAnimationFrame(() => {
          publishRaf = null;
          publishStreamResultNow();
        });
      };
      const finalizeSpillRun = (spill: SpillRunResult) => {
        const first = ensureResultSet(0);
        const totalRows = Number(spill.totalRows);
        const historyResult = createQueryHistoryResultSnapshot(
          {
            columns: spill.columns,
            rows: first.rows,
            rowCount: spill.totalRows,
            elapsedMs: spill.elapsedMs,
            truncated: spill.truncated,
            message: spill.spilled
              ? "result retained on disk; history kept a preview"
              : undefined,
          },
          queryHistoryResultRows,
        );
        const source = new WindowedRows({
          total: totalRows,
          columnCount: spill.columns.length,
          pageSize: RESULT_WINDOW_PAGE_SIZE,
          maxResidentPages: RESULT_WINDOW_MAX_RESIDENT_PAGES,
        });
        source.ingest(0, first.rows);
        spillRef.current = { handle: spill.handle, source };
        pendingPagesRef.current.clear();
        setSpillInfo({ handle: spill.handle, total: totalRows });
        bumpGridWindowVersion();
        setResult({
          columns: spill.columns,
          rows: createWindowedRowsProxy(source) as QueryResult["rows"],
          rowCount: spill.totalRows,
          elapsedMs: spill.elapsedMs,
          truncated: spill.truncated,
          message: spill.spilled
            ? "result retained on disk; scrolling pages rows on demand"
            : spill.truncated
              ? "result capped at memory budget"
              : undefined,
        });
        appendHistory({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          connectionId: activeConnectionId,
          connectionName: activeConnection.name,
          engine: activeConnection.engine,
          sql: sqlToRun,
          status: "ok",
          rowCount: totalRows,
          elapsedMs: Number(spill.elapsedMs),
          truncated: spill.truncated,
          result: historyResult,
          ranAt,
        });
        if (/^\s*(alter|create|drop|rename|truncate)\b/i.test(sqlToRun)) {
          void refreshObjects(activeConnectionId, true);
        }
        showActionNotice(
          "success",
          "Query finished",
          `${toCount(totalRows)} rows in ${toCount(spill.elapsedMs)} ms`,
        );
      };
      if (resultOffloadEnabled) {
        // EXEC-010 disk offload: stream the resident first page for an immediate
        // paint, then hand the grid a windowed source that pages the rest from disk.
        const spill = await runQuerySpill(
          {
            connectionId: activeConnectionId,
            sql: sqlToRun,
            memoryBudget: resultMemoryBudget,
            offloadEnabled: true,
            queryId,
            params,
          },
          (event) => {
            switch (event.type) {
              case "columns":
                ensureResultSet(event.resultSetIndex).columns = event.columns;
                publishStreamResultNow();
                break;
              case "rows": {
                const set = ensureResultSet(event.resultSetIndex);
                set.rows.push(...event.rows);
                set.rowCount = BigInt(set.rows.length);
                set.elapsedMs = BigInt(Math.round(performance.now() - started));
                scheduleStreamResultPublish();
                break;
              }
            }
          },
        );
        finalizeSpillRun(spill);
      } else {
        await runQueryStream(
          {
            connectionId: activeConnectionId,
            sql: sqlToRun,
            maxRows: 10_000,
            queryId,
            params,
          },
          (event) => {
            switch (event.type) {
              case "columns":
                ensureResultSet(event.resultSetIndex).columns = event.columns;
                publishStreamResultNow();
                break;
              case "rows":
                {
                  const set = ensureResultSet(event.resultSetIndex);
                  set.rows.push(...event.rows);
                  set.rowCount = BigInt(set.rows.length);
                  set.elapsedMs = BigInt(
                    Math.round(performance.now() - started),
                  );
                }
                scheduleStreamResultPublish();
                break;
              case "done":
                for (const summary of event.resultSets) {
                  const set = ensureResultSet(summary.resultSetIndex);
                  set.rowCount = BigInt(summary.rowCount);
                  set.elapsedMs = BigInt(summary.elapsedMs || event.elapsedMs);
                  set.truncated = summary.truncated;
                  set.message = summary.truncated
                    ? "result capped at 10000 rows"
                    : undefined;
                }
                publishStreamResultNow();
                {
                  const first = ensureResultSet(0);
                  const historyResult = createQueryHistoryResultSnapshot(
                    {
                      columns: first.columns,
                      rows: first.rows,
                      rowCount: BigInt(event.rowCount),
                      elapsedMs: BigInt(event.elapsedMs),
                      truncated: event.truncated,
                      message: first.message,
                      resultSets:
                        streamResultSets.length > 1
                          ? streamResultSets.map((set) => ({
                              statementIndex: set.statementIndex,
                              statement: set.statement,
                              columns: set.columns,
                              rows: set.rows,
                              rowCount: set.rowCount,
                              elapsedMs: set.elapsedMs,
                              truncated: set.truncated,
                              message: set.message,
                            }))
                          : undefined,
                    },
                    queryHistoryResultRows,
                  );
                  appendHistory({
                    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    connectionId: activeConnectionId,
                    connectionName: activeConnection.name,
                    engine: activeConnection.engine,
                    sql: sqlToRun,
                    status: "ok",
                    rowCount: event.rowCount,
                    elapsedMs: event.elapsedMs,
                    truncated: event.truncated,
                    result: historyResult,
                    ranAt,
                  });
                }
                if (
                  /^\s*(alter|create|drop|rename|truncate)\b/i.test(sqlToRun)
                ) {
                  void refreshObjects(activeConnectionId, true);
                }
                showActionNotice(
                  "success",
                  "Query finished",
                  `${toCount(event.rowCount)} rows in ${toCount(event.elapsedMs)} ms`,
                );
                break;
              case "error":
                if (
                  cancelRequestedForRun() &&
                  isQueryCancelledMessage(event.message)
                ) {
                  showCancelledRun();
                  break;
                }
                setQueryError(event.message);
                showActionNotice("error", "Query failed", event.message);
                appendHistory({
                  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  connectionId: activeConnectionId,
                  connectionName: activeConnection.name,
                  engine: activeConnection.engine,
                  sql: sqlToRun,
                  status: "error",
                  rowCount: 0,
                  elapsedMs: Math.max(
                    1,
                    Math.round(performance.now() - started),
                  ),
                  truncated: false,
                  error: event.message,
                  ranAt,
                });
                break;
            }
          },
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      if (cancelRequestedForRun() && isQueryCancelledMessage(message)) {
        showCancelledRun();
      } else {
        setQueryError(message);
        showActionNotice("error", "Query failed", message);
        appendHistory({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          connectionId: activeConnectionId,
          connectionName: activeConnection.name,
          engine: activeConnection.engine,
          sql: sqlToRun,
          status: "error",
          rowCount: 0,
          elapsedMs: Math.max(1, Math.round(performance.now() - started)),
          truncated: false,
          error: message,
          ranAt,
        });
      }
    } finally {
      if (publishRaf !== null) {
        window.cancelAnimationFrame(publishRaf);
      }
      if (cancelRequestedQueryIdRef.current === queryId) {
        cancelRequestedQueryIdRef.current = null;
      }
      runningQueryIdRef.current = null;
      setRunning(false);
    }
  }

  async function submitQueryParameters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const pending = pendingQueryParameters;
    if (!pending) {
      return;
    }
    const values = { ...parameterDraftValues };
    const params = buildParameterInputs(pending.promptSet, values);
    setQueryParameterMemory((current) => ({
      ...current,
      [pending.promptSet.signature]: values,
    }));
    setPendingQueryParameters(null);
    setParameterDraftValues({});
    await executeQuery(pending.sql, params);
  }

  // Ask the backend to stop the in-flight query; the pending run then rejects with
  // "query cancelled" and the runQuery catch/finally resets the UI.
  async function cancelQuery() {
    const id = runningQueryIdRef.current;
    if (!id) {
      return;
    }
    if (cancelRequestedQueryIdRef.current === id) {
      showActionNotice("info", "Cancel already requested");
      return;
    }
    try {
      cancelRequestedQueryIdRef.current = id;
      const cancelled = await dbCancel(id);
      if (cancelled) {
        showActionNotice("info", "Cancel requested");
      } else {
        if (cancelRequestedQueryIdRef.current === id) {
          cancelRequestedQueryIdRef.current = null;
        }
        showActionNotice("info", "Query already finished");
      }
    } catch (error) {
      if (cancelRequestedQueryIdRef.current === id) {
        cancelRequestedQueryIdRef.current = null;
      }
      showActionNotice("error", "Cancel failed", errorMessage(error));
    }
  }

  const completionOpen =
    viewVisibility.completion &&
    (viewPlacements.completion === "right" ? rightSidebarOpen : sidebarOpen);
  const historyOpen =
    viewVisibility.queryHistory &&
    (viewPlacements.queryHistory === "right" ? rightSidebarOpen : sidebarOpen);
  const planOpen =
    viewVisibility.plan &&
    (viewPlacements.plan === "right" ? rightSidebarOpen : sidebarOpen);
  const appStyle = useMemo(
    () =>
      ({
        ...cssVariables(theme),
        ...uiZoomStyleVariables(uiZoom),
      }) as CSSProperties,
    [theme, uiZoom],
  );

  // Briefly enable color transitions only while the theme is actually changing,
  // so light/dark switches fade instead of snapping — without leaving a
  // permanent transition on every surface (which would make hover feel laggy).
  const [themeSwitching, setThemeSwitching] = useState(false);
  const themeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${themeKind}|${activeDefaultThemeId ?? ""}|${activeCustomThemeId ?? ""}`;
    if (themeKeyRef.current === null) {
      themeKeyRef.current = key;
      return;
    }
    if (themeKeyRef.current === key) return;
    themeKeyRef.current = key;
    setThemeSwitching(true);
    const timer = window.setTimeout(() => setThemeSwitching(false), 280);
    return () => window.clearTimeout(timer);
  }, [themeKind, activeDefaultThemeId, activeCustomThemeId]);

  function renderEditorTabStrip(group: EditorGroup) {
    const state = editorGroupStates[group];
    const groupOpenTabs = openTabsForEditorGroup(state);
    return (
      <div className="tab-strip editor-tab-strip">
        {groupOpenTabs.map((tab) => (
          <button
            className={tab.id === state.activeTabId ? "tab active" : "tab"}
            key={tab.id}
            type="button"
            onClick={() => selectEditorTab(group, tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <button
          className="mini-button"
          type="button"
          title="Reopen closed tab"
          aria-label="Reopen closed tab"
          disabled={groupOpenTabs.length === tabs.length}
          onClick={() => reopenSqlTab(group)}
        >
          <Plus size={14} />
        </button>
      </div>
    );
  }

  function renderSidebar(side: "left" | "right") {
    const right = side === "right";
    return (
      <Sidebar
        sidebarOpen={right ? rightSidebarOpen : sidebarOpen}
        side={side}
        activeView={right ? activeRightSidebarView : activeLeftSidebarView}
        availableViews={right ? rightSidebarViews : leftSidebarViews}
        showConnectionRail={!right}
        completionPanel={
          <InspectorContent
            activeConnectionId={activeConnectionId}
            editorEngine={editorEngine}
            connectionById={connectionById}
            activeMetadataLoading={activeMetadataLoading}
            activeMetadataError={activeMetadataError}
            completionHints={completionHints}
            onInsertCompletionHint={insertCompletionHint}
            onInsertSql={(sql) => activeEditorApi()?.insertText(sql)}
            onLoadHistorySql={setQuery}
            onCloseCompletion={() => closeSidebarView("completion")}
            showCompletion
            showHistory={false}
          />
        }
        historyPanel={
          <InspectorContent
            activeConnectionId={activeConnectionId}
            editorEngine={editorEngine}
            connectionById={connectionById}
            activeMetadataLoading={activeMetadataLoading}
            activeMetadataError={activeMetadataError}
            completionHints={completionHints}
            onInsertCompletionHint={insertCompletionHint}
            onInsertSql={(sql) => activeEditorApi()?.insertText(sql)}
            onLoadHistorySql={setQuery}
            onCloseHistory={() => closeSidebarView("queryHistory")}
            showCompletion={false}
            showHistory
          />
        }
        planPanel={
          <PlanPanel
            plan={planAnalysis}
            loading={planLoading}
            error={planError}
            activeConnectionOpen={activeConnectionOpen}
            activeConnectionName={activeConnection.name}
            onExplainPlan={() => void explainCurrentQuery("plan")}
            onExplainAnalyze={() => void explainCurrentQuery("analyze")}
            onCopyFormat={(format) => void copyPlanFormat(format)}
            onClose={() => closeSidebarView("plan")}
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
            onClose={() => closeSidebarView("lakehouse")}
          />
        }
        biPanel={
          <BiPanel
            result={activeResult}
            chartModel={chartResultModel}
            chartAvailable={chartAvailable}
            onOpenChartMode={() => setResultMode("chart")}
            onClose={() => closeSidebarView("bi")}
          />
        }
        gitPanel={
          <GitPanel
            variant="sidebar"
            onClose={() => closeSidebarView("git")}
          />
        }
        aiChatPanel={
          <AiChatPanel
            activeConnectionId={activeConnectionId}
            activeConnectionName={activeConnection.name}
            activeConnectionOpen={activeConnectionOpen}
            engine={editorEngine}
            onInsertSql={(sql) => activeEditorApi()?.insertText(sql)}
            onClose={() => closeSidebarView("aiChat")}
            notify={showActionNotice}
          />
        }
        searchReplacePanel={
          <SearchReplacePanel
            tabs={searchTabs}
            onReveal={revealSearchMatch}
            onReplaceTab={replaceSearchTab}
            onClose={() => closeSidebarView("searchReplace")}
          />
        }
        connections={connections}
        profileById={profileById}
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
          addProfile();
          setConnectionManagerOpen(true);
        }}
        onOpenConnectionManager={() => setConnectionManagerOpen(true)}
        onSelectConnection={selectSidebarConnection}
        onOpenBlankSchemaDesigner={openBlankSchemaDesigner}
        onNewTableFromFile={() => importFileRef.current?.click()}
        onOpenObjectSchemaDesigner={openObjectSchemaDesigner}
        onOpenDiagram={() => setDiagramOpen(true)}
        onRefreshObjects={() => refreshObjects(activeConnectionId, true, true)}
        onOpenTableData={(object) => void openTableData(object)}
        onOpenSnapshotObject={openSnapshotObject}
        onShowObjectInDiagram={showObjectInDiagram}
        onSetObjectActionMenu={setObjectActionMenu}
        onSelectView={setActiveSidebarView}
        onCloseSidebar={() =>
          right ? setRightSidebarOpen(false) : setSidebarOpen(false)
        }
        onBeginResize={(event) =>
          beginPanelResize(right ? "rightSidebar" : "sidebar", event)
        }
        onResizeKey={(event) =>
          onPanelResizeKey(right ? "rightSidebar" : "sidebar", event)
        }
      />
    );
  }

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
        leftSidebarOpen={sidebarOpen}
        rightSidebarOpen={rightSidebarOpen}
        completionOpen={completionOpen}
        historyOpen={historyOpen}
        planOpen={planOpen}
        sidebarWidth={sidebarWidth}
        inspectorWidth={inspectorWidth}
        resultsHeight={resultsHeight}
        editorSplitPercent={editorSplitPercent}
        menuBarSections={menuBarSections}
        commandCatalog={appMenuCommandCatalog}
        keymap={keymap}
        activeConnectionName={activeConnection.name}
        activeConnectionEngine={activeConnection.engine}
        activeConnectionColor={activeConnectionColor}
        activeConnectionStatus={activeConnectionStatus}
        activeTransportLabel={activeTransportLabel}
        vimMode={vimMode}
        queryLineCount={query.split("\n").length}
        sqlLintEnabled={sqlLinter === "gentle"}
        running={running}
        selectionStatus={selectionStatus}
        shellStyle={appStyle}
        onScopeFocus={(event) => {
          const scope = keyScopeFromTarget(event.target, "global");
          activeKeyScopeRef.current = scope;
          setActiveKeyScope(scope);
        }}
        onScopeMouseDown={(event) => {
          const scope = keyScopeFromTarget(event.target, activeKeyScope);
          activeKeyScopeRef.current = scope;
          setActiveKeyScope(scope);
        }}
        onToggleLeftSidebar={() => setSidebarOpen((open) => !open)}
        onToggleRightSidebar={toggleRightSidebar}
        onOpenConnectionManager={() => setConnectionManagerOpen(true)}
        onRunCommand={runCommand}
        onCloseWorkspaceMenu={() => setWorkspaceMenuOpen(false)}
        leftSidebar={renderSidebar("left")}
        rightSidebar={renderSidebar("right")}
      >
        <section className="main-pane">
          <div className="editor-and-inspector">
            <QueryEditorPane
              activeTabLabel={activeTabLabel}
              running={running}
              formatter={formatter}
              primaryQuery={queryForEditorGroup(editorGroupStates.primary)}
              secondaryQuery={queryForEditorGroup(editorGroupStates.secondary)}
              onPrimaryQueryChange={(next) =>
                setEditorGroupQuery("primary", next)
              }
              onSecondaryQueryChange={(next) =>
                setEditorGroupQuery("secondary", next)
              }
              renderEditorTabStrip={renderEditorTabStrip}
              editorEngine={editorEngine}
              activeMetadata={activeMetadata}
              sqlSnippets={sqlSnippets}
              editorBackgroundImage={editorBackgroundImage}
              editorBackgroundOpacity={editorBackgroundOpacity}
              theme={theme}
              vimMode={vimMode}
              sqlLinter={sqlLinter}
              editorApiRef={editorApiRef}
              secondaryEditorApiRef={secondaryEditorApiRef}
              editorSplitRef={editorSplitRef}
              editorSplitOpen={editorSplitOpen}
              editorSplitMode={editorSplitMode}
              setEditorSplitMode={setEditorSplitMode}
              activeEditorGroup={activeEditorGroup}
              setActiveEditorGroup={setActiveEditorGroup}
              setEditorSelection={setEditorGroupSelection}
              runPrimaryLabel={runPrimaryLabel}
              runShortcutLabel={runShortcutLabel}
              runCurrentShortcutLabel={runCurrentShortcutLabel}
              runFromStartShortcutLabel={runFromStartShortcutLabel}
              runAllShortcutLabel={runAllShortcutLabel}
              runMenuOpen={runMenuOpen}
              hasSelectedEditorSql={hasSelectedEditorSql}
              resultActionsAvailable={Boolean(activeResult)}
              runCommand={runCommand}
              saveCurrentQuery={saveCurrentQuery}
              runQuery={runQuery}
              runSelectionQuery={runSelectionQuery}
              runCurrentQuery={runCurrentQuery}
              runFromStartQuery={runFromStartQuery}
              runAllQuery={runAllQuery}
              cancelQuery={cancelQuery}
              setRunMenuOpen={setRunMenuOpen}
              beginEditorSplitResize={(event) =>
                beginPanelResize("editorSplit", event)
              }
              onEditorSplitResizeKey={(event) =>
                onPanelResizeKey("editorSplit", event)
              }
              onSqlFileDrop={(file) => void handleImportFile(file)}
              onUnsupportedFileDrop={() =>
                showActionNotice(
                  "error",
                  t("editor.dropFailed"),
                  t("editor.dropUnsupportedFile"),
                )
              }
              sqlFileDropLabel={t("editor.dropSqlFile")}
              onMetadataJump={jumpToSqlMetadata}
            />
          </div>

          <div
            className="panel-resizer results-resizer"
            role="separator"
            aria-label="Resize results"
            aria-orientation="horizontal"
            tabIndex={0}
            onPointerDown={(event) => beginPanelResize("results", event)}
            onKeyDown={(event) => onPanelResizeKey("results", event)}
          />
          <ResultsPane
            running={running}
            readOnly={activeConnectionReadOnly}
            tableViewObject={tableViewObject}
            resultMode={resultMode}
            chartModel={chartResultModel}
            graphModel={graphResultModel}
            chartAvailable={chartAvailable}
            graphAvailable={graphAvailable}
            webGlAvailable={webGlAvailable}
            resultSets={resultSets}
            activeResult={activeResult}
            hasResult={Boolean(activeResult)}
            activeResultIndex={activeResultIndexView}
            queryError={queryError}
            commitError={commitError}
            pendingCount={pendingCount}
            displayedResultSummary={displayedResultSummary}
            resultColumns={resultColumns}
            exportMenuOpen={exportMenuOpen}
            shortcutTips={resultShortcutTips}
            showingStructure={showingStructure}
            structureObject={structureObject}
            editorEngine={editorEngine}
            unfilteredRowCount={unfilteredRowCount}
            totalRows={totalRows}
            gridRef={gridRef}
            importFileRef={importFileRef}
            activeMetadata={activeMetadata}
            activeConnectionId={activeConnectionId}
            formatObjectName={(object) =>
              qualifiedObjectName(editorEngine, object)
            }
            formatCount={toCount}
            onResultModeChange={setResultMode}
            onSelectResultSet={selectResultSet}
            onExportActiveResult={exportActiveResult}
            onToggleExportMenu={() => setExportMenuOpen((open) => !open)}
            onCloseExportMenu={() => setExportMenuOpen(false)}
            onCopyVisibleResult={() => void copyVisibleResult()}
            onImportFile={(file) => void handleImportFile(file)}
            filtering={{
              quickFilter,
              filtersOpen,
              filtersActive,
              activeFilters,
              filteredOutCount,
              filterJoin,
              filterRules,
              sortRuleByColumn,
              sortRules,
              onQuickFilterChange: updateQuickFilter,
              onClearQuickFilter: clearQuickFilter,
              onToggleFilters: () => setFiltersOpen((open) => !open),
              onSetFilterJoin: setFilterJoin,
              onAddFilterRule: addFilterRule,
              onUpdateFilterRule: updateFilterRule,
              onRemoveFilterRule: removeFilterRule,
              onClearResultFilters: clearResultFilters,
              onToggleSort: toggleSort,
              onCloseFilters: () => setFiltersOpen(false),
            }}
            editing={{
              editMode,
              editUndoDepth,
              committing,
              cellEdits,
              editingCell,
              canEditActiveResult,
              onAddNewRow: addNewRow,
              onUndoEdit: undoLastEdit,
              onCommitEdits: () => void commitEdits(),
              onDiscardEdits: () => {
                resetEdits();
                setEditMode(false);
              },
              onGenerateRowChangeSql: generateSelectedRowChangeSql,
              onEnableEditMode: () => {
                if (activeConnectionReadOnly) {
                  const message =
                    "read-only connection: data edits are blocked";
                  setCommitError(message);
                  showActionNotice("error", "Edit blocked", message);
                  return;
                }
                setCommitError(null);
                setEditMode(true);
              },
              onBeginCellEdit: beginCellEdit,
              onSetCellValue: setCellValue,
              onDeleteRow: deleteRow,
              onPasteTableAt: pasteTableAt,
              onEndCellEdit: () => setEditingCell(null),
            }}
            selection={{
              selectedRowKey,
              selectedCell,
              selectedRangeBounds,
              selectedRowValues,
              rowDetailTable,
              onSelectGridRow: selectGridRow,
              onSelectGridCell: selectGridCell,
              onCloseRowDetail: () => {
                setSelectedRowKey(null);
                setSelectedCell(null);
                setSelectedRange(null);
              },
            }}
            gridGeometry={{
              gridRowStyle,
              gridTotalWidth,
              gridRowHeight,
              gridColumnWidth,
              leftColumnPad,
              rightColumnPad,
              topPad,
              bottomPad,
              firstVisible,
              visibleColumnIndexes,
              visibleRows,
              onGridScroll,
              onGridKeyDown,
              onGridPaste,
              onGridCopy,
            }}
          />
        </section>
      </WorkbenchShell>

      {connectionManagerOpen ? (
        <ConnectionManagerDialog
          profiles={filteredProfiles}
          connectedIds={connectedIds}
          selectedProfileId={selectedProfileId}
          draft={draft}
          search={connectionSearch}
          error={connectionError}
          activeConnectionOpen={activeConnectionOpen}
          testing={testingConnection}
          connecting={connecting}
          onClose={() => setConnectionManagerOpen(false)}
          onSearchChange={setConnectionSearch}
          onAddProfile={addProfile}
          onImportProfiles={(file) => void importConnectionFile(file)}
          onExportProfiles={exportConnectionFile}
          onSelectProfile={selectProfile}
          onUpdateDraft={updateDraft}
          onDeleteProfile={() => void deleteProfile()}
          onDisconnect={() => void disconnectActiveProfile()}
          onSave={() => saveDraft()}
          onTest={() => void testActiveProfile()}
          onConnect={connectActiveProfile}
        />
      ) : null}

      {migrationStudioOpen ? (
        <Suspense fallback={null}>
          <MigrationStudioDialog
            onClose={() => setMigrationStudioOpen(false)}
            onCopyText={(text, label) => void copyMigrationText(text, label)}
            onPutTextInEditor={putMigrationTextInEditor}
          />
        </Suspense>
      ) : null}

      <AiGenerateDialog
        open={aiGenerateOpen}
        onClose={() => setAiGenerateOpen(false)}
        connectionId={activeConnectionId}
        engine={editorEngine}
        onInsert={(sql) => activeEditorApi()?.insertText(sql)}
        notify={showActionNotice}
      />

      {terminalOpen && (
        <div className="terminal-dock">
          <TerminalPanel onClose={() => setTerminalOpen(false)} />
        </div>
      )}

      {settingsOpen ? (
        <SettingsDialog
          settingsTab={settingsTab}
          onOpenSection={openSettingsSection}
          onClose={() => setSettingsOpen(false)}
          locale={locale}
          setLocale={setLocale}
          vimMode={vimMode}
          setVimMode={setVimMode}
          editorBackgroundImage={editorBackgroundImage}
          setEditorBackgroundImage={setEditorBackgroundImage}
          editorBackgroundOpacity={editorBackgroundOpacity}
          setEditorBackgroundOpacity={setEditorBackgroundOpacity}
          animationsEnabled={animationsEnabled}
          setAnimationsEnabled={setAnimationsEnabled}
          autoCommit={autoCommit}
          setAutoCommit={setAutoCommit}
          uiZoom={uiZoom}
          setUiZoom={setUiZoom}
          themePreference={themePreference}
          themeKind={themeKind}
          setThemePreference={activateThemePreference}
          setThemeKind={activateBuiltInTheme}
          activeDefaultThemeId={activeDefaultTheme?.id ?? activeDefaultThemeId}
          activeDefaultThemeName={activeDefaultTheme?.name ?? null}
          setActiveDefaultThemeId={activateDefaultTheme}
          customThemes={customThemes}
          activeCustomThemeId={activeCustomThemeId}
          activeCustomThemeName={activeCustomTheme?.name ?? null}
          setActiveCustomThemeId={activateCustomTheme}
          clearCustomTheme={() => activateBuiltInTheme(theme.kind)}
          formatter={formatter}
          setFormatter={setFormatter}
          sqlLinter={sqlLinter}
          setSqlLinter={setSqlLinter}
          sqlSnippets={sqlSnippets}
          setSqlSnippets={setSqlSnippets}
          resultOffloadEnabled={resultOffloadEnabled}
          setResultOffloadEnabled={setResultOffloadEnabled}
          resultMemoryBudget={resultMemoryBudget}
          setResultMemoryBudget={setResultMemoryBudget}
          queryHistoryMaxItems={queryHistoryMaxItems}
          setQueryHistoryMaxItems={setQueryHistoryMaxItems}
          queryHistoryResultRows={queryHistoryResultRows}
          setQueryHistoryResultRows={setQueryHistoryResultRows}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          commandCatalog={appCommandCatalog}
          keymap={keymap}
          keymapOverrides={keymapOverrides}
          keymapConflicts={keymapConflicts}
          vimKeymapConflicts={vimKeymapConflicts}
          recordingCommand={recordingCommand}
          recordingSequence={recordingSequence}
          runCommand={runCommand}
          beginRecording={beginRecording}
          resetKeybinding={resetKeybinding}
          applyVimKeybindingResolutions={applyVimKeybindingPlan}
          jobs={jobs}
          jobsLoading={jobsLoading}
          jobsError={jobsError}
          refreshJobs={refreshJobs}
          settingsJsonDraft={settingsJsonDraft}
          setSettingsJsonDraft={setSettingsJsonDraft}
          settingsJsonError={settingsJsonError}
          setSettingsJsonError={setSettingsJsonError}
          resetSettingsJsonDraft={resetSettingsJsonDraft}
          applySettingsJson={applySettingsJson}
        />
      ) : null}

      {aboutOpen ? (
        <AboutDialog
          appName={APP_NAME}
          appVersion={APP_VERSION}
          appIdentifier={APP_IDENTIFIER}
          runtimeLabel={
            tauriRuntimeError() ? "Browser preview" : "Tauri desktop"
          }
          activeConnectionLabel={`${activeConnection.name} \u00b7 ${
            activeConnectionOpen ? "connected" : "closed"
          }`}
          onClose={() => setAboutOpen(false)}
          onCopyDiagnostics={() => void copyAppDiagnostics()}
        />
      ) : null}

      {queryHistoryDialogOpen ? (
        <Suspense fallback={null}>
          <QueryHistoryDialog
            activeConnectionId={activeConnectionId}
            activeConnectionOpen={activeConnectionOpen}
            running={running}
            connectionById={connectionById}
            onLoad={loadHistoryItem}
            onRun={(item) => void runHistoryItem(item)}
            onRestoreResult={restoreHistoryResult}
          />
        </Suspense>
      ) : null}

      {pendingQueryParameters ? (
        <QueryParameterDialog
          pending={pendingQueryParameters}
          values={parameterDraftValues}
          onValuesChange={setParameterDraftValues}
          onClose={() => setPendingQueryParameters(null)}
          onSubmit={submitQueryParameters}
        />
      ) : null}

      {paletteOpen ? (
        <CommandPalette
          query={paletteQuery}
          commands={paletteResults}
          keymap={keymap}
          onQueryChange={setPaletteQuery}
          onRunCommand={runCommand}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}

      {importPreview || importError ? (
        <ImportDialog
          preview={importPreview}
          error={importError}
          sqlPreview={importSqlPreview}
          onPreviewChange={setImportPreview}
          onClose={() => {
            setImportPreview(null);
            setImportError(null);
          }}
          onPutSqlInEditor={putImportSqlInEditor}
          formatCell={formatCell}
          formatCount={toCount}
        />
      ) : null}

      {schemaDesignerOpen ? (
        <SchemaDesignerDialog
          draft={schemaDraft}
          sqlPreview={schemaSqlPreview}
          onDraftChange={setSchemaDraft}
          onClose={() => setSchemaDesignerOpen(false)}
          onCopySql={() => void copySchemaSql()}
          onPutSqlInEditor={putSchemaSqlInEditor}
        />
      ) : null}

      {diagramOpen ? (
        <ErdDialog
          activeConnectionName={activeConnection.name}
          model={diagramModel}
          layout={diagramLayout}
          svgRef={diagramSvgRef}
          canvasRef={diagramCanvasRef}
          svgStyle={diagramSvgStyle}
          zoom={diagramZoom}
          search={diagramSearch}
          schemaNames={diagramSchemaNames}
          availableSchemas={availableDiagramSchemas}
          error={diagramError}
          metadataLoaded={Boolean(activeMetadata)}
          onClose={() => setDiagramOpen(false)}
          onFit={fitDiagramToViewport}
          onZoomChange={setDiagramZoom}
          onSearchChange={setDiagramSearch}
          onSchemaNamesChange={setDiagramSchemaNames}
          onCopySvg={copyDiagramSvg}
          onCopyPng={() => void copyDiagramPng()}
          onDownloadSvg={downloadDiagramSvg}
          onDownloadPng={() => void downloadDiagramPng()}
          onDownloadSpecMarkdown={downloadTableSpecMarkdown}
          onDownloadSpecJson={downloadTableSpecJson}
          onLoadSpecDdl={() => schemaSpecFileRef.current?.click()}
          onCopyMermaid={() => {
            if (activeMetadata) {
              void navigator.clipboard?.writeText(diagramMermaid);
            }
          }}
        />
      ) : null}

      <input
        ref={schemaSpecFileRef}
        type="file"
        accept=".json,.irodori-schema.json,application/json"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            void handleSchemaSpecFile(file);
          }
        }}
      />

      {actionNotice ? (
        <ActionToast
          notice={actionNotice}
          onDismiss={() => setActionNotice(null)}
        />
      ) : null}
    </div>
  );
}
