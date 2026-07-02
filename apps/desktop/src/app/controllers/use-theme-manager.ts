import { useEffect, useMemo, useRef, useState } from "react";
import {
  usePreferencesStore,
  type ThemePreference,
} from "@/features/preferences";
import {
  defaultThemeById,
  defaultThemeEntryForKind,
  type ThemeKind,
} from "@/theme";
import { builtInTheme } from "@/app/app-workbench-utils";

// Theme selection state and the activation flows shared by Settings, the
// command palette, and settings-JSON import. Owns the short-lived
// `themeSwitching` flag that fades light/dark switches instead of snapping.
export function useThemeManager() {
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

  return {
    theme,
    themeKind,
    themePreference,
    activeDefaultTheme,
    activeDefaultThemeId,
    activeCustomTheme,
    activeCustomThemeId,
    customThemes,
    themeSwitching,
    activateBuiltInTheme,
    activateThemePreference,
    activateDefaultTheme,
    activateCustomTheme,
  };
}

export type ThemeManager = ReturnType<typeof useThemeManager>;
