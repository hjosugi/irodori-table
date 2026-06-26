import {
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Folder,
  Plus,
} from "lucide-react";
import { runQuerySpill, runQueryStream } from "./lib/tauri/db-stream";
import {
  createQueryHistoryResultSnapshot,
  QueryHistoryDialog,
  queryHistoryMaxItemsHardLimit,
  queryHistoryResultRowsHardLimit,
  useQueryHistoryStore,
  type QueryHistoryItem,
  type QueryHistoryResultSnapshot,
} from "./features/query-history";
import {
  APP_IDENTIFIER,
  APP_NAME,
  APP_VERSION,
  appCommandCatalog,
  fallbackSnapshot,
  loadSavedQuery,
  resultCopyDefaultKeymap,
  resultRows,
  savedQueryStorageKey,
  tabs,
} from "./app/app-config";
import { AboutDialog } from "./app/AboutDialog";
import { ActionToast, type ActionNotice } from "./app/ActionToast";
import { CommandPalette } from "./app/CommandPalette";
import { GitDrawer, useGitStore } from "./features/git";
import {
  ResultsPane,
  normalizeResultCellRange,
  readResultCellRangeRows,
  summarizeResultCellRange,
  useResultGridStore,
  useResultsStore,
  type ResultGridEditDraft,
  type ResultSelectionSummary,
} from "./features/results";
import {
  defaultConnectionColor,
  describeConnection,
  engineLabel,
  memoryDefaults,
  newDraft,
  profileFromDraft,
  repairBuiltinSampleProfile,
  sanitizedProfile,
  settingsProfileFromJson,
  useConnectionStore,
  validateDraft,
  withStarterProfiles,
  withUniqueProfileIds,
  type ConnectionDraft,
  type WorkspaceConnection,
} from "./features/connections";
import { ConnectionManagerDialog } from "./features/connections/ConnectionManagerDialog";
import {
  QueryEditorPane,
  QueryParameterDialog,
  type PendingQueryParameters,
  type EditorGroup,
  type EditorSelection,
} from "./features/query-editor";
import { ImportDialog, type ImportPreview } from "./features/import/ImportDialog";
import { ErdDialog } from "./features/erd/ErdDialog";
import { SchemaDesignerDialog } from "./features/schema-designer/SchemaDesignerDialog";
import { SettingsDialog, type SettingsTab } from "./features/settings";
import { usePreferencesStore } from "./features/preferences";
import { normalizeLocale } from "./i18n";
import {
  createWorkbenchCommandHandler,
  Inspector,
  Sidebar,
  WorkbenchShell,
  useWorkbenchStore,
} from "./features/workbench";
import {
  WindowedRows,
  createWindowedRowsProxy,
} from "./result-window";
import {
  buildErdModel,
  hasDiagram,
  layoutErdModel,
  toMermaidErd,
  type ErdLayout,
} from "./erd";
import {
  downloadBlob,
  erdFileName,
  serializeSvgElement,
  svgMarkupToPngBlob,
  writePngBlobToClipboard,
  writeTextToClipboard,
} from "./erd-export";
import { erdSvgStyle } from "./erd-svg";
import { errorMessage } from "./errors";
import {
  detectImportFileKind,
  generateImportSql,
  inferImportTableName,
  parseImportText,
} from "./importers";
import {
  KEY_SEQUENCE_TIMEOUT_MS,
  effectiveKeymap,
  eventToChord,
  findConflicts,
  formatKeySequence,
  type KeybindingScope,
  type Keymap,
  loadOverrides,
  resolveKeybinding,
  saveOverrides,
} from "./keybindings";
import {
  buildResultExport,
  resultExportFileName,
  type ResultExportFormat,
} from "./result-export";
import {
  calculateResultGridVirtualColumnWindow,
  calculateResultGridVirtualRowWindow,
  cycleResultSortRules,
  formatResultGridTsv,
  formatResultGridTsvRow,
  type ResultFilterRule,
  type ResultGridRowLike,
  type ResultSortRule,
} from "./result-grid";
import {
  buildResultGridViewModel,
  formatResultGridCell as formatCell,
  resultGridRowKey,
  type ResultGridDraftCell as GridCellDraft,
  type ResultGridRowOrigin,
} from "./result-view-model";
import { buildChartResultModel } from "./features/results/chart-result";
import { buildGraphResultModel } from "./features/results/graph-result";
import {
  deriveResultEditTarget,
  type ResultEditTarget,
} from "./result-edit-target";
import { useSchemaDesignerStore } from "./features/schema-designer/schema-designer-store";
import { buildSchemaSql } from "./schema-designer";
import {
  dbApplyEdits,
  dbCancel,
  dbConnect,
  dbDisconnect,
  dbIndexSchema,
  dbListObjects,
  dbQueryParameters,
  dbReleaseResult,
  dbResultWindow,
  jobsCancel,
  jobsList,
  type CellValue,
  type DatabaseMetadata,
  type DbEngine,
  type DbObjectMetadata,
  type JobList,
  type QueryResult,
  type QueryResultSet,
  type QueryParameterInput,
  type QueryParameterPromptSet,
  type RowDelete,
  type RowInsert,
  type RowUpdate,
  type SpillRunResult,
  type TableEdits,
  workspaceSnapshot,
  type WorkspaceSnapshot,
} from "./generated/irodori-api";
import { type SqlEditorHandle } from "./SqlEditor";
import { sqlSnippetsFromJson } from "./sql/completion";
import { isSqlFormatterId } from "./sql/formatter";
import { isSqlLinterId } from "./sql/linter";
import type { SqlEditorTransformAction } from "./sql/editor-transforms";
import { selectedOrCurrentStatement } from "./sql/statements";
import {
  cssVariables,
  customThemeEntryFromJson,
  darkTheme,
  importThemeJson,
  lightTheme,
  upsertCustomThemeEntry,
  type ThemeKind,
} from "./theme";
import { findTableMetadata, parseSourceTable } from "./row-detail";
import { parseQueryMagic, type QueryMagicAction } from "./query-magics";
import "./App.css";

const queryParameterMemoryStorageKey = "irodori.queryParameters.v1";

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function keyScopeFromTarget(
  target: EventTarget | null,
  fallback: KeybindingScope,
): KeybindingScope {
  if (!(target instanceof HTMLElement)) {
    return fallback;
  }
  if (target.closest(".cm-host")) {
    return "editor";
  }
  if (target.closest(".result-grid")) {
    return "grid";
  }
  return "global";
}

function isEditableTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function isCellEditorClipboardShortcut(
  event: KeyboardEvent,
  target: HTMLElement | null,
): boolean {
  return (
    !!target?.closest(".cell-editor") &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    ["c", "x", "v", "z"].includes(event.key.toLowerCase())
  );
}

type QueryParameterMemory = Record<string, Record<string, string>>;

// Parse pasted clipboard text (TSV, or CSV as a fallback) into a grid of strings.
function parseClipboardTable(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const delimiter = rows.some((row) => row.includes("\t")) ? "\t" : ",";
  return rows.map((row) => row.split(delimiter));
}

function toCount(value: bigint | number) {
  return Number(value).toLocaleString();
}

function formatSelectionNumber(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 6,
  });
}

