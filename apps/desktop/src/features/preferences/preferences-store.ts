import { create } from "zustand";
import {
  cloneDefaultSqlSnippets,
  mergeDefaultSqlSnippets,
  sqlSnippetsFromJson,
  type SqlSnippetDefinition,
} from "../../sql/completion";
import {
  isSqlFormatterId,
  type SqlFormatterId,
} from "../../sql/formatter";
import { detectBrowserLocale, normalizeLocale, type Locale } from "../../i18n";
import { isSqlLinterId, type SqlLinterId } from "../../sql/linter";
import {
  defaultThemeEntryForKind,
  type CustomThemeEntry,
  type IrodoriTheme,
  type ThemeKind,
} from "@/theme";

export type { CustomThemeEntry } from "@/theme";
export type ThemePreference = "system" | ThemeKind;
type ValueUpdater<T> = T | ((current: T) => T);

const themeStorageKey = "irodori.theme.v1";
const activeDefaultThemeStorageKey = "irodori.theme.defaultId.v1";
const activeCustomThemeStorageKey = "irodori.theme.activeCustomId.v1";
const customThemesStorageKey = "irodori.theme.customThemes.v1";
const legacyCustomThemeStorageKey = "irodori.theme.customJson.v1";
const vimModeStorageKey = "irodori.editor.vimMode.v1";
const formatterStorageKey = "irodori.editor.formatter.v1";
const linterStorageKey = "irodori.editor.linter.v1";
const snippetsStorageKey = "irodori.editor.snippets.v1";
const editorBackgroundImageStorageKey = "irodori.editor.backgroundImage.v1";
const editorBackgroundOpacityStorageKey =
  "irodori.editor.backgroundOpacity.v1";
const animationsEnabledStorageKey = "irodori.ui.animationsEnabled.v1";
const autoCommitStorageKey = "irodori.query.autoCommit.v1";
const localeStorageKey = "irodori.locale.v1";
const uiZoomStorageKey = "irodori.ui.zoom.v1";

export const UI_ZOOM_DEFAULT = 1;
export const UI_ZOOM_MIN = 0.75;
export const UI_ZOOM_MAX = 1.5;
export const UI_ZOOM_STEP = 0.1;
export const EDITOR_BACKGROUND_OPACITY_DEFAULT = 0.08;
export const EDITOR_BACKGROUND_OPACITY_MIN = 0;
export const EDITOR_BACKGROUND_OPACITY_MAX = 0.35;
export const EDITOR_BACKGROUND_OPACITY_STEP = 0.01;

type PreferencesState = {
  locale: Locale;
  themePreference: ThemePreference;
  themeKind: ThemeKind;
  activeDefaultThemeId: string | null;
  activeCustomThemeId: string | null;
  customThemes: CustomThemeEntry[];
  vimMode: boolean;
  formatter: SqlFormatterId;
  sqlLinter: SqlLinterId;
  sqlSnippets: SqlSnippetDefinition[];
  editorBackgroundImage: string;
  editorBackgroundOpacity: number;
  animationsEnabled: boolean;
  autoCommit: boolean;
  uiZoom: number;
  setLocale: (value: ValueUpdater<Locale>) => void;
  setThemePreference: (value: ValueUpdater<ThemePreference>) => void;
  setThemeKind: (value: ValueUpdater<ThemeKind>) => void;
  setActiveDefaultThemeId: (value: ValueUpdater<string | null>) => void;
  setActiveCustomThemeId: (value: ValueUpdater<string | null>) => void;
  setCustomThemes: (value: ValueUpdater<CustomThemeEntry[]>) => void;
  setVimMode: (value: ValueUpdater<boolean>) => void;
  setFormatter: (value: ValueUpdater<SqlFormatterId>) => void;
  setSqlLinter: (value: ValueUpdater<SqlLinterId>) => void;
  setSqlSnippets: (value: ValueUpdater<SqlSnippetDefinition[]>) => void;
  setEditorBackgroundImage: (value: ValueUpdater<string>) => void;
  setEditorBackgroundOpacity: (value: ValueUpdater<number>) => void;
  setAnimationsEnabled: (value: ValueUpdater<boolean>) => void;
  setAutoCommit: (value: ValueUpdater<boolean>) => void;
  setUiZoom: (value: ValueUpdater<number>) => void;
};

function resolveValue<T>(current: T, value: ValueUpdater<T>): T {
  return typeof value === "function"
    ? (value as (current: T) => T)(current)
    : value;
}

