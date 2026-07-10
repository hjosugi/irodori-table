import { useEffect, useState } from "react";
import type { ShowActionNotice } from "@/app/ActionToast";
import { clampNumber, emptyJobList, isRecord } from "@/app/app-workbench-utils";
import type { KeybindingManager } from "@/app/controllers/use-keybinding-manager";
import type { ThemeManager } from "@/app/controllers/use-theme-manager";
import {
  CURRENT_SETTINGS_SCHEMA_VERSION,
  migrateSettingsJson,
} from "@/app/settings-schema";
import { errorMessage, type Keymap } from "@/core";
import {
  portableProfile,
  settingsProfileFromJson,
  useConnectionStore,
  withStarterProfiles,
  withUniqueProfileIds,
} from "@/features/connections";
import {
  normalizeEditorBackgroundOpacity,
  normalizeUiZoom,
  usePreferencesStore,
} from "@/features/preferences";
import { normalizePasskeyCredentialRecord } from "@/features/security";
import {
  queryHistoryMaxItemsHardLimit,
  queryHistoryResultRowsHardLimit,
  useQueryHistoryStore,
} from "@/features/query-history/query-history-store";
import { useResultsStore } from "@/features/results";
import type { SettingsTab } from "@/features/settings";
import {
  INSPECTOR_WIDTH_MAX,
  INSPECTOR_WIDTH_MIN,
  RESULTS_HEIGHT_MAX,
  RESULTS_HEIGHT_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useWorkbenchStore,
  workbenchRuntimeService,
  workbenchViewIds,
  type WorkbenchViewPlacements,
  type WorkbenchViewVisibility,
} from "@/features/workbench";
import { normalizeLocale, type Translator } from "@/i18n";
import { sqlSnippetsFromJson } from "@/sql/completion";
import { isSqlFormatterId } from "@/sql/formatter";
import { isSqlLinterId } from "@/sql/linter";
import {
  customThemeEntryFromJson,
  defaultThemeById,
  importThemeJson,
  upsertCustomThemeEntry,
} from "@/theme";
import type { JobList } from "@/generated/irodori-api";