function formatResultSelectionStatus(summary: ResultSelectionSummary) {
  const parts = [
    `${toCount(summary.cellCount)} cells`,
    `${toCount(summary.rowCount)}x${toCount(summary.columnCount)}`,
  ];
  if (summary.numericCount > 0) {
    parts.push(`sum ${formatSelectionNumber(summary.sum ?? 0)}`);
    parts.push(`avg ${formatSelectionNumber(summary.average ?? 0)}`);
    parts.push(`min ${formatSelectionNumber(summary.min ?? 0)}`);
    parts.push(`max ${formatSelectionNumber(summary.max ?? 0)}`);
  }
  if (summary.nullCount > 0) {
    parts.push(`null ${toCount(summary.nullCount)}`);
  }
  if (summary.textCount > 0 && summary.numericCount === 0) {
    parts.push(`text ${toCount(summary.textCount)}`);
  }
  if (summary.truncated) {
    parts.push(`sampled ${toCount(summary.sampledCellCount)}`);
  }
  return parts.join(" · ");
}

const emptyJobList: JobList = { active: [], history: [] };

function historySnapshotToQueryResult(
  snapshot: QueryHistoryResultSnapshot,
): QueryResult {
  const message = snapshot.retentionTruncated
    ? `history preview retained ${toCount(snapshot.retainedRows)} of ${toCount(
        snapshot.rowCount,
      )} rows`
    : snapshot.message;
  const resultSets =
    snapshot.resultSets && snapshot.resultSets.length > 1
      ? snapshot.resultSets.map((set) => ({
          statementIndex: set.statementIndex,
          statement: set.statement,
          columns: set.columns,
          rows: set.rows,
          rowCount: BigInt(set.retainedRows),
          elapsedMs: BigInt(set.elapsedMs),
          truncated: set.truncated || set.retentionTruncated,
          message: set.retentionTruncated
            ? `history preview retained ${toCount(set.retainedRows)} of ${toCount(
                set.rowCount,
              )} rows`
            : set.message,
        }))
      : undefined;
  return {
    columns: snapshot.columns,
    rows: snapshot.rows,
    rowCount: BigInt(snapshot.retainedRows),
    elapsedMs: BigInt(snapshot.elapsedMs),
    truncated: snapshot.truncated || snapshot.retentionTruncated,
    message,
    resultSets,
  };
}

function objectKindLabel(object: DbObjectMetadata) {
  switch (object.kind) {
    case "view":
      return "view";
    case "function":
      return "function";
    case "procedure":
      return "procedure";
    case "index":
      return "index";
    default:
      return "table";
  }
}

function quoteSqlIdentifier(engine: DbEngine, name: string) {
  const quote = engine === "mysql" || engine === "mariadb" || engine === "tidb" ? "`" : '"';
  return `${quote}${name.split(quote).join(quote + quote)}${quote}`;
}

function qualifiedObjectName(engine: DbEngine, object: DbObjectMetadata) {
  const parts = [object.schema, object.name].filter(Boolean);
  return parts.map((part) => quoteSqlIdentifier(engine, part)).join(".");
}

function tablePreviewSql(engine: DbEngine, object: DbObjectMetadata) {
  const table = qualifiedObjectName(engine, object);
  if (engine === "sqlserver") {
    return `select top (200) * from ${table};`;
  }
  return `select * from ${table} limit 200;`;
}

type CompletionHint = {
  label: string;
  detail: string;
  insertText: string;
};

function completionHintsFromMetadata(
  metadata: DatabaseMetadata | undefined,
): CompletionHint[] {
  if (!metadata) {
    return [];
  }
  const relationHints = metadata.schemas.flatMap((schema) =>
    schema.objects
      .filter((object) => object.kind !== "index")
      .map((object) => {
        const qualifiedName = schema.name
          ? `${schema.name}.${object.name}`
          : object.name;
        return {
          label: object.name,
          detail: `${schema.name || "default"} ${objectKindLabel(object)}`,
          insertText:
            object.kind === "function" || object.kind === "procedure"
              ? `${qualifiedName}()`
              : qualifiedName,
        };
      }),
  );
  const columnHints = metadata.schemas.flatMap((schema) =>
    schema.objects
      .filter((object) => object.kind === "table" || object.kind === "view")
      .flatMap((object) =>
        object.columns.slice(0, 4).map((column) => ({
          label: `${object.name}.${column.name}`,
          detail: `${column.dataType}${column.nullable ? "" : " not null"}`,
          insertText: `${object.name}.${column.name}`,
        })),
      ),
  );
  return [...relationHints, ...columnHints].slice(0, 8);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function builtInTheme(kind: ThemeKind) {
  return kind === "dark" ? darkTheme : lightTheme;
}

function loadQueryParameterMemory(): QueryParameterMemory {
  try {
    const raw = window.localStorage.getItem(queryParameterMemoryStorageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    const memory: QueryParameterMemory = {};
    for (const [signature, values] of Object.entries(parsed)) {
      if (!isRecord(values)) {
        continue;
      }
      const entry: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === "string") {
          entry[key] = value;
        }
      }
      memory[signature] = entry;
    }
    return memory;
  } catch {
    return {};
  }
}

function parseParameterValue(input: string): unknown {
  const trimmed = input.trim();
  if (trimmed === "null") {
    return null;
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isSafeInteger(value)) {
      return value;
    }
  }
  if (/^-?(?:\d+\.\d+|\d+e[+-]?\d+|\d+\.\d+e[+-]?\d+)$/i.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return input;
    }
  }
  return input;
}

function buildParameterInputs(
  promptSet: QueryParameterPromptSet,
  values: Record<string, string>,
): QueryParameterInput[] {
  return promptSet.prompts.map((prompt) => ({
    key: prompt.key,
    value: parseParameterValue(values[prompt.id] ?? ""),
  }));
}

function tauriRuntimeError() {
  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }
  ).__TAURI_INTERNALS__;
  if (typeof internals?.invoke === "function") {
    return null;
  }
  return "Tauri desktop runtime is not available. Open the Tauri app window, not the Vite browser URL.";
}

// Result grid virtualization: fixed row height (mirrors `.grid-row` / `.grid-pad`
// in App.css) and how many off-screen rows to keep rendered above/below the
// viewport so fast scrolling does not flash blank rows.
const GRID_ROW_HEIGHT = 27;
const GRID_OVERSCAN = 8;
const GRID_COLUMN_WIDTH = 148;
const GRID_COLUMN_OVERSCAN = 2;
const GRID_GUTTER_WIDTH = 34;
const GRID_WINDOWED_ROW_THRESHOLD = 50_000;
const GRID_WINDOWED_CELL_THRESHOLD = 250_000;

