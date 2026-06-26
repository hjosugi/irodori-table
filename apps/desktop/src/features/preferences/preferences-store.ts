import { create } from "zustand";
import {
  isSqlFormatterId,
  type SqlFormatterId,
} from "../../sql/formatter";
import { isSqlLinterId, type SqlLinterId } from "../../sql/linter";
import type { CustomThemeEntry, IrodoriTheme, ThemeKind } from "../../theme";

export type { CustomThemeEntry } from "../../theme";
type ValueUpdater<T> = T | ((current: T) => T);

const themeStorageKey = "irodori.theme.v1";
const activeCustomThemeStorageKey = "irodori.theme.activeCustomId.v1";
const customThemesStorageKey = "irodori.theme.customThemes.v1";
const legacyCustomThemeStorageKey = "irodori.theme.customJson.v1";
const vimModeStorageKey = "irodori.editor.vimMode.v1";
const formatterStorageKey = "irodori.editor.formatter.v1";
const linterStorageKey = "irodori.editor.linter.v1";
const autoCommitStorageKey = "irodori.query.autoCommit.v1";

type PreferencesState = {
  themeKind: ThemeKind;
  activeCustomThemeId: string | null;
  customThemes: CustomThemeEntry[];
  vimMode: boolean;
  formatter: SqlFormatterId;
  sqlLinter: SqlLinterId;
  autoCommit: boolean;
  setThemeKind: (value: ValueUpdater<ThemeKind>) => void;
  setActiveCustomThemeId: (value: ValueUpdater<string | null>) => void;
  setCustomThemes: (value: ValueUpdater<CustomThemeEntry[]>) => void;
  setVimMode: (value: ValueUpdater<boolean>) => void;
  setFormatter: (value: ValueUpdater<SqlFormatterId>) => void;
  setSqlLinter: (value: ValueUpdater<SqlLinterId>) => void;
  setAutoCommit: (value: ValueUpdater<boolean>) => void;
};

function resolveValue<T>(current: T, value: ValueUpdater<T>): T {
  return typeof value === "function"
    ? (value as (current: T) => T)(current)
    : value;
}

function loadThemeKind(): ThemeKind {
  return window.localStorage.getItem(themeStorageKey) === "light"
    ? "light"
    : "dark";
}

function isCustomThemeEntry(value: unknown): value is CustomThemeEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "theme" in value &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.theme === "object" &&
    value.theme !== null
  );
}

function loadCustomThemes(): CustomThemeEntry[] {
  const stored = window.localStorage.getItem(customThemesStorageKey);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(isCustomThemeEntry);
      }
    } catch {
      return [];
    }
  }

  const legacy = window.localStorage.getItem(legacyCustomThemeStorageKey);
  if (!legacy) {
    return [];
  }
  try {
    const theme = JSON.parse(legacy) as IrodoriTheme;
    if (theme && typeof theme.name === "string") {
      return [
        {
          id: "legacy-custom-theme",
          name: theme.name,
          theme,
        },
      ];
    }
  } catch {
    return [];
  }
  return [];
}

function loadActiveCustomThemeId(customThemes: CustomThemeEntry[]) {
  const stored = window.localStorage.getItem(activeCustomThemeStorageKey);
  if (stored && customThemes.some((theme) => theme.id === stored)) {
    return stored;
  }
  return customThemes.length === 1 &&
    window.localStorage.getItem(legacyCustomThemeStorageKey)
    ? customThemes[0].id
    : null;
}

function loadVimMode() {
  return window.localStorage.getItem(vimModeStorageKey) === "true";
}

function loadFormatter(): SqlFormatterId {
  const stored = window.localStorage.getItem(formatterStorageKey);
  return isSqlFormatterId(stored) ? stored : "sql-formatter";
}

function loadLinter(): SqlLinterId {
  const stored = window.localStorage.getItem(linterStorageKey);
  return isSqlLinterId(stored) ? stored : "gentle";
}

function loadAutoCommit() {
  return window.localStorage.getItem(autoCommitStorageKey) !== "false";
}

const initialCustomThemes = loadCustomThemes();

export const usePreferencesStore = create<PreferencesState>((set) => ({
  themeKind: loadThemeKind(),
  activeCustomThemeId: loadActiveCustomThemeId(initialCustomThemes),
  customThemes: initialCustomThemes,
  vimMode: loadVimMode(),
  formatter: loadFormatter(),
  sqlLinter: loadLinter(),
  autoCommit: loadAutoCommit(),
  setThemeKind: (value) =>
    set((state) => ({ themeKind: resolveValue(state.themeKind, value) })),
  setActiveCustomThemeId: (value) =>
    set((state) => ({
      activeCustomThemeId: resolveValue(state.activeCustomThemeId, value),
    })),
  setCustomThemes: (value) =>
    set((state) => {
      const customThemes = resolveValue(state.customThemes, value);
      const activeCustomThemeId = customThemes.some(
        (theme) => theme.id === state.activeCustomThemeId,
      )
        ? state.activeCustomThemeId
        : null;
      return { customThemes, activeCustomThemeId };
    }),
  setVimMode: (value) =>
    set((state) => ({ vimMode: resolveValue(state.vimMode, value) })),
  setFormatter: (value) =>
    set((state) => ({ formatter: resolveValue(state.formatter, value) })),
  setSqlLinter: (value) =>
    set((state) => ({ sqlLinter: resolveValue(state.sqlLinter, value) })),
  setAutoCommit: (value) =>
    set((state) => ({ autoCommit: resolveValue(state.autoCommit, value) })),
}));

usePreferencesStore.subscribe((state) => {
  window.localStorage.setItem(themeStorageKey, state.themeKind);
  if (state.activeCustomThemeId) {
    window.localStorage.setItem(
      activeCustomThemeStorageKey,
      state.activeCustomThemeId,
    );
  } else {
    window.localStorage.removeItem(activeCustomThemeStorageKey);
  }
  window.localStorage.setItem(
    customThemesStorageKey,
    JSON.stringify(state.customThemes),
  );
  window.localStorage.removeItem(legacyCustomThemeStorageKey);
  window.localStorage.setItem(vimModeStorageKey, String(state.vimMode));
  window.localStorage.setItem(formatterStorageKey, state.formatter);
  window.localStorage.setItem(linterStorageKey, state.sqlLinter);
  window.localStorage.setItem(autoCommitStorageKey, String(state.autoCommit));
});
