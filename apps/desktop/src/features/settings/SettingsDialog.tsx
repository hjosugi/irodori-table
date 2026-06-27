import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock3,
  Code2,
  Download,
  Image as ImageIcon,
  Keyboard,
  Palette,
  Package,
  Search,
  RotateCcw,
  Settings,
  TerminalSquare,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { JobList, JobSummary } from "../../generated/irodori-api";
import {
  EDITOR_BACKGROUND_OPACITY_MAX,
  EDITOR_BACKGROUND_OPACITY_MIN,
  EDITOR_BACKGROUND_OPACITY_STEP,
  UI_ZOOM_DEFAULT,
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
  UI_ZOOM_STEP,
  normalizeEditorBackgroundOpacity,
  normalizeUiZoom,
  type CustomThemeEntry,
  type ThemePreference,
} from "../preferences";
import {
  commandHasConflict,
  formatKeySequence,
  type CommandMeta,
  type Keymap,
  type KeymapConflicts,
} from "@/core/keybindings";
import {
  cloneDefaultSqlSnippets,
  isSqlSnippetScope,
  type SqlSnippetDefinition,
  type SqlSnippetScope,
} from "../../sql/completion";
import {
  formatterOptions,
  isSqlFormatterId,
  type SqlFormatterId,
} from "../../sql/formatter";
import {
  isSqlLinterId,
  linterOptions,
  type SqlLinterId,
} from "../../sql/linter";
import {
  createTranslator,
  localeLabels,
  supportedLocales,
  type Locale,
} from "../../i18n";
import { defaultThemeEntries, type ThemeKind } from "@/theme";
import {
  bundledPluginStoreIndex,
  defaultPluginStoreUrl,
  fetchPluginStoreIndex,
  type PluginStoreExtension,
  type PluginStoreIndex,
} from "@/features/extensions/plugin-store";

export type SettingsTab =
  | "general"
  | "theme"
  | "keymap"
  | "snippets"
  | "extensions"
  | "jobs"
  | "json";

type ValueUpdater<T> = T | ((current: T) => T);
type BooleanUpdater = ValueUpdater<boolean>;

export interface SettingsDialogProps {
  settingsTab: SettingsTab;
  onOpenSection: (tab: SettingsTab) => void;
  onClose: () => void;
  locale: Locale;
  setLocale: (value: Locale) => void;
  vimMode: boolean;
  setVimMode: (value: boolean) => void;
  autoCommit: boolean;
  setAutoCommit: (value: BooleanUpdater) => void;
  uiZoom: number;
  setUiZoom: (value: ValueUpdater<number>) => void;
  themePreference: ThemePreference;
  themeKind: ThemeKind;
  setThemePreference: (value: ThemePreference) => void;
  setThemeKind: (value: ThemeKind) => void;
  activeDefaultThemeId: string | null;
  activeDefaultThemeName: string | null;
  setActiveDefaultThemeId: (value: string | null) => void;
  customThemes: CustomThemeEntry[];
  activeCustomThemeId: string | null;
  activeCustomThemeName: string | null;
  setActiveCustomThemeId: (value: string | null) => void;
  clearCustomTheme: () => void;
  formatter: SqlFormatterId;
  setFormatter: (value: SqlFormatterId) => void;
  sqlLinter: SqlLinterId;
  setSqlLinter: (value: SqlLinterId) => void;
  sqlSnippets: SqlSnippetDefinition[];
  setSqlSnippets: (value: ValueUpdater<SqlSnippetDefinition[]>) => void;
  editorBackgroundImage: string;
  setEditorBackgroundImage: (value: string) => void;
  editorBackgroundOpacity: number;
  setEditorBackgroundOpacity: (value: number) => void;
  animationsEnabled: boolean;
  setAnimationsEnabled: (value: BooleanUpdater) => void;
  resultOffloadEnabled: boolean;
  setResultOffloadEnabled: (value: boolean) => void;
  resultMemoryBudget: number;
  setResultMemoryBudget: (value: number) => void;
  queryHistoryMaxItems: number;
  setQueryHistoryMaxItems: (value: number) => void;
  queryHistoryResultRows: number;
  setQueryHistoryResultRows: (value: number) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (value: BooleanUpdater) => void;
  commandCatalog: CommandMeta[];
  keymap: Keymap;
  keymapOverrides: Keymap;
  keymapConflicts: KeymapConflicts;
  recordingCommand: string | null;
  recordingSequence: string[];
  runCommand: (commandId: string) => void;
  beginRecording: (commandId: string) => void;
  resetKeybinding: (commandId: string) => void;
  jobs: JobList;
  jobsLoading: boolean;
  jobsError: string | null;
  refreshJobs: () => Promise<void>;
  settingsJsonDraft: string;
  setSettingsJsonDraft: (value: string) => void;
  settingsJsonError: string | null;
  setSettingsJsonError: (value: string | null) => void;
  resetSettingsJsonDraft: () => void;
  applySettingsJson: () => void;
}

