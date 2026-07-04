import { Plus, X } from "lucide-react";
import {
  resultFilterNeedsValue,
  resultFilterOperators,
  type ResultFilterJoin,
  type ResultFilterOperator,
  type ResultFilterRule,
} from "../result-grid";
import type { Translator } from "@/i18n";

type ResultFilterPanelProps = {
  filtersActive: boolean;
  filteredOutCount: number;
  filterJoin: ResultFilterJoin;
  filterRules: readonly ResultFilterRule[];
  resultColumns: readonly string[];
  formatCount: (value: bigint | number) => string;
  onSetFilterJoin: (join: ResultFilterJoin) => void;
  onAddFilterRule: (columnIndex?: number | "any") => void;
  onUpdateFilterRule: (id: string, patch: Partial<ResultFilterRule>) => void;
  onRemoveFilterRule: (id: string) => void;
  onClearResultFilters: () => void;
  t: Translator["t"];
};

export function ResultFilterPanel({
  filtersActive,
  filteredOutCount,
  filterJoin,
  filterRules,
  resultColumns,
  formatCount,
  onSetFilterJoin,
  onAddFilterRule,
  onUpdateFilterRule,
  onRemoveFilterRule,
  onClearResultFilters,
  t,
}: ResultFilterPanelProps) {
  return (
    <div className="result-filter-panel">
      <div className="result-filter-toolbar">
        <span>
          {filtersActive
            ? t("results.filters.hidden", {
                count: formatCount(filteredOutCount),
              })
            : t("results.filters.none")}
        </span>
        <div
          className="segmented-control"
          role="group"
          aria-label={t("results.filters.join")}
        >
          <button
            type="button"
            className={filterJoin === "and" ? "active" : undefined}
            onClick={() => onSetFilterJoin("and")}
          >
            AND
          </button>
          <button
            type="button"
            className={filterJoin === "or" ? "active" : undefined}
            onClick={() => onSetFilterJoin("or")}
          >
            OR
          </button>
        </div>
        <button
          className="text-button"
          type="button"
          onClick={() => onAddFilterRule("any")}
        >
          <Plus size={13} />
          <span>{t("results.filters.rule")}</span>
        </button>
        {filtersActive ? (
          <button
            className="text-button"
            type="button"
            onClick={onClearResultFilters}
          >
            {t("common.clear")}
          </button>
        ) : null}
      </div>
      {filterRules.length > 0 ? (
        <div className="result-filter-rules">
          {filterRules.map((rule) => {
            const needsValue = resultFilterNeedsValue(rule.operator);
            return (
              <div className="result-filter-rule" key={rule.id}>
                <label className="check-cell compact">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    aria-label={t("results.filters.enabled")}
                    onChange={(event) =>
                      onUpdateFilterRule(rule.id, {
                        enabled: event.currentTarget.checked,
                      })
                    }
                  />
                </label>
                <select
                  aria-label={t("results.filters.column")}
                  value={
                    rule.columnIndex === "any"
                      ? "any"
                      : String(rule.columnIndex)
                  }
                  onChange={(event) =>
                    onUpdateFilterRule(rule.id, {
                      columnIndex:
                        event.currentTarget.value === "any"
                          ? "any"
                          : Number(event.currentTarget.value),
                    })
                  }
                >
                  <option value="any">{t("results.filters.anyColumn")}</option>
                  {resultColumns.map((column, index) => (
                    <option value={index} key={`${column}-${index}`}>
                      {column}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t("results.filters.operator")}
                  value={rule.operator}
                  onChange={(event) =>
                    onUpdateFilterRule(rule.id, {
                      operator: event.currentTarget
                        .value as ResultFilterOperator,
                    })
                  }
                >
                  {resultFilterOperators.map((operator) => (
                    <option key={operator.value} value={operator.value}>
                      {operator.label}
                    </option>
                  ))}
                </select>
                {needsValue ? (
                  <input
                    aria-label={t("results.filters.value")}
                    value={rule.value}
                    onChange={(event) =>
                      onUpdateFilterRule(rule.id, {
                        value: event.currentTarget.value,
                      })
                    }
                  />
                ) : (
                  <span className="filter-value-placeholder">--</span>
                )}
                <button
                  className="mini-button"
                  type="button"
                  title={t("results.filters.remove")}
                  aria-label={t("results.filters.remove")}
                  onClick={() => onRemoveFilterRule(rule.id)}
                >
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
