import {
  Clock3,
  Code2,
  Keyboard,
  Palette,
  Package,
  Settings,
  TerminalSquare,
} from "lucide-react";
import type { JobList } from "../../generated/irodori-api";
import type {
  CustomThemeEntry,
  ThemePreference,
} from "../preferences";
import type {
  CommandMeta,
  Keymap,
  KeymapConflicts,
  VimKeybindingConflict,
  VimKeybindingConflictResolutions,
} from "@/core/keybindings";
import type { SqlSnippetDefinition } from "../../sql/completion";
import type { SqlFormatterId } from "../../sql/formatter";
import type { SqlLinterId } from "../../sql/linter";
import { createTranslator, type Locale } from "../../i18n";
import type { ThemeKind } from "@/theme";
import type { BooleanUpdater, ValueUpdater } from "./tabs/shared";
import { GeneralTab } from "./tabs/GeneralTab";
import { ThemeTab } from "./tabs/ThemeTab";
import { KeymapTab } from "./tabs/KeymapTab";
import { SnippetsTab } from "./tabs/SnippetsTab";
import { ExtensionsTab } from "./tabs/ExtensionsTab";
import { JobsTab } from "./tabs/JobsTab";
import { JsonTab } from "./tabs/JsonTab";

export type SettingsTab =
  | "general"
  | "theme"
  | "keymap"
  | "snippets"
  | "extensions"
  | "jobs"
  | "json";

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
  vimKeymapConflicts: VimKeybindingConflict[];
  recordingCommand: string | null;
  recordingSequence: string[];
  runCommand: (commandId: string) => void;
  beginRecording: (commandId: string) => void;
  resetKeybinding: (commandId: string) => void;
  applyVimKeybindingResolutions: (
    resolutions: VimKeybindingConflictResolutions,
  ) => void;
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
  vimKeymapConflicts,
  recordingCommand,
  recordingSequence,
  runCommand,
  beginRecording,
  resetKeybinding,
  applyVimKeybindingResolutions,
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
              <GeneralTab
                t={t}
                locale={locale}
                setLocale={setLocale}
                uiZoom={uiZoom}
                setUiZoom={setUiZoom}
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
                formatter={formatter}
                setFormatter={setFormatter}
                sqlLinter={sqlLinter}
                setSqlLinter={setSqlLinter}
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
              />
            ) : settingsTab === "theme" ? (
              <ThemeTab
                t={t}
                onOpenSection={onOpenSection}
                themePreference={themePreference}
                themeKind={themeKind}
                setThemePreference={setThemePreference}
                setThemeKind={setThemeKind}
                activeDefaultThemeId={activeDefaultThemeId}
                activeDefaultThemeName={activeDefaultThemeName}
                setActiveDefaultThemeId={setActiveDefaultThemeId}
                customThemes={customThemes}
                activeCustomThemeId={activeCustomThemeId}
                activeCustomThemeName={activeCustomThemeName}
                setActiveCustomThemeId={setActiveCustomThemeId}
                clearCustomTheme={clearCustomTheme}
              />
            ) : settingsTab === "keymap" ? (
              <KeymapTab
                t={t}
                commandCatalog={commandCatalog}
                keymap={keymap}
                keymapOverrides={keymapOverrides}
                keymapConflicts={keymapConflicts}
                vimMode={vimMode}
                vimKeymapConflicts={vimKeymapConflicts}
                recordingCommand={recordingCommand}
                recordingSequence={recordingSequence}
                runCommand={runCommand}
                beginRecording={beginRecording}
                resetKeybinding={resetKeybinding}
                applyVimKeybindingResolutions={
                  applyVimKeybindingResolutions
                }
              />
            ) : settingsTab === "snippets" ? (
              <SnippetsTab
                t={t}
                sqlSnippets={sqlSnippets}
                setSqlSnippets={setSqlSnippets}
              />
            ) : settingsTab === "extensions" ? (
              <ExtensionsTab t={t} active={settingsTab === "extensions"} />
            ) : settingsTab === "jobs" ? (
              <JobsTab
                t={t}
                jobs={jobs}
                jobsLoading={jobsLoading}
                jobsError={jobsError}
                refreshJobs={refreshJobs}
              />
            ) : (
              <JsonTab
                t={t}
                settingsJsonDraft={settingsJsonDraft}
                setSettingsJsonDraft={setSettingsJsonDraft}
                settingsJsonError={settingsJsonError}
                setSettingsJsonError={setSettingsJsonError}
                resetSettingsJsonDraft={resetSettingsJsonDraft}
                applySettingsJson={applySettingsJson}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