// EXEC-010 disk-offload paging: rows per `db_result_window` fetch and how many
// pages stay resident before LRU eviction. `24 * 1000 = 24k` rows is the flat-
// memory ceiling on the client regardless of total result size.
const RESULT_WINDOW_PAGE_SIZE = 1_000;
const RESULT_WINDOW_MAX_RESIDENT_PAGES = 24;
// Stable empty collections so a disk-offloaded result forces the windowed grid
// path (no client-side edits/filters/sort over a result that lives on disk).
const EMPTY_CELL_EDITS: ReadonlyMap<string, GridCellDraft> = new Map();
const EMPTY_NEW_ROWS: readonly (readonly GridCellDraft[])[] = [];
const EMPTY_DELETED_ROWS: ReadonlySet<number> = new Set();
const EMPTY_FILTER_RULES: readonly ResultFilterRule[] = [];
const EMPTY_SORT_RULES: readonly ResultSortRule[] = [];
const GRID_COPY_ROW_LIMIT = 50_000;
const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 420;
const INSPECTOR_WIDTH_MIN = 220;
const INSPECTOR_WIDTH_MAX = 420;
const RESULTS_HEIGHT_MIN = 150;
const RESULTS_HEIGHT_MAX = 520;
const EDITOR_SPLIT_MIN = 28;
const EDITOR_SPLIT_MAX = 72;