function localStorageOrNull(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStorage(key: string) {
  return localStorageOrNull()?.getItem(key) ?? null;
}

function writeStorage(key: string, value: string) {
  localStorageOrNull()?.setItem(key, value);
}

function removeStorage(key: string) {
  localStorageOrNull()?.removeItem(key);
}

function systemThemeKind(): ThemeKind {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "dark" || value === "light" || value === "system"
    ? value
    : "system";
}

function themeKindForPreference(preference: ThemePreference): ThemeKind {
  return preference === "system" ? systemThemeKind() : preference;
}

function defaultThemeIdForKind(
  kind: ThemeKind,
  preferredId?: string | null,
) {
  return defaultThemeEntryForKind(kind, preferredId)?.id ?? null;
}

function loadThemePreference(): ThemePreference {
  return normalizeThemePreference(readStorage(themeStorageKey));
}

function loadLocale(): Locale {
  const stored = readStorage(localeStorageKey);
  return stored ? normalizeLocale(stored) : detectBrowserLocale();
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
  const stored = readStorage(customThemesStorageKey);
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

  const legacy = readStorage(legacyCustomThemeStorageKey);
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

function loadActiveDefaultThemeId(themeKind: ThemeKind) {
  return defaultThemeIdForKind(
    themeKind,
    readStorage(activeDefaultThemeStorageKey),
  );
}

function loadActiveCustomThemeId(customThemes: CustomThemeEntry[]) {
  const stored = readStorage(activeCustomThemeStorageKey);
  if (stored && customThemes.some((theme) => theme.id === stored)) {
    return stored;
  }
  return customThemes.length === 1 &&
    readStorage(legacyCustomThemeStorageKey)
    ? customThemes[0].id
    : null;
}

function loadVimMode() {
  return readStorage(vimModeStorageKey) === "true";
}

function loadFormatter(): SqlFormatterId {
  const stored = readStorage(formatterStorageKey);
  return isSqlFormatterId(stored) ? stored : "sql-formatter";
}

function loadLinter(): SqlLinterId {
  const stored = readStorage(linterStorageKey);
  return isSqlLinterId(stored) ? stored : "gentle";
}

function loadSqlSnippets(): SqlSnippetDefinition[] {
  const stored = readStorage(snippetsStorageKey);
  if (!stored) {
    return cloneDefaultSqlSnippets();
  }
  try {
    return mergeDefaultSqlSnippets(
      sqlSnippetsFromJson(JSON.parse(stored) as unknown),
    );
  } catch {
    return cloneDefaultSqlSnippets();
  }
}

function loadAutoCommit() {
  return readStorage(autoCommitStorageKey) !== "false";
}

function loadAnimationsEnabled() {
  return readStorage(animationsEnabledStorageKey) !== "false";
}

function normalizeEditorBackgroundImage(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeEditorBackgroundOpacity(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return EDITOR_BACKGROUND_OPACITY_DEFAULT;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return EDITOR_BACKGROUND_OPACITY_DEFAULT;
  }
  const clamped = Math.min(
    EDITOR_BACKGROUND_OPACITY_MAX,
    Math.max(EDITOR_BACKGROUND_OPACITY_MIN, parsed),
  );
  return Math.round(clamped * 100) / 100;
}

function loadEditorBackgroundImage() {
  return normalizeEditorBackgroundImage(
    readStorage(editorBackgroundImageStorageKey),
  );
}

function loadEditorBackgroundOpacity() {
  return normalizeEditorBackgroundOpacity(
    readStorage(editorBackgroundOpacityStorageKey),
  );
}

export function normalizeUiZoom(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return UI_ZOOM_DEFAULT;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return UI_ZOOM_DEFAULT;
  }
  const clamped = Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, parsed));
  return Math.round(clamped * 100) / 100;
}

function loadUiZoom() {
  return normalizeUiZoom(readStorage(uiZoomStorageKey));
}

const initialCustomThemes = loadCustomThemes();
const initialThemePreference = loadThemePreference();
const initialThemeKind = themeKindForPreference(initialThemePreference);