type SettingsControllerDeps = {
  themes: ThemeManager;
  keybindings: Pick<
    KeybindingManager,
    "keymapOverrides" | "replaceKeymapOverrides"
  >;
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

export function useSettingsController({
  themes,
  keybindings,
  showActionNotice,
  t,
}: SettingsControllerDeps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [settingsJsonDraft, setSettingsJsonDraft] = useState("");
  const [settingsJsonError, setSettingsJsonError] = useState<string | null>(
    null,
  );
  const [jobs, setJobs] = useState<JobList>(emptyJobList);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const locale = usePreferencesStore((state) => state.locale);
  const setLocale = usePreferencesStore((state) => state.setLocale);
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
  const updateCheckOnStartup = usePreferencesStore(
    (state) => state.updateCheckOnStartup,
  );
  const setUpdateCheckOnStartup = usePreferencesStore(
    (state) => state.setUpdateCheckOnStartup,
  );
  const uiZoom = usePreferencesStore((state) => state.uiZoom);
  const setUiZoom = usePreferencesStore((state) => state.setUiZoom);
  const setThemeKind = usePreferencesStore((state) => state.setThemeKind);
  const setActiveDefaultThemeId = usePreferencesStore(
    (state) => state.setActiveDefaultThemeId,
  );
  const setActiveCustomThemeId = usePreferencesStore(
    (state) => state.setActiveCustomThemeId,
  );
  const setCustomThemes = usePreferencesStore((state) => state.setCustomThemes);
  const passkeyLockEnabled = usePreferencesStore(
    (state) => state.passkeyLockEnabled,
  );
  const setPasskeyLockEnabled = usePreferencesStore(
    (state) => state.setPasskeyLockEnabled,
  );
  const passkeyCredential = usePreferencesStore(
    (state) => state.passkeyCredential,
  );
  const setPasskeyCredential = usePreferencesStore(
    (state) => state.setPasskeyCredential,
  );

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
  const viewVisibility = useWorkbenchStore((state) => state.viewVisibility);
  const setViewVisibility = useWorkbenchStore(
    (state) => state.setViewVisibility,
  );
  const sidebarWidth = useWorkbenchStore((state) => state.sidebarWidth);
  const setSidebarWidth = useWorkbenchStore((state) => state.setSidebarWidth);
  const inspectorWidth = useWorkbenchStore((state) => state.inspectorWidth);
  const setInspectorWidth = useWorkbenchStore(
    (state) => state.setInspectorWidth,
  );
  const resultsHeight = useWorkbenchStore((state) => state.resultsHeight);
  const setResultsHeight = useWorkbenchStore((state) => state.setResultsHeight);

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

  const profiles = useConnectionStore((state) => state.profiles);
  const setProfiles = useConnectionStore((state) => state.setProfiles);
  const setSelectedProfileId = useConnectionStore(
    (state) => state.setSelectedProfileId,
  );
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const setActiveConnectionId = useConnectionStore(
    (state) => state.setActiveConnectionId,
  );
  const setDraft = useConnectionStore((state) => state.setDraft);

  useEffect(() => {
    if (settingsOpen && settingsTab === "jobs") {
      void refreshJobs();
    }
  }, [settingsOpen, settingsTab]);

  function buildSettingsJson() {
    return JSON.stringify(
      {
        version: CURRENT_SETTINGS_SCHEMA_VERSION,
        locale,
        theme: themes.activeCustomTheme?.theme ?? themes.themePreference,
        defaultThemeId:
          themes.activeDefaultTheme?.id ?? themes.activeDefaultThemeId,
        activeCustomThemeId: themes.activeCustomThemeId,
        customThemes: themes.customThemes,
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
        security: {
          passkeyLockEnabled,
          passkeyCredential,
        },
        updates: {
          checkOnStartup: updateCheckOnStartup,
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
        keymapOverrides: keybindings.keymapOverrides,
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
      const next = await workbenchRuntimeService.jobsList();
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
      await workbenchRuntimeService.jobsCancel(jobId);
      await refreshJobs();
    } catch (error) {
      setJobsError(errorMessage(error));
    }
  }

  function resetSettingsJsonDraft() {
    setSettingsJsonDraft(buildSettingsJson());
    setSettingsJsonError(null);
    showActionNotice(
      "info",
      t("notice.workbench.settingsJsonReset"),
      t("notice.workbench.settingsJsonResetDetail"),
    );
  }

  function applySettingsJson() {
    try {
      const parsedRoot = JSON.parse(settingsJsonDraft) as unknown;
      if (!isRecord(parsedRoot)) {
        throw new Error("settings JSON root must be an object");
      }
      const parsed = migrateSettingsJson(parsedRoot);
      if (typeof parsed.locale === "string") {
        const nextLocale = normalizeLocale(parsed.locale);
        setLocale(nextLocale);
        parsed.locale = nextLocale;
      }
      let themeNotice: string | null = null;
      let nextCustomThemes = themes.customThemes;
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
          themeNotice = t("settings.theme.activeTheme.builtinNameDescription", {
            name: entry.name,
          });
        }
      } else if (
        parsed.theme === "system" ||
        parsed.theme === "dark" ||
        parsed.theme === "light"
      ) {
        themes.activateThemePreference(parsed.theme);
        nextActiveCustomThemeId = null;
      } else if (isRecord(parsed.theme)) {
        const themeSource = parsed.theme;
        const importResult = importThemeJson(themeSource, themes.themeKind);
        const nextTheme = importResult.theme;
        parsed.theme = nextTheme;
        themeNotice =
          importResult.source === "vscode"
            ? importResult.warnings.length > 0
              ? t("notice.workbench.vscodeThemeConvertedWarnings", {
                  name: nextTheme.name,
                  count: importResult.warnings.length,
                })
              : t("notice.workbench.vscodeThemeConverted", {
                  name: nextTheme.name,
                })
            : t("settings.theme.activeTheme.customDescription", {
                name: nextTheme.name,
              });
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
            : themes.themeKind;
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
            ? t("notice.workbench.vscodeThemeConvertedWarnings", {
                name: importResult.theme.name,
                count: importResult.warnings.length,
              })
            : t("notice.workbench.vscodeThemeConverted", {
                name: importResult.theme.name,
              });
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
          themeNotice = t("settings.theme.activeTheme.customDescription", {
            name: entry.name,
          });
        }
      }
      if (typeof parsed.defaultThemeId === "string") {
        const entry = defaultThemeById(parsed.defaultThemeId);
        if (entry) {
          setActiveDefaultThemeId(entry.id);
          parsed.defaultThemeId = entry.id;
          if (!themeNotice) {
            themeNotice = t(
              "settings.theme.activeTheme.builtinNameDescription",
              {
                name: entry.name,
              },
            );
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
      if (isRecord(parsed.security)) {
        const nextPasskeyCredential = normalizePasskeyCredentialRecord(
          parsed.security.passkeyCredential,
        );
        if ("passkeyCredential" in parsed.security) {
          setPasskeyCredential(nextPasskeyCredential);
          parsed.security.passkeyCredential = nextPasskeyCredential;
        }
        if (typeof parsed.security.passkeyLockEnabled === "boolean") {
          const canEnable = Boolean(nextPasskeyCredential ?? passkeyCredential);
          setPasskeyLockEnabled(
            parsed.security.passkeyLockEnabled && canEnable,
          );
          parsed.security.passkeyLockEnabled =
            parsed.security.passkeyLockEnabled && canEnable;
        }
      }
      if (isRecord(parsed.updates)) {
        if (typeof parsed.updates.checkOnStartup === "boolean") {
          setUpdateCheckOnStartup(parsed.updates.checkOnStartup);
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
        const nextViewPlacements = parsed.layout.viewPlacements;
        if (isRecord(nextViewPlacements)) {
          const importedPlacements: Partial<WorkbenchViewPlacements> = {};
          for (const viewId of workbenchViewIds) {
            const side = nextViewPlacements[viewId];
            if (side === "left" || side === "right") {
              importedPlacements[viewId] = side;
            }
          }
          setViewPlacements((current) => {
            return { ...current, ...importedPlacements };
          });
        }
        const nextViewVisibility = parsed.layout.viewVisibility;
        if (isRecord(nextViewVisibility)) {
          const importedVisibility: Partial<WorkbenchViewVisibility> = {};
          for (const viewId of workbenchViewIds) {
            const open = nextViewVisibility[viewId];
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
        keybindings.replaceKeymapOverrides(nextKeymap);
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
        t("notice.workbench.settingsApplied"),
        themeNotice ?? t("notice.workbench.settingsAppliedDetail"),
      );
    } catch (error) {
      const message = errorMessage(error);
      setSettingsJsonError(message);
      showActionNotice(
        "error",
        t("notice.workbench.settingsJsonFailed"),
        message,
      );
    }
  }

  return {
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    openSettingsSection,
    locale,
    setLocale,
    vimMode,
    setVimMode,
    editorBackgroundImage,
    setEditorBackgroundImage,
    editorBackgroundOpacity,
    setEditorBackgroundOpacity,
    animationsEnabled,
    setAnimationsEnabled,
    autoCommit,
    setAutoCommit,
    updateCheckOnStartup,
    setUpdateCheckOnStartup,
    uiZoom,
    setUiZoom,
    formatter,
    setFormatter,
    sqlLinter,
    setSqlLinter,
    passkeyLockEnabled,
    setPasskeyLockEnabled,
    passkeyCredential,
    setPasskeyCredential,
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
    settingsJsonDraft,
    setSettingsJsonDraft,
    settingsJsonError,
    setSettingsJsonError,
    resetSettingsJsonDraft,
    applySettingsJson,
    jobs,
    jobsLoading,
    jobsError,
    refreshJobs,
    cancelJob,
  };
}

export type SettingsController = ReturnType<typeof useSettingsController>;