function App() {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const diagramSvgRef = useRef<SVGSVGElement | null>(null);
  const diagramCanvasRef = useRef<HTMLDivElement | null>(null);
  const pendingDiagramSearchRef = useRef<string | null>(null);
  const actionNoticeTimerRef = useRef<number | null>(null);
  const gridScrollRaf = useRef<number | null>(null);
  const pendingGridScroll = useRef({ top: 0, left: 0 });
  const gridScrollTop = useResultGridStore((state) => state.gridScrollTop);
  const setGridScrollTop = useResultGridStore((state) => state.setGridScrollTop);
  const gridScrollLeft = useResultGridStore((state) => state.gridScrollLeft);
  const setGridScrollLeft = useResultGridStore((state) => state.setGridScrollLeft);
  const gridViewportHeight = useResultGridStore(
    (state) => state.gridViewportHeight,
  );
  const setGridViewportHeight = useResultGridStore(
    (state) => state.setGridViewportHeight,
  );
  const gridViewportWidth = useResultGridStore(
    (state) => state.gridViewportWidth,
  );
  const setGridViewportWidth = useResultGridStore(
    (state) => state.setGridViewportWidth,
  );
  const editorApiRef = useRef<SqlEditorHandle>(null);
  const secondaryEditorApiRef = useRef<SqlEditorHandle>(null);
  const editorSplitRef = useRef<HTMLDivElement | null>(null);
  const [editorSelection, setEditorSelection] = useState<EditorSelection>({
    from: 0,
    to: 0,
  });
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(fallbackSnapshot);
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [openTabIds, setOpenTabIds] = useState(() =>
    tabs.map((tab) => tab.id),
  );
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const setActiveConnectionId = useConnectionStore(
    (state) => state.setActiveConnectionId,
  );
  const [query, setQuery] = useState(loadSavedQuery);
  const locale = usePreferencesStore((state) => state.locale);
  const setLocale = usePreferencesStore((state) => state.setLocale);
  const themeKind = usePreferencesStore((state) => state.themeKind);
  const setThemeKind = usePreferencesStore((state) => state.setThemeKind);
  const activeCustomThemeId = usePreferencesStore(
    (state) => state.activeCustomThemeId,
  );
  const setActiveCustomThemeId = usePreferencesStore(
    (state) => state.setActiveCustomThemeId,
  );
  const customThemes = usePreferencesStore((state) => state.customThemes);
  const setCustomThemes = usePreferencesStore(
    (state) => state.setCustomThemes,
  );
  const activeCustomTheme = useMemo(
    () =>
      customThemes.find((entry) => entry.id === activeCustomThemeId) ?? null,
    [activeCustomThemeId, customThemes],
  );
  const theme = activeCustomTheme?.theme ?? builtInTheme(themeKind);
  const vimMode = usePreferencesStore((state) => state.vimMode);
  const setVimMode = usePreferencesStore((state) => state.setVimMode);
  const formatter = usePreferencesStore((state) => state.formatter);
  const setFormatter = usePreferencesStore((state) => state.setFormatter);
  const sqlLinter = usePreferencesStore((state) => state.sqlLinter);
  const setSqlLinter = usePreferencesStore((state) => state.setSqlLinter);
  const sqlSnippets = usePreferencesStore((state) => state.sqlSnippets);
  const setSqlSnippets = usePreferencesStore((state) => state.setSqlSnippets);
  const autoCommit = usePreferencesStore((state) => state.autoCommit);
  const setAutoCommit = usePreferencesStore((state) => state.setAutoCommit);
  const sidebarOpen = useWorkbenchStore((state) => state.sidebarOpen);
  const setSidebarOpen = useWorkbenchStore((state) => state.setSidebarOpen);
  const sidebarSide = useWorkbenchStore((state) => state.sidebarSide);
  const setSidebarSide = useWorkbenchStore((state) => state.setSidebarSide);
  const sidebarWidth = useWorkbenchStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkbenchStore((state) => state.setSidebarWidth);
  const inspectorWidth = useWorkbenchStore((state) => state.inspectorWidth);
  const setInspectorWidth = useWorkbenchStore(
    (state) => state.setInspectorWidth,
  );
  const resultsHeight = useWorkbenchStore((state) => state.resultsHeight);
  const setResultsHeight = useWorkbenchStore(
    (state) => state.setResultsHeight,
  );
  const editorSplitMode = useWorkbenchStore(
    (state) => state.editorSplitMode,
  );
  const setEditorSplitMode = useWorkbenchStore(
    (state) => state.setEditorSplitMode,
  );
  const editorSplitPercent = useWorkbenchStore(
    (state) => state.editorSplitPercent,
  );
  const setEditorSplitPercent = useWorkbenchStore(
    (state) => state.setEditorSplitPercent,
  );
  const [preferredEditorGroup, setActiveEditorGroup] =
    useState<EditorGroup>("primary");
  const activeEditorGroup: EditorGroup =
    editorSplitMode === "single" ? "primary" : preferredEditorGroup;
  const [running, setRunning] = useState(false);
  // Id of the in-flight query so the Cancel button can stop that specific run.
  const runningQueryIdRef = useRef<string | null>(null);
  const profiles = useConnectionStore((state) => state.profiles);
  const setProfiles = useConnectionStore((state) => state.setProfiles);
  const selectedProfileId = useConnectionStore((state) => state.selectedProfileId);
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
  const connectionSearch = useConnectionStore((state) => state.connectionSearch);
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
  const setMetadataErrors = useConnectionStore((state) => state.setMetadataErrors);
  const objectActionMenu = useConnectionStore((state) => state.objectActionMenu);
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
  const spillRef = useRef<{ handle: string; source: WindowedRows } | null>(null);
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
  const sortRules = useResultGridStore((state) => state.sortRules);
  const setSortRules = useResultGridStore((state) => state.setSortRules);
  const filtersOpen = useResultGridStore((state) => state.filtersOpen);
  const setFiltersOpen = useResultGridStore((state) => state.setFiltersOpen);
  const quickFilter = useResultGridStore((state) => state.quickFilter);
  const setQuickFilter = useResultGridStore((state) => state.setQuickFilter);
  const filterJoin = useResultGridStore((state) => state.filterJoin);
  const setFilterJoin = useResultGridStore((state) => state.setFilterJoin);
  const filterRules = useResultGridStore((state) => state.filterRules);
  const setFilterRules = useResultGridStore((state) => state.setFilterRules);
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
  const [diagramError, setDiagramError] = useState<string | null>(null);
  const [diagramSearch, setDiagramSearch] = useState("");
  const [diagramSchemaNames, setDiagramSchemaNames] = useState<string[]>([]);
  const [diagramZoom, setDiagramZoom] = useState(1);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const [importError, setImportError] = useState<string | null>(null);
  const schemaDesignerOpen = useSchemaDesignerStore((state) => state.open);
  const setSchemaDesignerOpen = useSchemaDesignerStore((state) => state.setOpen);
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
  const openGitDrawer = useGitStore((state) => state.openDrawer);
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
  const activeConnectionColor =
    activeProfile?.color || profileById.get(activeConnectionId)?.color || defaultConnectionColor;
  const activeConnectionStatus = activeConnectionOpen
    ? `Connected · ${activeConnection.latencyMs} ms`
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

  // Track the result grid viewport so both row and column windows cover it.
  useEffect(() => {
    const element = gridRef.current;
    if (!element) {
      return;
    }
    const measure = () => {
      setGridViewportHeight(element.clientHeight);
      setGridViewportWidth(element.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [result]);

  // Dialect for the editor: prefer the active connection's profile engine,
  // then the connection-form draft, then Postgres.
  const editorEngine = useMemo<DbEngine>(() => {
    const profile = profiles.find((item) => item.id === activeConnectionId);
    return profile?.engine ?? draft.engine ?? "postgres";
  }, [profiles, activeConnectionId, draft.engine]);

  const openTabs = useMemo(
    () => tabs.filter((tab) => openTabIds.includes(tab.id)),
    [openTabIds],
  );
  const activeTabLabel =
    openTabs.find((tab) => tab.id === activeTab)?.label ?? "Scratch";
  const selectedEditorSql = query
    .slice(editorSelection.from, editorSelection.to)
    .trim();
  const hasSelectedEditorSql = selectedEditorSql.length > 0;
  const runPrimaryLabel = hasSelectedEditorSql ? "Run Selection" : "Run Current";
  const runShortcutLabel = formatKeySequence(keymap["query.run"] ?? "");
  const runCurrentShortcutLabel = formatKeySequence(
    keymap["query.runCurrent"] ?? "",
  );
  const runFromStartShortcutLabel = formatKeySequence(
    keymap["query.runFromStart"] ?? "",
  );
  const runAllShortcutLabel = formatKeySequence(keymap["query.runAll"] ?? "");

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

  const resultColumns = activeResult?.columns ?? [
    "id",
    "name",
    "lifetime_value",
    "last_order_at",
  ];
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
  const gridGutterWidth = editMode ? GRID_GUTTER_WIDTH : 0;
  const gridTotalWidth = Math.max(
    1,
    gridGutterWidth + resultColumns.length * GRID_COLUMN_WIDTH,
  );
  const columnWindow = calculateResultGridVirtualColumnWindow({
    columnCount: resultColumns.length,
    scrollLeft: Math.max(0, gridScrollLeft - gridGutterWidth),
    viewportWidth: Math.max(0, gridViewportWidth - gridGutterWidth),
    columnWidth: GRID_COLUMN_WIDTH,
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
    editMode ? `${GRID_GUTTER_WIDTH}px` : null,
    leftColumnPad > 0 ? `${leftColumnPad}px` : null,
    ...visibleColumnIndexes.map(() => `${GRID_COLUMN_WIDTH}px`),
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
          rows: activeResult?.rows ?? resultRows,
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
  const selectedRangeBounds = useMemo(
    () => normalizeResultCellRange(resultGridView, selectedRange),
    [resultGridView, selectedRange],
  );
  const selectionSummary = useMemo(
    () => summarizeResultCellRange(resultGridView, selectedRangeBounds),
    [resultGridView, selectedRangeBounds],
  );
  const selectionStatus = selectionSummary
    ? formatResultSelectionStatus(selectionSummary)
    : null;

  const chartResultModel = useMemo(() => {
    if (!activeResult || spillInfo || resultColumns.length === 0) {
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
  }, [activeResult, resultColumns, resultGridView, spillInfo]);
  const chartAvailable = Boolean(chartResultModel);

  // Virtualize the result grid: render only the rows in (and just around) the
  // viewport, with top/bottom spacers preserving the scrollbar. A 10k-row page is
  // ~30 DOM rows instead of 10k, so streaming stays smooth.
  const totalRows = totalRowCount;
  const rowWindow = calculateResultGridVirtualRowWindow({
    rowCount: totalRows,
    scrollTop: gridScrollTop,
    viewportHeight: gridViewportHeight,
    rowHeight: GRID_ROW_HEIGHT,
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
    if (resultMode === "chart" && (!chartAvailable || editMode)) {
      setResultMode("data");
    }
    if (resultMode === "graph" && !graphAvailable) {
      setResultMode("data");
    }
    if (resultMode === "webgl" && (!webGlAvailable || editMode)) {
      setResultMode("data");
    }
  }, [
    chartAvailable,
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

  function onGridScroll(event: UIEvent<HTMLDivElement>) {
    pendingGridScroll.current = {
      top: event.currentTarget.scrollTop,
      left: event.currentTarget.scrollLeft,
    };
    if (gridScrollRaf.current != null) {
      return;
    }
    gridScrollRaf.current = requestAnimationFrame(() => {
      gridScrollRaf.current = null;
      setGridScrollTop(pendingGridScroll.current.top);
      setGridScrollLeft(pendingGridScroll.current.left);
    });
  }

  function resetGridScrollPosition(clearSelection = false) {
    if (gridRef.current) {
      gridRef.current.scrollTop = 0;
      gridRef.current.scrollLeft = 0;
    }
    setGridScrollTop(0);
    setGridScrollLeft(0);
    if (clearSelection) {
      setSelectedRowKey(null);
      setSelectedCell(null);
      setSelectedRange(null);
    }
  }

  function selectResultSet(index: number) {
    setActiveResultIndex(index);
    resetEdits();
    resetGridView();
    resetGridScrollPosition(true);
  }

  function updateQuickFilter(value: string) {
    setQuickFilter(value);
    resetGridScrollPosition(true);
  }

  function clearQuickFilter() {
    setQuickFilter("");
    resetGridScrollPosition(true);
  }

  type PanelResizeKind = "sidebar" | "inspector" | "results" | "editorSplit";

  function resizePanel(kind: PanelResizeKind, delta: number) {
    switch (kind) {
      case "sidebar":
        setSidebarWidth((current) =>
          clampNumber(current + delta, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX),
        );
        break;
      case "inspector":
        setInspectorWidth((current) =>
          clampNumber(
            current + delta,
            INSPECTOR_WIDTH_MIN,
            INSPECTOR_WIDTH_MAX,
          ),
        );
        break;
      case "results":
        setResultsHeight((current) =>
          clampNumber(current + delta, RESULTS_HEIGHT_MIN, RESULTS_HEIGHT_MAX),
        );
        break;
      case "editorSplit":
        setEditorSplitPercent((current) =>
          clampNumber(current + delta, EDITOR_SPLIT_MIN, EDITOR_SPLIT_MAX),
        );
        break;
    }
  }

  function beginPanelResize(
    kind: PanelResizeKind,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSidebarWidth = sidebarWidth;
    const startInspectorWidth = inspectorWidth;
    const startResultsHeight = resultsHeight;
    const editorSplitBounds = editorSplitRef.current?.getBoundingClientRect();
    document.body.classList.add("panel-resizing");

    const onMove = (moveEvent: PointerEvent) => {
      if (kind === "editorSplit") {
        if (!editorSplitBounds) {
          return;
        }
        const next =
          editorSplitMode === "down"
            ? ((moveEvent.clientY - editorSplitBounds.top) /
                Math.max(1, editorSplitBounds.height)) *
              100
            : ((moveEvent.clientX - editorSplitBounds.left) /
                Math.max(1, editorSplitBounds.width)) *
              100;
        setEditorSplitPercent(
          clampNumber(next, EDITOR_SPLIT_MIN, EDITOR_SPLIT_MAX),
        );
        return;
      }
      if (kind === "sidebar") {
        // When the sidebar sits on the right its resize handle is on its left
        // edge, so dragging left should widen it — invert the delta.
        const delta = moveEvent.clientX - startX;
        setSidebarWidth(
          clampNumber(
            startSidebarWidth + (sidebarSide === "right" ? -delta : delta),
            SIDEBAR_WIDTH_MIN,
            SIDEBAR_WIDTH_MAX,
          ),
        );
        return;
      }
      if (kind === "inspector") {
        setInspectorWidth(
          clampNumber(
            startInspectorWidth - (moveEvent.clientX - startX),
            INSPECTOR_WIDTH_MIN,
            INSPECTOR_WIDTH_MAX,
          ),
        );
        return;
      }
      setResultsHeight(
        clampNumber(
          startResultsHeight - (moveEvent.clientY - startY),
          RESULTS_HEIGHT_MIN,
          RESULTS_HEIGHT_MAX,
        ),
      );
    };

    const onEnd = () => {
      document.body.classList.remove("panel-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
    window.addEventListener("pointercancel", onEnd, { once: true });
  }

  function onPanelResizeKey(
    kind: PanelResizeKind,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown"
    ) {
      return;
    }
    event.preventDefault();
    const step = event.shiftKey ? 32 : 16;
    if (kind === "editorSplit") {
      if (editorSplitMode === "down") {
        resizePanel(kind, event.key === "ArrowDown" ? 4 : -4);
      } else {
        resizePanel(kind, event.key === "ArrowRight" ? 4 : -4);
      }
      return;
    }
    if (kind === "results") {
      resizePanel(kind, event.key === "ArrowUp" ? step : -step);
      return;
    }
    const direction = kind === "sidebar" ? 1 : -1;
    resizePanel(kind, (event.key === "ArrowRight" ? step : -step) * direction);
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

  function toggleSort(col: number, additive = false) {
    setSortRules((current) => cycleResultSortRules(current, col, additive));
    resetGridScrollPosition();
  }

  function addFilterRule(columnIndex: number | "any" = "any") {
    setFilterRules((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        columnIndex,
        operator: "contains",
        value: "",
        enabled: true,
      },
    ]);
    setFiltersOpen(true);
    resetGridScrollPosition(true);
  }

  function updateFilterRule(id: string, patch: Partial<ResultFilterRule>) {
    setFilterRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
    resetGridScrollPosition(true);
  }

  function removeFilterRule(id: string) {
    setFilterRules((current) => current.filter((rule) => rule.id !== id));
    resetGridScrollPosition(true);
  }

  function clearResultFilters() {
    setQuickFilter("");
    setFilterRules([]);
    setFilterJoin("and");
    resetGridScrollPosition(true);
  }

  function selectGridCell(rowKey: string, col: number, extendRange = false) {
    const nextCell = { key: rowKey, col };
    const anchor =
      selectedRange?.anchor ??
      selectedCell ??
      (selectedRowKey ? { key: selectedRowKey, col } : nextCell);
    setSelectedRowKey(rowKey);
    setSelectedCell(nextCell);
    setSelectedRange(
      extendRange &&
        (anchor.key !== nextCell.key || anchor.col !== nextCell.col)
        ? { anchor, focus: nextCell }
        : null,
    );
    gridRef.current?.focus({ preventScroll: true });
  }

  function selectGridRow(rowKey: string, focusGrid = false) {
    setSelectedRowKey(rowKey);
    setSelectedCell(null);
    setSelectedRange(null);
    if (focusGrid) {
      gridRef.current?.focus({ preventScroll: true });
    }
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
        value === null ? originalRaw === null : value === formatCell(originalRaw);
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
    updateEditDraft((draft) => applyCellValueToDraft(draft, origin, col, value));
  }

  function addNewRow() {
    if (!canEditActiveResult()) {
      setCommitError("result editing needs a single table query with a visible key");
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

  function scrollGridCellIntoView(rowIndex: number, col: number) {
    const element = gridRef.current;
    if (!element) {
      return;
    }
    const targetTop = rowIndex * GRID_ROW_HEIGHT;
    const targetBottom = targetTop + GRID_ROW_HEIGHT;
    let nextTop = element.scrollTop;
    if (targetTop < element.scrollTop) {
      nextTop = targetTop;
    } else if (targetBottom > element.scrollTop + element.clientHeight) {
      nextTop = targetBottom - element.clientHeight;
    }

    const targetLeft = gridGutterWidth + col * GRID_COLUMN_WIDTH;
    const targetRight = targetLeft + GRID_COLUMN_WIDTH;
    let nextLeft = element.scrollLeft;
    if (targetLeft < element.scrollLeft) {
      nextLeft = targetLeft;
    } else if (targetRight > element.scrollLeft + element.clientWidth) {
      nextLeft = targetRight - element.clientWidth;
    }

    element.scrollTop = Math.max(0, nextTop);
    element.scrollLeft = Math.max(0, nextLeft);
    setGridScrollTop(element.scrollTop);
    setGridScrollLeft(element.scrollLeft);
  }

  function moveSelectedCell(
    rowDelta: number,
    colDelta: number,
    extendRange = false,
  ) {
    if (totalRows === 0 || resultColumns.length === 0) {
      return;
    }
    const firstRow = resultGridView.rowAt(0);
    const currentKey = selectedCell?.key ?? selectedRowKey ?? firstRow?.key;
    const currentRowIndex = currentKey
      ? Math.max(0, resultGridView.displayIndexForKey(currentKey))
      : 0;
    const currentCol = selectedCell?.col ?? 0;
    const nextRowIndex = clampNumber(
      currentRowIndex + rowDelta,
      0,
      totalRows - 1,
    );
    const nextCol = clampNumber(
      currentCol + colDelta,
      0,
      Math.max(0, resultColumns.length - 1),
    );
    const nextRow = resultGridView.rowAt(nextRowIndex);
    if (!nextRow) {
      return;
    }
    const nextCell = { key: nextRow.key, col: nextCol };
    const anchor =
      selectedRange?.anchor ??
      selectedCell ??
      (currentKey ? { key: currentKey, col: currentCol } : nextCell);
    setSelectedRowKey(nextCell.key);
    setSelectedCell(nextCell);
    setSelectedRange(
      extendRange &&
        (anchor.key !== nextCell.key || anchor.col !== nextCell.col)
        ? { anchor, focus: nextCell }
        : null,
    );
    gridRef.current?.focus({ preventScroll: true });
    scrollGridCellIntoView(nextRowIndex, nextCol);
  }

  function selectedDisplayRow() {
    if (!selectedCell && !selectedRowKey) {
      return null;
    }
    const key = selectedCell?.key ?? selectedRowKey;
    if (!key) {
      return null;
    }
    const index = resultGridView.displayIndexForKey(key);
    return index >= 0 ? resultGridView.rowAt(index) : null;
  }

  function selectedRowForCopy() {
    const key = selectedRowKey ?? selectedCell?.key;
    if (!key) {
      return null;
    }
    const index = resultGridView.displayIndexForKey(key);
    return index >= 0 ? resultGridView.rowAt(index) : null;
  }

  function copyCellsForRow(row: ResultGridRowLike): string[] {
    return resultColumns.map((_, index) => row.cells[index] ?? "");
  }

  function selectedGridCopyText(): string | null {
    if (selectedRangeBounds) {
      return readResultCellRangeRows(resultGridView, selectedRangeBounds)
        .map(formatResultGridTsvRow)
        .join("\n");
    }
    if (selectedCell) {
      const row = selectedDisplayRow();
      if (row) {
        return row.cells[selectedCell.col] ?? "";
      }
    }
    const row = selectedRowForCopy();
    return row ? formatResultGridTsvRow(copyCellsForRow(row)) : null;
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
    return Boolean(result && inferEditTarget());
  }

  function originalCell(rowIndex: number, column: string): CellValue {
    const col = resultColumns.indexOf(column);
    return { column, value: activeResult?.rows[rowIndex]?.[col] ?? null };
  }

  async function commitEdits() {
    const target = inferEditTarget();
    if (!target) {
      const message = "could not detect an editable target table from the query";
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
  // JOB-002/004: start a background schema-index job; it streams into the jobs
  // dashboard (progress / cancel / artifact) which we open so the user can watch it.
  async function buildSchemaIndexJob() {
    if (!activeConnectionOpen) {
      showActionNotice(
        "error",
        "Index failed",
        `not connected: ${activeConnectionId}`,
      );
      return;
    }
    try {
      const jobId = await dbIndexSchema(activeConnectionId);
      showActionNotice(
        "success",
        "Indexing schema",
        `Job ${jobId} started — track it in Jobs`,
      );
      openSettingsSection("jobs");
    } catch (error) {
      showActionNotice("error", "Index failed", errorMessage(error));
    }
  }

  function closeActiveSqlTab() {
    const activeIndex = openTabs.findIndex((tab) => tab.id === activeTab);
    if (openTabs.length <= 1 || activeIndex < 0) {
      showActionNotice(
        "info",
        "Tab kept open",
        "The last SQL tab stays open so Ctrl+W never closes the browser tab.",
      );
      return;
    }
    const closedTab = openTabs[activeIndex];
    const nextTab =
      openTabs[activeIndex + 1] ?? openTabs[activeIndex - 1] ?? openTabs[0];
    setOpenTabIds((current) => current.filter((id) => id !== closedTab.id));
    setActiveTab(nextTab.id);
    showActionNotice("info", "Tab closed", closedTab.label);
  }

  function reopenSqlTab() {
    const closedTab = tabs.find((tab) => !openTabIds.includes(tab.id));
    if (!closedTab) {
      showActionNotice("info", "Tabs already open");
      return;
    }
    setOpenTabIds((current) => [...current, closedTab.id]);
    setActiveTab(closedTab.id);
    showActionNotice("success", "Tab restored", closedTab.label);
  }

  const runCommand = createWorkbenchCommandHandler({
    editMode,
    openPalette: () => {
      setPaletteQuery("");
      setPaletteOpen(true);
    },
    openSettings: () => openSettingsSection("general"),
    openHistory: openQueryHistoryDialog,
    openGit: openGitDrawer,
    openHelp: () => setAboutOpen(true),
    openConnectionManager: () => setConnectionManagerOpen(true),
    openDiagram: () => setDiagramOpen(true),
    closeActiveTab: closeActiveSqlTab,
    buildSchemaIndex: () => void buildSchemaIndexJob(),
    runQuery,
    runCurrentQuery,
    runFromStartQuery,
    runAllQuery,
    cancelQuery,
    focusEditor: () => activeEditorApi()?.focus(),
    formatQuery,
    toggleEditorComment: () => activeEditorApi()?.toggleComment(),
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
  });

  const keymapConflicts = findConflicts(keymap, appCommandCatalog);
  const paletteResults = appCommandCatalog.filter((command) =>
    `${command.title} ${command.category}`
      .toLowerCase()
      .includes(paletteQuery.trim().toLowerCase()),
  );

  function activateBuiltInTheme(value: ThemeKind | ((kind: ThemeKind) => ThemeKind)) {
    const nextThemeKind = typeof value === "function" ? value(themeKind) : value;
    setThemeKind(nextThemeKind);
    setActiveCustomThemeId(null);
  }

  function activateCustomTheme(themeId: string | null) {
    if (!themeId) {
      setActiveCustomThemeId(null);
      return;
    }
    const entry = customThemes.find((customTheme) => customTheme.id === themeId);
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
        theme: activeCustomTheme?.theme ?? themeKind,
        activeCustomThemeId,
        customThemes,
        editor: {
          vimMode,
          autoCommit,
          formatter,
          linter: sqlLinter,
          snippets: sqlSnippets,
        },
        queryHistory: {
          maxItems: queryHistoryMaxItems,
          resultRows: queryHistoryResultRows,
        },
        layout: {
          sidebarOpen,
          sidebarSide,
          sidebarWidth,
          inspectorWidth,
          resultsHeight,
        },
        activeConnectionId,
        keymapOverrides,
        connections: profiles.map(sanitizedProfile),
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

  async function cancelJob(jobId: string) {
    setJobsError(null);
    try {
      await jobsCancel(jobId);
      await refreshJobs();
      showActionNotice("info", "Job cancellation requested", jobId);
    } catch (error) {
      const message = errorMessage(error);
      setJobsError(message);
      showActionNotice("error", "Job cancellation failed", message);
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
      if (parsed.theme === "dark" || parsed.theme === "light") {
        activateBuiltInTheme(parsed.theme);
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
        nextCustomThemes.some((entry) => entry.id === parsed.activeCustomThemeId)
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
      if (nextActiveCustomThemeId === undefined && Array.isArray(parsed.customThemes)) {
        setActiveCustomThemeId(null);
      }
      if (isRecord(parsed.editor)) {
        if (typeof parsed.editor.vimMode === "boolean") {
          setVimMode(parsed.editor.vimMode);
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
      if (isRecord(parsed.layout)) {
        if (typeof parsed.layout.sidebarOpen === "boolean") {
          setSidebarOpen(parsed.layout.sidebarOpen);
        }
        if (
          parsed.layout.sidebarSide === "left" ||
          parsed.layout.sidebarSide === "right"
        ) {
          setSidebarSide(parsed.layout.sidebarSide);
        }
        const nextSidebarWidth = Number(parsed.layout.sidebarWidth);
        if (Number.isFinite(nextSidebarWidth)) {
          setSidebarWidth(
            clampNumber(
              nextSidebarWidth,
              SIDEBAR_WIDTH_MIN,
              SIDEBAR_WIDTH_MAX,
            ),
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
        for (const [commandId, chord] of Object.entries(parsed.keymapOverrides)) {
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
            nextProfiles.some((profile) => profile.id === parsed.activeConnectionId)
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
    actionNoticeTimerRef.current = window.setTimeout(() => {
      setActionNotice(null);
      actionNoticeTimerRef.current = null;
    }, kind === "error" ? 5200 : 3200);
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

  const resultSummary = activeResult
    ? `${toCount(activeResult.rowCount)} rows${activeResult.truncated ? " capped" : ""} in ${toCount(
        activeResult.elapsedMs,
      )} ms`
    : "sample preview";
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
    const cleanDraft = repairBuiltinSampleProfile(sanitizedProfile(draft));
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

  function exportActiveResult(format: ResultExportFormat) {
    if (!activeResult) {
      showActionNotice("info", "No result to export");
      return;
    }
    const target = inferEditTarget();
    const exported = buildResultExport(
      activeResult,
      format,
      target?.table ?? "query_result",
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
    if (!activeResult) {
      showActionNotice("info", "No result to copy");
      return;
    }
    const target = inferEditTarget();
    const exported = buildResultExport(
      activeResult,
      "sql",
      target?.table ?? "query_result",
    );
    try {
      await writeTextToClipboard(exported.content);
      showActionNotice(
        "success",
        "INSERT SQL copied",
        `${toCount(activeResult.rows.length)} rows`,
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
      showActionNotice("success", "ERD SVG exported", erdFileName(activeConnectionId, "svg"));
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
      showActionNotice("success", "ERD PNG exported", erdFileName(activeConnectionId, "png"));
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
    showActionNotice("success", "Import SQL generated", importPreview.tableName);
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

  function formatQuery() {
    const error = activeEditorApi()?.format();
    setQueryError(error ?? null);
    if (error) {
      showActionNotice("error", "Format failed", error);
    } else {
      showActionNotice("success", "SQL formatted", formatter);
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
      appendCommas: "Commas added",
      doubleToSingleQuotes: "Quotes converted",
    };
    showActionNotice("success", label[action]);
  }

  async function runQuery() {
    setRunMenuOpen(false);
    const selection = activeEditorApi()?.getSelection() ?? editorSelection;
    const sqlToRun = selectedOrCurrentStatement(
      selection.from,
      selection.to,
      query,
    );
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  async function runSelectionQuery() {
    setRunMenuOpen(false);
    const selection = activeEditorApi()?.getSelection() ?? editorSelection;
    const sqlToRun = query.slice(selection.from, selection.to).trim();
    if (!sqlToRun) {
      showActionNotice("info", "No selection to run");
      return;
    }
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  async function runCurrentQuery() {
    setRunMenuOpen(false);
    const selection = activeEditorApi()?.getSelection() ?? editorSelection;
    const cursor = selection.to;
    const sqlToRun = selectedOrCurrentStatement(cursor, cursor, query);
    await runEditorSql(sqlToRun, { allowMagic: true });
  }

  async function runFromStartQuery() {
    setRunMenuOpen(false);
    const selection = activeEditorApi()?.getSelection() ?? editorSelection;
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
    const magic = options.allowMagic ? parseQueryMagic(sqlToRun, activeEngine) : null;
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

  async function runSqlWithParameterPrompt(sqlToRun: string) {
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
              if (/^\s*(alter|create|drop|rename|truncate)\b/i.test(sqlToRun)) {
                void refreshObjects(activeConnectionId, true);
              }
              showActionNotice(
                "success",
                "Query finished",
                `${toCount(event.rowCount)} rows in ${toCount(event.elapsedMs)} ms`,
              );
              break;
            case "error":
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
                elapsedMs: Math.max(1, Math.round(performance.now() - started)),
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
    } finally {
      if (publishRaf !== null) {
        window.cancelAnimationFrame(publishRaf);
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
    try {
      await dbCancel(id);
      showActionNotice("info", "Cancel requested");
    } catch {
      // Best-effort: if the run already finished there is nothing to cancel.
      showActionNotice("info", "Query already finished");
    }
  }

  return (
    <>
      <WorkbenchShell
        appName={APP_NAME}
        appVersion={APP_VERSION}
        themeKind={theme.kind}
        activeKeyScope={activeKeyScope}
        sidebarOpen={sidebarOpen}
        sidebarSide={sidebarSide}
        sidebarWidth={sidebarWidth}
        inspectorWidth={inspectorWidth}
        resultsHeight={resultsHeight}
        editorSplitPercent={editorSplitPercent}
        workspaceMenuOpen={workspaceMenuOpen}
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
        shellStyle={cssVariables(theme)}
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
        onToggleTheme={() =>
          activateBuiltInTheme((kind) => (kind === "dark" ? "light" : "dark"))
        }
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        onToggleSidebarSide={() =>
          setSidebarSide((side) => (side === "left" ? "right" : "left"))
        }
        onOpenSettings={() => openSettingsSection("general")}
        onOpenKeymap={() => openSettingsSection("keymap")}
        onOpenConnectionManager={() => setConnectionManagerOpen(true)}
        onOpenGit={openGitDrawer}
        onOpenHelp={() => setAboutOpen(true)}
        onToggleWorkspaceMenu={() => setWorkspaceMenuOpen((open) => !open)}
        onCloseWorkspaceMenu={() => setWorkspaceMenuOpen(false)}
        sidebar={
          <Sidebar
            sidebarOpen={sidebarOpen}
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
            onOpenObjectSchemaDesigner={openObjectSchemaDesigner}
            onOpenDiagram={() => setDiagramOpen(true)}
            onRefreshObjects={() => refreshObjects(activeConnectionId, true, true)}
            onOpenTableData={(object) => void openTableData(object)}
            onOpenSnapshotObject={openSnapshotObject}
            onShowObjectInDiagram={showObjectInDiagram}
            onSetObjectActionMenu={setObjectActionMenu}
            onBeginResize={(event) => beginPanelResize("sidebar", event)}
            onResizeKey={(event) => onPanelResizeKey("sidebar", event)}
          />
        }
      >
        <section className="main-pane">
          <div className="tab-strip">
            <div className="tab-folder">
              <Folder size={14} />
              <span>{openTabs.find((tab) => tab.id === activeTab)?.group}</span>
            </div>
            {openTabs.map((tab) => (
              <button
                className={tab.id === activeTab ? "tab active" : "tab"}
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
            <button
              className="mini-button"
              type="button"
              title="Reopen closed tab"
              aria-label="Reopen closed tab"
              disabled={openTabs.length === tabs.length}
              onClick={reopenSqlTab}
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="editor-and-inspector">
            <QueryEditorPane
              activeTabLabel={activeTabLabel}
              activeConnectionOpen={activeConnectionOpen}
              running={running}
              formatter={formatter}
              query={query}
              onQueryChange={setQuery}
              editorEngine={editorEngine}
              activeMetadata={activeMetadata}
              sqlSnippets={sqlSnippets}
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
              setEditorSelection={setEditorSelection}
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
            />

            <div
              className="panel-resizer inspector-resizer"
              role="separator"
              aria-label="Resize inspector"
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={(event) => beginPanelResize("inspector", event)}
              onKeyDown={(event) => onPanelResizeKey("inspector", event)}
            />
            <Inspector
              activeConnectionId={activeConnectionId}
              editorEngine={editorEngine}
              connectionById={connectionById}
              activeMetadataLoading={activeMetadataLoading}
              activeMetadataError={activeMetadataError}
              completionHints={completionHints}
              onInsertCompletionHint={insertCompletionHint}
              onInsertSql={(sql) => activeEditorApi()?.insertText(sql)}
              onLoadHistorySql={setQuery}
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
            tableViewObject={tableViewObject}
            resultMode={resultMode}
            chartModel={chartResultModel}
            graphModel={graphResultModel}
            chartAvailable={chartAvailable}
            graphAvailable={graphAvailable}
            webGlAvailable={webGlAvailable}
            resultSets={resultSets}
            activeResult={activeResult}
            activeResultIndex={activeResultIndexView}
            queryError={queryError}
            commitError={commitError}
            pendingCount={pendingCount}
            displayedResultSummary={displayedResultSummary}
            quickFilter={quickFilter}
            filtersOpen={filtersOpen}
            filtersActive={filtersActive}
            activeFilters={activeFilters}
            filteredOutCount={filteredOutCount}
            filterJoin={filterJoin}
            filterRules={filterRules}
            resultColumns={resultColumns}
            exportMenuOpen={exportMenuOpen}
            editMode={editMode}
            editUndoDepth={editUndoDepth}
            committing={committing}
            showingStructure={showingStructure}
            structureObject={structureObject}
            editorEngine={editorEngine}
            unfilteredRowCount={unfilteredRowCount}
            totalRows={totalRows}
            gridRef={gridRef}
            importFileRef={importFileRef}
            gridRowStyle={gridRowStyle}
            gridTotalWidth={gridTotalWidth}
            gridRowHeight={GRID_ROW_HEIGHT}
            gridColumnWidth={GRID_COLUMN_WIDTH}
            leftColumnPad={leftColumnPad}
            rightColumnPad={rightColumnPad}
            topPad={topPad}
            bottomPad={bottomPad}
            firstVisible={firstVisible}
            visibleColumnIndexes={visibleColumnIndexes}
            visibleRows={visibleRows}
            sortRuleByColumn={sortRuleByColumn}
            sortRules={sortRules}
            selectedRowKey={selectedRowKey}
            selectedCell={selectedCell}
            selectedRangeBounds={selectedRangeBounds}
            editingCell={editingCell}
            cellEdits={cellEdits}
            selectedRowValues={selectedRowValues}
            rowDetailTable={rowDetailTable}
            activeMetadata={activeMetadata}
            activeConnectionId={activeConnectionId}
            formatObjectName={(object) => qualifiedObjectName(editorEngine, object)}
            formatCount={toCount}
            canEditActiveResult={canEditActiveResult}
            onResultModeChange={setResultMode}
            onSelectResultSet={selectResultSet}
            onQuickFilterChange={updateQuickFilter}
            onClearQuickFilter={clearQuickFilter}
            onToggleFilters={() => setFiltersOpen((open) => !open)}
            onSetFilterJoin={setFilterJoin}
            onAddFilterRule={addFilterRule}
            onUpdateFilterRule={updateFilterRule}
            onRemoveFilterRule={removeFilterRule}
            onClearResultFilters={clearResultFilters}
            onExportActiveResult={exportActiveResult}
            onToggleExportMenu={() => setExportMenuOpen((open) => !open)}
            onCopyVisibleResult={() => void copyVisibleResult()}
            onImportFile={(file) => void handleImportFile(file)}
            onAddNewRow={addNewRow}
            onUndoEdit={undoLastEdit}
            onCommitEdits={() => void commitEdits()}
            onDiscardEdits={() => {
              resetEdits();
              setEditMode(false);
            }}
            onEnableEditMode={() => {
              setCommitError(null);
              setEditMode(true);
            }}
            onGridScroll={onGridScroll}
            onGridKeyDown={onGridKeyDown}
            onGridPaste={onGridPaste}
            onGridCopy={onGridCopy}
            onToggleSort={toggleSort}
            onSelectGridRow={selectGridRow}
            onSelectGridCell={selectGridCell}
            onBeginCellEdit={beginCellEdit}
            onSetCellValue={setCellValue}
            onDeleteRow={deleteRow}
            onPasteTableAt={pasteTableAt}
            onEndCellEdit={() => setEditingCell(null)}
            onCloseRowDetail={() => {
              setSelectedRowKey(null);
              setSelectedCell(null);
              setSelectedRange(null);
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
          onSelectProfile={selectProfile}
          onUpdateDraft={updateDraft}
          onDeleteProfile={() => void deleteProfile()}
          onDisconnect={() => void disconnectActiveProfile()}
          onSave={() => saveDraft()}
          onTest={() => void testActiveProfile()}
          onConnect={connectActiveProfile}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsDialog
          settingsTab={settingsTab}
          onOpenSection={openSettingsSection}
          onClose={() => setSettingsOpen(false)}
          locale={locale}
          setLocale={setLocale}
          vimMode={vimMode}
          setVimMode={setVimMode}
          autoCommit={autoCommit}
          setAutoCommit={setAutoCommit}
          themeKind={themeKind}
          setThemeKind={activateBuiltInTheme}
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
          recordingCommand={recordingCommand}
          recordingSequence={recordingSequence}
          runCommand={runCommand}
          beginRecording={beginRecording}
          resetKeybinding={resetKeybinding}
          jobs={jobs}
          jobsLoading={jobsLoading}
          jobsError={jobsError}
          refreshJobs={refreshJobs}
          cancelJob={cancelJob}
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
          runtimeLabel={tauriRuntimeError() ? "Browser preview" : "Tauri desktop"}
          activeConnectionLabel={`${activeConnection.name} \u00b7 ${
            activeConnectionOpen ? "connected" : "closed"
          }`}
          onClose={() => setAboutOpen(false)}
          onOpenSettings={() => {
            setAboutOpen(false);
            openSettingsSection("general");
          }}
          onCopyDiagnostics={() => void copyAppDiagnostics()}
        />
      ) : null}

      <GitDrawer />

      <QueryHistoryDialog
        activeConnectionId={activeConnectionId}
        activeConnectionOpen={activeConnectionOpen}
        running={running}
        connectionById={connectionById}
        onLoad={loadHistoryItem}
        onRun={(item) => void runHistoryItem(item)}
        onRestoreResult={restoreHistoryResult}
      />

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
          onCopyMermaid={() => {
            if (activeMetadata) {
              void navigator.clipboard?.writeText(diagramMermaid);
            }
          }}
        />
      ) : null}

      {actionNotice ? (
        <ActionToast
          notice={actionNotice}
          onDismiss={() => setActionNotice(null)}
        />
      ) : null}
    </>
  );
}

export default App;
