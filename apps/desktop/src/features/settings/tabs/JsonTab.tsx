import { AlertTriangle } from "lucide-react";
import type { TranslateFn } from "./shared";

export interface JsonTabProps {
  t: TranslateFn;
  settingsJsonDraft: string;
  setSettingsJsonDraft: (value: string) => void;
  settingsJsonError: string | null;
  setSettingsJsonError: (value: string | null) => void;
  resetSettingsJsonDraft: () => void;
  applySettingsJson: () => void;
}

export function JsonTab({
  t,
  settingsJsonDraft,
  setSettingsJsonDraft,
  settingsJsonError,
  setSettingsJsonError,
  resetSettingsJsonDraft,
  applySettingsJson,
}: JsonTabProps) {
  return (
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
        aria-label={t("settings.json.title")}
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
  );
}
