import { Search, X } from "lucide-react";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
import {
  emptyLogFilter,
  isLogFilterActive,
  logMinLevels,
  type LogFilterSpec,
  type LogMinLevel,
} from "./editor-log-filter";

export type LogFilterBarProps = {
  filter: LogFilterSpec;
  hiddenLineCount: number;
  onFilterChange: (next: LogFilterSpec) => void;
};

// Severity names are log-domain tokens (they appear verbatim in the files),
// so like the AND/OR join buttons in the results filter they stay literal.
const levelLabels: Record<Exclude<LogMinLevel, "all">, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

/**
 * Minimum-severity + regex filter for `.log` buffers (issue #177, tier 2).
 * Rendered above the editor whenever the buffer language is `log`; the
 * filtering itself is view-level only (see editor-log-filter.ts).
 */
export function LogFilterBar({
  filter,
  hiddenLineCount,
  onFilterChange,
}: LogFilterBarProps) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const active = isLogFilterActive(filter);

  const setMinLevel = (minLevel: LogMinLevel) => {
    onFilterChange({ ...filter, minLevel });
  };
  const setText = (text: string) => {
    onFilterChange({ ...filter, text });
  };

  return (
    <div
      className="log-filter-bar"
      role="group"
      aria-label={t("editor.logFilter.label")}
    >
      <div
        className="segmented-control"
        role="group"
        aria-label={t("editor.logFilter.minLevel")}
      >
        <button
          type="button"
          className={filter.minLevel === "all" ? "active" : undefined}
          aria-pressed={filter.minLevel === "all"}
          onClick={() => setMinLevel("all")}
        >
          {t("editor.logFilter.allLevels")}
        </button>
        {logMinLevels.map((level) => (
          <button
            key={level}
            type="button"
            className={filter.minLevel === level ? "active" : undefined}
            aria-pressed={filter.minLevel === level}
            onClick={() => setMinLevel(level)}
          >
            {levelLabels[level]}
          </button>
        ))}
      </div>
      <label className={`log-filter-text${filter.text ? " active" : ""}`}>
        <Search size={13} aria-hidden="true" />
        <input
          aria-label={t("editor.logFilter.pattern")}
          placeholder={t("editor.logFilter.patternPlaceholder")}
          value={filter.text}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && filter.text) {
              event.preventDefault();
              event.stopPropagation();
              setText("");
            }
          }}
        />
        {filter.text ? (
          <button
            type="button"
            aria-label={t("editor.logFilter.clearPattern")}
            title={t("editor.logFilter.clearPattern")}
            onClick={() => setText("")}
          >
            <X size={12} />
          </button>
        ) : null}
      </label>
      {/* The status + clear controls share one right-aligned slot so the
          level buttons and input never shift when the filter toggles. */}
      <span className="log-filter-status" role="status">
        {active ? t("editor.logFilter.hidden", { count: hiddenLineCount }) : ""}
      </span>
      {active ? (
        <button
          className="text-button"
          type="button"
          aria-label={t("editor.logFilter.clear")}
          title={t("editor.logFilter.clear")}
          onClick={() => onFilterChange(emptyLogFilter)}
        >
          {t("common.clear")}
        </button>
      ) : null}
    </div>
  );
}