function toCount(value: bigint | number) {
  return Number(value).toLocaleString();
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatJobKind(kind: JobSummary["kind"]) {
  switch (kind) {
    case "knowledgeRefresh":
      return "Knowledge refresh";
    case "indexBuild":
      return "Index build";
    case "mlEvaluation":
      return "ML evaluation";
    case "bulkEdit":
      return "Bulk edit";
    case "sourceScan":
      return "Source scan";
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

function formatJobTime(value?: bigint) {
  if (value === undefined) {
    return "-";
  }
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatJobProgress(job: JobSummary) {
  const progress = job.progress;
  if (progress.total !== undefined) {
    return `${toCount(progress.completed)} / ${toCount(progress.total)} ${progress.unit}`;
  }
  if (progress.completed > 0n) {
    return `${toCount(progress.completed)} ${progress.unit}`;
  }
  return progress.message ?? "Waiting";
}

function openExternalUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

const snippetScopeOptions: SqlSnippetScope[] = [
  "statement",
  "clause",
  "expression",
];

function copyDefaultSqlSnippets() {
  return cloneDefaultSqlSnippets();
}

function uniqueSnippetLabel(snippets: readonly SqlSnippetDefinition[]) {
  const used = new Set(snippets.map((snippet) => snippet.label));
  if (!used.has("custom")) return "custom";
  let index = 2;
  while (used.has(`custom${index}`)) index += 1;
  return `custom${index}`;
}

function ExtensionSection({
  title,
  count,
  empty,
  extensions,
}: {
  title: string;
  count: number;
  empty: string;
  extensions: readonly PluginStoreExtension[];
}) {
  return (
    <section className="extension-section">
      <div className="extension-section-header">
        <span>{title}</span>
        <small>{count}</small>
      </div>
      {extensions.length === 0 ? (
        <div className="extension-empty">{empty}</div>
      ) : (
        <div className="extension-list">
          {extensions.map((extension) => (
            <article className="extension-item" key={extension.id}>
              <div className="extension-icon" aria-hidden="true">
                {extension.name.slice(0, 1)}
              </div>
              <div className="extension-main">
                <div className="extension-title-row">
                  <strong>{extension.name}</strong>
                  <span>{extension.version}</span>
                </div>
                <p>{extension.summary}</p>
                <div className="extension-meta">
                  <span>{extension.publisher}</span>
                  <span>{extension.runtime}</span>
                  <span>{extension.engines.join(", ")}</span>
                </div>
              </div>
              <div className="extension-actions">
                <button
                  type="button"
                  className="icon-button"
                  title="Open release"
                  aria-label={`Open ${extension.name} release`}
                  onClick={() => openExternalUrl(extension.install.url)}
                >
                  <Download size={15} />
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => openExternalUrl(extension.repository)}
                >
                  GitHub
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function SettingsDialog({
  settingsTab,
  onOpenSection,
  onClose,
  locale,
  setLocale,
  vimMode,
  setVimMode,
  autoCommit,
  setAutoCommit,
  uiZoom,
  setUiZoom,
  themePreference,
  themeKind,
  setThemePreference,
  setThemeKind,
  activeDefaultThemeId,
  activeDefaultThemeName,
  setActiveDefaultThemeId,
  customThemes,
  activeCustomThemeId,
  activeCustomThemeName,
  setActiveCustomThemeId,
  clearCustomTheme,
  formatter,
  setFormatter,
  sqlLinter,
  setSqlLinter,
  sqlSnippets,
  setSqlSnippets,
  editorBackgroundImage,
  setEditorBackgroundImage,
  editorBackgroundOpacity,
  setEditorBackgroundOpacity,
  animationsEnabled,
  setAnimationsEnabled,
  resultOffloadEnabled,
  setResultOffloadEnabled,
  resultMemoryBudget,
  setResultMemoryBudget,
  queryHistoryMaxItems,
  setQueryHistoryMaxItems,
  queryHistoryResultRows,
  setQueryHistoryResultRows,
  sidebarOpen,
  setSidebarOpen,
  commandCatalog,
  keymap,
  keymapOverrides,
  keymapConflicts,
  recordingCommand,
  recordingSequence,
  runCommand,
  beginRecording,
  resetKeybinding,
  jobs,
  jobsLoading,
  jobsError,
  refreshJobs,
  settingsJsonDraft,
  setSettingsJsonDraft,
  settingsJsonError,
  setSettingsJsonError,
  resetSettingsJsonDraft,
  applySettingsJson,
}: SettingsDialogProps) {
  const { t } = createTranslator(locale);
  const uiZoomPercent = `${Math.round(uiZoom * 100)}%`;
  const [pluginStore, setPluginStore] = useState<PluginStoreIndex>(
    bundledPluginStoreIndex,
  );
  const [pluginStoreLoading, setPluginStoreLoading] = useState(false);
  const [pluginStoreError, setPluginStoreError] = useState<string | null>(null);
  const [pluginSearch, setPluginSearch] = useState("");
  const filteredPluginStoreExtensions = useMemo(() => {
    const term = pluginSearch.trim().toLowerCase();
    if (!term) {
      return pluginStore.extensions;
    }
    return pluginStore.extensions.filter((extension) =>
      [
        extension.name,
        extension.id,
        extension.publisher,
        extension.summary,
        extension.engines.join(" "),
        extension.categories.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [pluginSearch, pluginStore.extensions]);
  const recommendedPluginStoreExtensions = useMemo(
    () =>
      pluginStore.extensions.filter((extension) =>
        ["duckdb", "snowflake", "bigquery", "cloudSpanner", "kvStore"].some(
          (engine) => extension.engines.includes(engine),
        ),
      ),
    [pluginStore.extensions],
  );

  useEffect(() => {
    if (settingsTab !== "extensions") {
      return;
    }
    let cancelled = false;
    setPluginStoreLoading(true);
    setPluginStoreError(null);
    fetchPluginStoreIndex(defaultPluginStoreUrl)
      .then((index) => {
        if (!cancelled) {
          setPluginStore(index);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPluginStore(bundledPluginStoreIndex);
          setPluginStoreError(
            error instanceof Error ? error.message : String(error),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPluginStoreLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settingsTab]);

  function updateSnippet(
    index: number,
    patch: Partial<SqlSnippetDefinition>,
  ) {
    setSqlSnippets((current) =>
      current.map((snippet, snippetIndex) =>
        snippetIndex === index ? { ...snippet, ...patch } : snippet,
      ),
    );
  }

  function addSnippet() {
    setSqlSnippets((current) => [
      ...current,
      {
        label: uniqueSnippetLabel(current),
        detail: "custom snippet",
        template: "${1:statement}${0}",
        scope: "statement",
        rank: 500,
      },
    ]);
  }

  function removeSnippet(index: number) {
    setSqlSnippets((current) =>
      current.filter((_, snippetIndex) => snippetIndex !== index),
    );
  }

  function chooseEditorBackgroundImage(file: File | undefined) {
    if (!file || !file.type.startsWith("image/")) {
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        setEditorBackgroundImage(reader.result);
      }
    });
    reader.readAsDataURL(file);
  }

  return (
    <div className="palette-overlay" onClick={onClose} role="presentation">
      <div
        className="data-dialog settings-dialog"
        role="dialog"
        aria-label={t("settings.title")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <strong>{t("settings.title")}</strong>
          <span>{t("settings.subtitle")}</span>
          <button className="text-button" type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav" aria-label={t("settings.sections")}>
            <button
              type="button"
              className={settingsTab === "general" ? "active" : undefined}
              onClick={() => onOpenSection("general")}
            >
              <Settings size={15} />
              {t("settings.nav.general")}
            </button>
            <button
              type="button"
              className={settingsTab === "theme" ? "active" : undefined}
              onClick={() => onOpenSection("theme")}
            >
              <Palette size={15} />
              {t("settings.nav.theme")}
            </button>
            <button
              type="button"
              className={settingsTab === "keymap" ? "active" : undefined}
              onClick={() => onOpenSection("keymap")}
            >
              <Keyboard size={15} />
              {t("settings.nav.keymap")}
            </button>
            <button
              type="button"
              className={settingsTab === "snippets" ? "active" : undefined}
              onClick={() => onOpenSection("snippets")}
            >
              <Code2 size={15} />
              {t("settings.nav.snippets")}
            </button>
            <button
              type="button"
              className={settingsTab === "extensions" ? "active" : undefined}
              onClick={() => onOpenSection("extensions")}
            >
              <Package size={15} />
              {t("settings.nav.extensions")}
            </button>
            <button
              type="button"
              className={settingsTab === "jobs" ? "active" : undefined}
              onClick={() => onOpenSection("jobs")}
            >
              <Clock3 size={15} />
              {t("settings.nav.jobs")}
            </button>
            <button
              type="button"
              className={settingsTab === "json" ? "active" : undefined}
              onClick={() => onOpenSection("json")}
            >
              <TerminalSquare size={15} />
              {t("settings.nav.json")}
            </button>
          </nav>
          <section className="settings-panel">
            {settingsTab === "general" ? (
              <div className="settings-stack">
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.general.language.title")}</strong>
                    <small>{t("settings.general.language.description")}</small>
                  </span>
                  <select
                    value={locale}
                    onChange={(event) =>
                      setLocale(event.currentTarget.value as Locale)
                    }
                  >
                    {supportedLocales.map((supportedLocale) => (
                      <option key={supportedLocale} value={supportedLocale}>
                        {localeLabels[supportedLocale]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.general.uiZoom.title")}</strong>
                    <small>{t("settings.general.uiZoom.description")}</small>
                  </span>
                  <div className="ui-zoom-control">
                    <button
                      className="icon-button"
                      type="button"
                      title={t("settings.general.uiZoom.zoomOut")}
                      aria-label={t("settings.general.uiZoom.zoomOut")}
                      disabled={uiZoom <= UI_ZOOM_MIN}
                      onClick={() => setUiZoom(uiZoom - UI_ZOOM_STEP)}
                    >
                      <ZoomOut size={14} />
                    </button>
                    <input
                      type="range"
                      min={UI_ZOOM_MIN}
                      max={UI_ZOOM_MAX}
                      step={UI_ZOOM_STEP}
                      value={uiZoom}
                      aria-label={t("settings.general.uiZoom.title")}
                      onChange={(event) =>
                        setUiZoom(normalizeUiZoom(event.currentTarget.value))
                      }
                    />
                    <output>{uiZoomPercent}</output>
                    <button
                      className="icon-button"
                      type="button"
                      title={t("settings.general.uiZoom.zoomIn")}
                      aria-label={t("settings.general.uiZoom.zoomIn")}
                      disabled={uiZoom >= UI_ZOOM_MAX}
                      onClick={() => setUiZoom(uiZoom + UI_ZOOM_STEP)}
                    >
                      <ZoomIn size={14} />
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      title={t("settings.general.uiZoom.reset")}
                      onClick={() => setUiZoom(UI_ZOOM_DEFAULT)}
                    >
                      <RotateCcw size={14} />
                      <span>{t("common.reset")}</span>
                    </button>
                  </div>
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.general.editorMode.title")}</strong>
                    <small>
                      {t("settings.general.editorMode.description")}
                    </small>
                  </span>
                  <div className="segmented-control">
                    <button
                      type="button"
                      className={!vimMode ? "active" : undefined}
                      onClick={() => setVimMode(false)}
                    >
                      {t("settings.general.editorMode.default")}
                    </button>
                    <button
                      type="button"
                      className={vimMode ? "active" : undefined}
                      onClick={() => setVimMode(true)}
                    >
                      {t("settings.general.editorMode.vim")}
                    </button>
                  </div>
                </label>
                <label className="settings-row settings-row-wide">
                  <span>
                    <strong>
                      {t("settings.general.editorBackground.title")}
                    </strong>
                    <small>
                      {t("settings.general.editorBackground.description")}
                    </small>
                  </span>
                  <div className="editor-background-control">
                    <div className="editor-background-input">
                      <ImageIcon size={14} />
                      <input
                        type="text"
                        value={editorBackgroundImage}
                        placeholder={t(
                          "settings.general.editorBackground.placeholder",
                        )}
                        onChange={(event) =>
                          setEditorBackgroundImage(event.currentTarget.value)
                        }
                      />
                    </div>
                    <label className="text-button editor-background-file">
                      <Upload size={14} />
                      <span>
                        {t("settings.general.editorBackground.choose")}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          chooseEditorBackgroundImage(
                            event.currentTarget.files?.[0],
                          );
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button
                      className="text-button"
                      type="button"
                      disabled={!editorBackgroundImage}
                      onClick={() => setEditorBackgroundImage("")}
                    >
                      <RotateCcw size={14} />
                      <span>{t("common.reset")}</span>
                    </button>
                    <input
                      type="range"
                      min={EDITOR_BACKGROUND_OPACITY_MIN}
                      max={EDITOR_BACKGROUND_OPACITY_MAX}
                      step={EDITOR_BACKGROUND_OPACITY_STEP}
                      value={editorBackgroundOpacity}
                      aria-label={t(
                        "settings.general.editorBackground.opacity",
                      )}
                      onChange={(event) =>
                        setEditorBackgroundOpacity(
                          normalizeEditorBackgroundOpacity(
                            event.currentTarget.value,
                          ),
                        )
                      }
                    />
                    <output>
                      {Math.round(editorBackgroundOpacity * 100)}%
                    </output>
                  </div>
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.general.animations.title")}</strong>
                    <small>
                      {t("settings.general.animations.description")}
                    </small>
                  </span>
                  <div className="segmented-control">
                    <button
                      type="button"
                      className={animationsEnabled ? "active" : undefined}
                      onClick={() => setAnimationsEnabled(true)}
                    >
                      {t("common.on")}
                    </button>
                    <button
                      type="button"
                      className={!animationsEnabled ? "active" : undefined}
                      onClick={() => setAnimationsEnabled(false)}
                    >
                      {t("common.off")}
                    </button>
                  </div>
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.general.autoCommit.title")}</strong>
                    <small>{t("settings.general.autoCommit.description")}</small>
                  </span>
                  <div className="segmented-control">
                    <button
                      type="button"
                      className={autoCommit ? "active" : undefined}
                      onClick={() => setAutoCommit(true)}
                    >
                      {t("common.on")}
                    </button>
                    <button
                      type="button"
                      className={!autoCommit ? "active" : undefined}
                      onClick={() => setAutoCommit(false)}
                    >
                      {t("common.off")}
                    </button>
                  </div>
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.general.formatter.title")}</strong>
                    <small>{t("settings.general.formatter.description")}</small>
                  </span>
                  <select
                    value={formatter}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (isSqlFormatterId(next)) {
                        setFormatter(next);
                      }
                    }}
                  >
                    {formatterOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.general.linter.title")}</strong>
                    <small>{t("settings.general.linter.description")}</small>
                  </span>
                  <select
                    value={sqlLinter}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (isSqlLinterId(next)) {
                        setSqlLinter(next);
                      }
                    }}
                  >
                    {linterOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.general.resultOffload.title")}</strong>
                    <small>
                      {t("settings.general.resultOffload.description")}
                    </small>
                  </span>
                  <div className="segmented-control">
                    <button
                      type="button"
                      className={resultOffloadEnabled ? "active" : undefined}
                      onClick={() => setResultOffloadEnabled(true)}
                    >
                      {t("common.on")}
                    </button>
                    <button
                      type="button"
                      className={!resultOffloadEnabled ? "active" : undefined}
                      onClick={() => setResultOffloadEnabled(false)}
                    >
                      {t("common.off")}
                    </button>
                  </div>
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.general.residentRows.title")}</strong>
                    <small>
                      {t("settings.general.residentRows.description")}
                    </small>
                  </span>
                  <input
                    type="number"
                    min={1_000}
                    max={100_000}
                    step={1_000}
                    value={resultMemoryBudget}
                    onChange={(event) =>
                      setResultMemoryBudget(
                        clampNumber(
                          Number(event.currentTarget.value),
                          1_000,
                          100_000,
                        ),
                      )
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.general.queryHistory.title")}</strong>
                    <small>
                      {t("settings.general.queryHistory.description")}
                    </small>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    step={25}
                    value={queryHistoryMaxItems}
                    onChange={(event) =>
                      setQueryHistoryMaxItems(
                        clampNumber(Number(event.currentTarget.value), 0, 500),
                      )
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.general.historyRows.title")}</strong>
                    <small>
                      {t("settings.general.historyRows.description")}
                    </small>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    step={10}
                    value={queryHistoryResultRows}
                    onChange={(event) =>
                      setQueryHistoryResultRows(
                        clampNumber(Number(event.currentTarget.value), 0, 500),
                      )
                    }
                  />
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.general.sidebar.title")}</strong>
                    <small>{t("settings.general.sidebar.description")}</small>
                  </span>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setSidebarOpen((open) => !open)}
                  >
                    {sidebarOpen ? t("common.hide") : t("common.show")}
                  </button>
                </label>
              </div>
            ) : settingsTab === "theme" ? (
              <div className="settings-stack">
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.theme.colorMode.title")}</strong>
                    <small>
                      {activeCustomThemeName
                        ? t("settings.theme.colorMode.customDescription", {
                            name: activeCustomThemeName,
                          })
                        : t("settings.theme.colorMode.builtinDescription")}
                    </small>
                  </span>
                  <div className="segmented-control">
                    <button
                      type="button"
                      className={
                        themePreference === "system" && !activeCustomThemeId
                          ? "active"
                          : undefined
                      }
                      onClick={() => setThemePreference("system")}
                    >
                      {t("common.system")}
                    </button>
                    <button
                      type="button"
                      className={
                        themePreference === "dark" && !activeCustomThemeId
                          ? "active"
                          : undefined
                      }
                      onClick={() => setThemeKind("dark")}
                    >
                      {t("common.dark")}
                    </button>
                    <button
                      type="button"
                      className={
                        themePreference === "light" && !activeCustomThemeId
                          ? "active"
                          : undefined
                      }
                      onClick={() => setThemeKind("light")}
                    >
                      {t("common.light")}
                    </button>
                  </div>
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.theme.defaultThemes.title")}</strong>
                    <small>
                      {t("settings.theme.defaultThemes.description")}
                    </small>
                  </span>
                  <select
                    value={activeDefaultThemeId ?? ""}
                    onChange={(event) =>
                      setActiveDefaultThemeId(
                        event.currentTarget.value || null,
                      )
                    }
                  >
                    {defaultThemeEntries.map((theme) => (
                      <option key={theme.id} value={theme.id}>
                        {theme.name} ({theme.kind})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-row">
                  <span>
                    <strong>{t("settings.theme.savedThemes.title")}</strong>
                    <small>
                      {t("settings.theme.savedThemes.description")}
                    </small>
                  </span>
                  <select
                    value={activeCustomThemeId ?? ""}
                    onChange={(event) =>
                      setActiveCustomThemeId(event.currentTarget.value || null)
                    }
                  >
                    <option value="">
                      {t("settings.theme.savedThemes.builtin")}
                    </option>
                    {customThemes.map((theme) => (
                      <option key={theme.id} value={theme.id}>
                        {theme.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="settings-row settings-row-alert">
                  <span>
                    <strong>{t("settings.theme.activeTheme.title")}</strong>
                    <small>
                      {activeCustomThemeName
                        ? t("settings.theme.activeTheme.customDescription", {
                            name: activeCustomThemeName,
                          })
                        : activeDefaultThemeName
                          ? t("settings.theme.activeTheme.builtinNameDescription", {
                              name: activeDefaultThemeName,
                            })
                        : t("settings.theme.activeTheme.builtinDescription", {
                            kind: themeKind,
                          })}
                    </small>
                  </span>
                  {activeCustomThemeName ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={clearCustomTheme}
                    >
                      {t("settings.theme.activeTheme.useBuiltin")}
                    </button>
                  ) : null}
                </div>
                <div className="settings-row">
                  <span>
                    <strong>{t("settings.theme.importThemes.title")}</strong>
                    <small>
                      {t("settings.theme.importThemes.description")}
                    </small>
                  </span>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => onOpenSection("json")}
                  >
                    {t("settings.theme.importThemes.openJson")}
                  </button>
                </div>
              </div>
            ) : settingsTab === "keymap" ? (
              <div className="command-list settings-command-list">
                {commandCatalog.map((command) => {
                  const chord = keymap[command.id];
                  const conflicted = commandHasConflict(
                    keymapConflicts,
                    command.id,
                  );
                  const recording = recordingCommand === command.id;
                  const recordingLabel =
                    recordingSequence.length > 0
                      ? `${formatKeySequence(recordingSequence.join(" "))} ...`
                      : t("settings.keymap.recordingLabel");
                  return (
                    <div className="command-item" key={command.id}>
                      <button
                        className="command-run"
                        type="button"
                        onClick={() => runCommand(command.id)}
                        title={t("settings.keymap.runTitle", {
                          title: command.title,
                        })}
                      >
                        {command.title}
                      </button>
                      <small className={`command-scope ${command.scope}`}>
                        {command.scope}
                      </small>
                      <button
                        className={`command-chord${conflicted ? " conflict" : ""}`}
                        type="button"
                        title={
                          recording
                            ? t("settings.keymap.recordingTitle")
                            : conflicted
                              ? t("settings.keymap.conflictTitle")
                              : t("settings.keymap.rebindTitle")
                        }
                        onClick={() => beginRecording(command.id)}
                      >
                        {recording
                          ? recordingLabel
                          : chord
                            ? formatKeySequence(chord)
                            : t("settings.keymap.unset")}
                      </button>
                      {keymapOverrides[command.id] ? (
                        <button
                          className="command-reset"
                          type="button"
                          title={t("settings.keymap.resetTitle")}
                          onClick={() => resetKeybinding(command.id)}
                        >
                          {t("common.reset")}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : settingsTab === "snippets" ? (
              <div className="settings-snippets">
                <div className="settings-json-toolbar">
                  <span>
                    <strong>{t("settings.snippets.title")}</strong>
                    <small>
                      {t("settings.snippets.description", {
                        first: "${1:table}",
                        final: "${0}",
                      })}
                    </small>
                  </span>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setSqlSnippets(copyDefaultSqlSnippets())}
                  >
                    {t("settings.snippets.resetDefaults")}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={addSnippet}
                  >
                    {t("settings.snippets.add")}
                  </button>
                </div>
                {sqlSnippets.length > 0 ? (
                  <div className="snippet-editor-list">
                    {sqlSnippets.map((snippet, index) => (
                      <div
                        className="snippet-editor-item"
                        key={`${snippet.label}-${index}`}
                      >
                        <div className="snippet-editor-grid">
                          <label>
                            <span>{t("settings.snippets.trigger")}</span>
                            <input
                              value={snippet.label}
                              spellCheck={false}
                              onChange={(event) =>
                                updateSnippet(index, {
                                  label: event.currentTarget.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            <span>{t("settings.snippets.scope")}</span>
                            <select
                              value={snippet.scope}
                              onChange={(event) => {
                                const next = event.currentTarget.value;
                                if (isSqlSnippetScope(next)) {
                                  updateSnippet(index, { scope: next });
                                }
                              }}
                            >
                              {snippetScopeOptions.map((scope) => (
                                <option key={scope} value={scope}>
                                  {scope}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>{t("settings.snippets.rank")}</span>
                            <input
                              type="number"
                              min={0}
                              max={999}
                              step={5}
                              value={snippet.rank ?? 500}
                              onChange={(event) =>
                                updateSnippet(index, {
                                  rank: clampNumber(
                                    Number(event.currentTarget.value),
                                    0,
                                    999,
                                  ),
                                })
                              }
                            />
                          </label>
                          <label className="snippet-detail-field">
                            <span>{t("settings.snippets.detail")}</span>
                            <input
                              value={snippet.detail}
                              onChange={(event) =>
                                updateSnippet(index, {
                                  detail: event.currentTarget.value,
                                })
                              }
                            />
                          </label>
                        </div>
                        <label className="snippet-template-field">
                          <span>{t("settings.snippets.template")}</span>
                          <textarea
                            value={snippet.template}
                            spellCheck={false}
                            onChange={(event) =>
                              updateSnippet(index, {
                                template: event.currentTarget.value,
                              })
                            }
                          />
                        </label>
                        <div className="snippet-editor-actions">
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => removeSnippet(index)}
                          >
                            {t("settings.snippets.remove")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-browser">
                    {t("settings.snippets.empty")}
                  </div>
                )}
              </div>
            ) : settingsTab === "extensions" ? (
              <div className="settings-extensions">
                <div className="extension-search">
                  <Search size={15} />
                  <input
                    type="search"
                    value={pluginSearch}
                    placeholder={t("settings.extensions.search")}
                    onChange={(event) => setPluginSearch(event.currentTarget.value)}
                  />
                </div>
                <div className="extension-store-note">
                  <span>
                    {pluginStoreLoading
                      ? t("settings.extensions.loading")
                      : t("settings.extensions.source", {
                          source: pluginStore.source,
                        })}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => openExternalUrl(defaultPluginStoreUrl)}
                  >
                    {t("settings.extensions.openStore")}
                  </button>
                </div>
                {pluginStoreError ? (
                  <div className="inline-error settings-json-error">
                    <AlertTriangle size={15} />
                    <span>{pluginStoreError}</span>
                  </div>
                ) : null}
                <ExtensionSection
                  title={t("settings.extensions.installed")}
                  count={0}
                  empty={t("settings.extensions.noInstalled")}
                  extensions={[]}
                />
                <ExtensionSection
                  title={t("settings.extensions.marketplace")}
                  count={filteredPluginStoreExtensions.length}
                  empty={t("settings.extensions.noMatches")}
                  extensions={filteredPluginStoreExtensions}
                />
                <ExtensionSection
                  title={t("settings.extensions.recommended")}
                  count={recommendedPluginStoreExtensions.length}
                  empty={t("settings.extensions.noRecommended")}
                  extensions={recommendedPluginStoreExtensions}
                />
              </div>
            ) : settingsTab === "jobs" ? (
              <div className="settings-jobs">
                <div className="settings-json-toolbar">
                  <span>
                    <strong>{t("settings.jobs.title")}</strong>
                    <small>
                      {t("settings.jobs.description")}
                    </small>
                  </span>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void refreshJobs()}
                    disabled={jobsLoading}
                  >
                    {jobsLoading ? t("common.refreshing") : t("common.refresh")}
                  </button>
                </div>
                {jobsError ? (
                  <div className="inline-error settings-json-error">
                    <AlertTriangle size={13} />
                    <span>{jobsError}</span>
                  </div>
                ) : null}
                <section className="jobs-section">
                  <div className="jobs-section-title">
                    <strong>{t("settings.jobs.active")}</strong>
                    <span>{jobs.active.length}</span>
                  </div>
                  {jobs.active.length > 0 ? (
                    <div className="jobs-list">
                      {jobs.active.map((job) => (
                        <div className="job-row" key={job.id}>
                          <div className="job-main">
                            <strong>{job.title}</strong>
                            <small>
                              {formatJobKind(job.kind)} · {job.status} ·{" "}
                              {formatJobProgress(job)}
                            </small>
                            {job.progress.percent !== undefined ? (
                              <div className="job-progress">
                                <span
                                  style={{ width: `${job.progress.percent}%` }}
                                />
                              </div>
                            ) : null}
                          </div>
                          <div className="job-meta">
                            <small>
                              {t("settings.jobs.attempt", {
                                attempt: job.attempt,
                              })}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-browser">
                      {t("settings.jobs.noActive")}
                    </div>
                  )}
                </section>
                <section className="jobs-section">
                  <div className="jobs-section-title">
                    <strong>{t("settings.jobs.history")}</strong>
                    <span>{jobs.history.length}</span>
                  </div>
                  {jobs.history.length > 0 ? (
                    <div className="jobs-list">
                      {jobs.history.map((job) => (
                        <div className={`job-row ${job.status}`} key={job.id}>
                          <div className="job-main">
                            <strong>{job.title}</strong>
                            <small>
                              {formatJobKind(job.kind)} · {job.status} ·{" "}
                              {formatJobTime(job.finishedAtMs ?? job.updatedAtMs)}
                            </small>
                            {job.error ? (
                              <small className="job-error">
                                {job.error.message}
                              </small>
                            ) : job.latestLogMessage ? (
                              <small>{job.latestLogMessage}</small>
                            ) : null}
                          </div>
                          <div className="job-meta">
                            <small>
                              {job.artifactCount
                                ? t("settings.jobs.artifacts", {
                                    count: job.artifactCount,
                                  })
                                : t("settings.jobs.noArtifacts")}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-browser">
                      {t("settings.jobs.noFinished")}
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <div className="settings-json">
                <div className="settings-json-toolbar">
                  <span>
                    <strong>{t("settings.json.title")}</strong>
                    <small>{t("settings.json.description")}</small>
                  </span>
                  <button
                    className="text-button"
                    type="button"
                    onClick={resetSettingsJsonDraft}
                  >
                    {t("settings.json.resetFromCurrent")}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={applySettingsJson}
                  >
                    {t("settings.json.apply")}
                  </button>
                </div>
                <textarea
                  value={settingsJsonDraft}
                  spellCheck={false}
                  onChange={(event) => {
                    setSettingsJsonDraft(event.currentTarget.value);
                    setSettingsJsonError(null);
                  }}
                />
                {settingsJsonError ? (
                  <div className="inline-error settings-json-error">
                    <AlertTriangle size={13} />
                    <span>{settingsJsonError}</span>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
