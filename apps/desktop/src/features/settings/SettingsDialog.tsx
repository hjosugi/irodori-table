import {
  AlertTriangle,
  Clock3,
  Code2,
  Keyboard,
  Palette,
  Settings,
  TerminalSquare,
} from "lucide-react";
import type { JobList, JobSummary } from "../../generated/irodori-api";
import type { CustomThemeEntry } from "../preferences";
import {
  commandHasConflict,
  formatKeySequence,
  type CommandMeta,
  type Keymap,
  type KeymapConflicts,
} from "../../keybindings";
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
import type { ThemeKind } from "../../theme";

export type SettingsTab =
  | "general"
  | "theme"
  | "keymap"
  | "snippets"
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
  themeKind: ThemeKind;
  setThemeKind: (value: ThemeKind) => void;
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
  cancelJob: (jobId: string) => Promise<void>;
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

function isCancellableJob(job: JobSummary) {
  return job.status === "queued" || job.status === "running";
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
  themeKind,
  setThemeKind,
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
  cancelJob,
  settingsJsonDraft,
  setSettingsJsonDraft,
  settingsJsonError,
  setSettingsJsonError,
  resetSettingsJsonDraft,
  applySettingsJson,
}: SettingsDialogProps) {
  const t = createTranslator(locale);

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
                        themeKind === "dark" && !activeCustomThemeId
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
                        themeKind === "light" && !activeCustomThemeId
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
                      : "Press keys...";
                  return (
                    <div className="command-item" key={command.id}>
                      <button
                        className="command-run"
                        type="button"
                        onClick={() => runCommand(command.id)}
                        title={`Run: ${command.title}`}
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
                            ? "Press one or two chords for the new shortcut"
                            : conflicted
                              ? "Shortcut conflict - click to rebind"
                              : "Click to rebind"
                        }
                        onClick={() => beginRecording(command.id)}
                      >
                        {recording
                          ? recordingLabel
                          : chord
                            ? formatKeySequence(chord)
                            : "unset"}
                      </button>
                      {keymapOverrides[command.id] ? (
                        <button
                          className="command-reset"
                          type="button"
                          title="Reset to default"
                          onClick={() => resetKeybinding(command.id)}
                        >
                          Reset
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
                    <strong>SQL Snippets</strong>
                    <small>
                      Completion triggers can use CodeMirror snippet
                      placeholders such as ${"{1:table}"} and ${"{0}"}.
                    </small>
                  </span>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setSqlSnippets(copyDefaultSqlSnippets())}
                  >
                    Reset defaults
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={addSnippet}
                  >
                    Add snippet
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
                            <span>Trigger</span>
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
                            <span>Scope</span>
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
                            <span>Rank</span>
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
                            <span>Detail</span>
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
                          <span>Template</span>
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
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-browser">No snippets configured</div>
                )}
              </div>
            ) : settingsTab === "jobs" ? (
              <div className="settings-jobs">
                <div className="settings-json-toolbar">
                  <span>
                    <strong>Background Jobs</strong>
                    <small>
                      Active and recent local work tracked by the shared job
                      runtime.
                    </small>
                  </span>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void refreshJobs()}
                    disabled={jobsLoading}
                  >
                    {jobsLoading ? "Refreshing" : "Refresh"}
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
                    <strong>Active</strong>
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
                            <small>Attempt {job.attempt}</small>
                            {isCancellableJob(job) ? (
                              <button
                                className="text-button"
                                type="button"
                                onClick={() => void cancelJob(job.id)}
                              >
                                Cancel
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-browser">No active jobs</div>
                  )}
                </section>
                <section className="jobs-section">
                  <div className="jobs-section-title">
                    <strong>History</strong>
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
                                ? `${job.artifactCount} artifacts`
                                : "No artifacts"}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-browser">No finished jobs</div>
                  )}
                </section>
              </div>
            ) : (
              <div className="settings-json">
                <div className="settings-json-toolbar">
                  <span>
                    <strong>Settings JSON</strong>
                    <small>
                      Edits apply to theme JSON, editor, layout, keymap, and
                      saved connections.
                    </small>
                  </span>
                  <button
                    className="text-button"
                    type="button"
                    onClick={resetSettingsJsonDraft}
                  >
                    Reset from current
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={applySettingsJson}
                  >
                    Apply JSON
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