export const usePreferencesStore = create<PreferencesState>((set) => ({
  locale: loadLocale(),
  themePreference: initialThemePreference,
  themeKind: initialThemeKind,
  activeDefaultThemeId: loadActiveDefaultThemeId(initialThemeKind),
  activeCustomThemeId: loadActiveCustomThemeId(initialCustomThemes),
  customThemes: initialCustomThemes,
  vimMode: loadVimMode(),
  formatter: loadFormatter(),
  sqlLinter: loadLinter(),
  sqlSnippets: loadSqlSnippets(),
  editorBackgroundImage: loadEditorBackgroundImage(),
  editorBackgroundOpacity: loadEditorBackgroundOpacity(),
  animationsEnabled: loadAnimationsEnabled(),
  autoCommit: loadAutoCommit(),
  uiZoom: loadUiZoom(),
  setLocale: (value) =>
    set((state) => ({ locale: normalizeLocale(resolveValue(state.locale, value)) })),
  setThemePreference: (value) =>
    set((state) => {
      const themePreference = normalizeThemePreference(
        resolveValue(state.themePreference, value),
      );
      const themeKind = themeKindForPreference(themePreference);
      return {
        themePreference,
        themeKind,
        activeDefaultThemeId: defaultThemeIdForKind(
          themeKind,
          state.activeDefaultThemeId,
        ),
      };
    }),
  setThemeKind: (value) =>
    set((state) => {
      const themeKind = resolveValue(state.themeKind, value);
      return {
        themePreference: themeKind,
        themeKind,
        activeDefaultThemeId: defaultThemeIdForKind(
          themeKind,
          state.activeDefaultThemeId,
        ),
      };
    }),
  setActiveDefaultThemeId: (value) =>
    set((state) => ({
      activeDefaultThemeId: defaultThemeIdForKind(
        state.themeKind,
        resolveValue(state.activeDefaultThemeId, value),
      ),
    })),
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
  setSqlSnippets: (value) =>
    set((state) => ({ sqlSnippets: resolveValue(state.sqlSnippets, value) })),
  setEditorBackgroundImage: (value) =>
    set((state) => ({
      editorBackgroundImage: normalizeEditorBackgroundImage(
        resolveValue(state.editorBackgroundImage, value),
      ),
    })),
  setEditorBackgroundOpacity: (value) =>
    set((state) => ({
      editorBackgroundOpacity: normalizeEditorBackgroundOpacity(
        resolveValue(state.editorBackgroundOpacity, value),
      ),
    })),
  setAnimationsEnabled: (value) =>
    set((state) => ({
      animationsEnabled: resolveValue(state.animationsEnabled, value),
    })),
  setAutoCommit: (value) =>
    set((state) => ({ autoCommit: resolveValue(state.autoCommit, value) })),
  setUiZoom: (value) =>
    set((state) => ({ uiZoom: normalizeUiZoom(resolveValue(state.uiZoom, value)) })),
}));

usePreferencesStore.subscribe((state) => {
  writeStorage(localeStorageKey, state.locale);
  writeStorage(themeStorageKey, state.themePreference);
  if (state.activeDefaultThemeId) {
    writeStorage(activeDefaultThemeStorageKey, state.activeDefaultThemeId);
  } else {
    removeStorage(activeDefaultThemeStorageKey);
  }
  if (state.activeCustomThemeId) {
    writeStorage(
      activeCustomThemeStorageKey,
      state.activeCustomThemeId,
    );
  } else {
    removeStorage(activeCustomThemeStorageKey);
  }
  writeStorage(
    customThemesStorageKey,
    JSON.stringify(state.customThemes),
  );
  removeStorage(legacyCustomThemeStorageKey);
  writeStorage(vimModeStorageKey, String(state.vimMode));
  writeStorage(formatterStorageKey, state.formatter);
  writeStorage(linterStorageKey, state.sqlLinter);
  writeStorage(
    snippetsStorageKey,
    JSON.stringify(state.sqlSnippets),
  );
  if (state.editorBackgroundImage) {
    writeStorage(editorBackgroundImageStorageKey, state.editorBackgroundImage);
  } else {
    removeStorage(editorBackgroundImageStorageKey);
  }
  writeStorage(
    editorBackgroundOpacityStorageKey,
    String(state.editorBackgroundOpacity),
  );
  writeStorage(animationsEnabledStorageKey, String(state.animationsEnabled));
  writeStorage(autoCommitStorageKey, String(state.autoCommit));
  writeStorage(uiZoomStorageKey, String(state.uiZoom));
});

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemThemeChange = () => {
    const state = usePreferencesStore.getState();
    if (state.themePreference === "system") {
      const themeKind = systemThemeKind();
      usePreferencesStore.setState({
        themeKind,
        activeDefaultThemeId: defaultThemeIdForKind(
          themeKind,
          state.activeDefaultThemeId,
        ),
      });
    }
  };
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onSystemThemeChange);
  } else {
    media.addListener?.(onSystemThemeChange);
  }
}
