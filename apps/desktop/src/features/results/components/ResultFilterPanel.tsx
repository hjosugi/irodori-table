import { Plus, X } from "lucide-react";
import {
  resultFilterNeedsValue,
  resultFilterOperators,
  type ResultFilterJoin,
  type ResultFilterOperator,
  type ResultFilterRule,
} from "@/features/results/result-grid";

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
}: ResultFilterPanelProps) {
  return (
    <div className="result-filter-panel">
      <div className="result-filter-toolbar">
        <span>
          {filtersActive
            ? `${formatCount(filteredOutCount)} hidden`
            : "No active filters"}
        </span>
        <div
          className="segmented-control"
          role="group"
          aria-label="Filter join"
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
          <span>Rule</span>
        </button>
        {filtersActive ? (
          <button
            className="text-button"
            type="button"
            onClick={onClearResultFilters}
          >
            Clear
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
                    aria-label="Filter enabled"
                    onChange={(event) =>
                      onUpdateFilterRule(rule.id, {
                        enabled: event.currentTarget.checked,
                      })
                    }
                  />
                </label>
                <select
                  aria-label="Filter column"
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
                  <option value="any">Any column</option>
                  {resultColumns.map((column, index) => (
                    <option value={index} key={`${column}-${index}`}>
                      {column}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter operator"
                  value={rule.operator}
                  onChange={(event) =>
                    onUpdateFilterRule(rule.id, {
                      operator: event.currentTarget.value as ResultFilterOperator,
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
                    aria-label="Filter value"
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
                  title="Remove filter"
                  aria-label="Remove filter"
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
