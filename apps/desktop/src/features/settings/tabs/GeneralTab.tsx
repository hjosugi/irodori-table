import {
  Image as ImageIcon,
  RotateCcw,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
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
} from "../../preferences";
import {
  formatterOptions,
  isSqlFormatterId,
  type SqlFormatterId,
} from "../../../sql/formatter";
import {
  isSqlLinterId,
  linterOptions,
  type SqlLinterId,
} from "../../../sql/linter";
import { localeLabels, supportedLocales, type Locale } from "../../../i18n";
import {
  clampNumber,
  type BooleanUpdater,
  type TranslateFn,
  type ValueUpdater,
} from "./shared";

export interface GeneralTabProps {
  t: TranslateFn;
  locale: Locale;
  setLocale: (value: Locale) => void;
  uiZoom: number;
  setUiZoom: (value: ValueUpdater<number>) => void;
  vimMode: boolean;
  setVimMode: (value: boolean) => void;
  editorBackgroundImage: string;
  setEditorBackgroundImage: (value: string) => void;
  editorBackgroundOpacity: number;
  setEditorBackgroundOpacity: (value: number) => void;
  animationsEnabled: boolean;
  setAnimationsEnabled: (value: BooleanUpdater) => void;
  autoCommit: boolean;
  setAutoCommit: (value: BooleanUpdater) => void;
  formatter: SqlFormatterId;
  setFormatter: (value: SqlFormatterId) => void;
  sqlLinter: SqlLinterId;
  setSqlLinter: (value: SqlLinterId) => void;
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
}

export function GeneralTab({
  t,
  locale,
  setLocale,
  uiZoom,
  setUiZoom,
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
  formatter,
  setFormatter,
  sqlLinter,
  setSqlLinter,
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
}: GeneralTabProps) {
  const uiZoomPercent = `${Math.round(uiZoom * 100)}%`;

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
    <div className="settings-stack">
      <label className="settings-row">
        <span>
          <strong>{t("settings.general.language.title")}</strong>
          <small>{t("settings.general.language.description")}</small>
        </span>
        <select
          value={locale}
          onChange={(event) => setLocale(event.currentTarget.value as Locale)}
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
          <small>{t("settings.general.editorMode.description")}</small>
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
          <strong>{t("settings.general.editorBackground.title")}</strong>
          <small>{t("settings.general.editorBackground.description")}</small>
        </span>
        <div className="editor-background-control">
          <div className="editor-background-input">
            <ImageIcon size={14} />
            <input
              type="text"
              value={editorBackgroundImage}
              placeholder={t("settings.general.editorBackground.placeholder")}
              onChange={(event) =>
                setEditorBackgroundImage(event.currentTarget.value)
              }
            />
          </div>
          <label className="text-button editor-background-file">
            <Upload size={14} />
            <span>{t("settings.general.editorBackground.choose")}</span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                chooseEditorBackgroundImage(event.currentTarget.files?.[0]);
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
            aria-label={t("settings.general.editorBackground.opacity")}
            onChange={(event) =>
              setEditorBackgroundOpacity(
                normalizeEditorBackgroundOpacity(event.currentTarget.value),
              )
            }
          />
          <output>{Math.round(editorBackgroundOpacity * 100)}%</output>
        </div>
      </label>
      <label className="settings-row">
        <span>
          <strong>{t("settings.general.animations.title")}</strong>
          <small>{t("settings.general.animations.description")}</small>
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
          <small>{t("settings.general.resultOffload.description")}</small>
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
          <small>{t("settings.general.residentRows.description")}</small>
        </span>
        <input
          type="number"
          min={1_000}
          max={100_000}
          step={1_000}
          value={resultMemoryBudget}
          onChange={(event) =>
            setResultMemoryBudget(
              clampNumber(Number(event.currentTarget.value), 1_000, 100_000),
            )
          }
        />
      </label>
      <label className="settings-row">
        <span>
          <strong>{t("settings.general.queryHistory.title")}</strong>
          <small>{t("settings.general.queryHistory.description")}</small>
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
          <small>{t("settings.general.historyRows.description")}</small>
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
  );
}
