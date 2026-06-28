import type { CustomThemeEntry, ThemePreference } from "../../preferences";
import { defaultThemeEntries, type ThemeKind } from "@/theme";
import type { SettingsTab } from "../SettingsDialog";
import type { TranslateFn } from "./shared";

export interface ThemeTabProps {
  t: TranslateFn;
  onOpenSection: (tab: SettingsTab) => void;
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
}

export function ThemeTab({
  t,
  onOpenSection,
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
}: ThemeTabProps) {
  return (
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
  );
}
