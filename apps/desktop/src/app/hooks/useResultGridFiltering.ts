import {
  cycleResultSortRules,
  useResultGridStore,
  type ResultFilterRule,
} from "@/features/results";

type UseResultGridFilteringParams = {
  /**
   * Resets the grid scroll (and optionally clears selection) after a
   * filter/sort change. Provided by `useResultGridScroll`.
   */
  resetGridScrollPosition: (clearSelection?: boolean) => void;
};

/**
 * Owns the result grid's filter/sort state (in `useResultGridStore`) and the
 * commands that mutate it. Every mutation resets the grid scroll position to
 * keep the viewport aligned with the recomputed rows, so this hook depends on
 * `resetGridScrollPosition`.
 *
 * The derived `activeFilters`/`filtersActive`/`filteredOutCount`/
 * `sortRuleByColumn` values come from the `resultGridView` memo and remain
 * destructured in `AppWorkbench`, because `resultGridView` consumes this hook's
 * state as input and must not be reordered.
 */
export function useResultGridFiltering({
  resetGridScrollPosition,
}: UseResultGridFilteringParams) {
  const sortRules = useResultGridStore((state) => state.sortRules);
  const setSortRules = useResultGridStore((state) => state.setSortRules);
  const filtersOpen = useResultGridStore((state) => state.filtersOpen);
  const setFiltersOpen = useResultGridStore((state) => state.setFiltersOpen);
  const quickFilter = useResultGridStore((state) => state.quickFilter);
  const setQuickFilter = useResultGridStore((state) => state.setQuickFilter);
  const filterJoin = useResultGridStore((state) => state.filterJoin);
  const setFilterJoin = useResultGridStore((state) => state.setFilterJoin);
  const filterRules = useResultGridStore((state) => state.filterRules);
  const setFilterRules = useResultGridStore((state) => state.setFilterRules);

  function updateQuickFilter(value: string) {
    setQuickFilter(value);
    resetGridScrollPosition(true);
  }

  function clearQuickFilter() {
    setQuickFilter("");
    resetGridScrollPosition(true);
  }

  function toggleSort(col: number, additive = false) {
    setSortRules((current) => cycleResultSortRules(current, col, additive));
    resetGridScrollPosition();
  }

  function addFilterRule(columnIndex: number | "any" = "any") {
    setFilterRules((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        columnIndex,
        operator: "contains",
        value: "",
        enabled: true,
      },
    ]);
    setFiltersOpen(true);
    resetGridScrollPosition(true);
  }

  function updateFilterRule(id: string, patch: Partial<ResultFilterRule>) {
    setFilterRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
    resetGridScrollPosition(true);
  }

  function removeFilterRule(id: string) {
    setFilterRules((current) => current.filter((rule) => rule.id !== id));
    resetGridScrollPosition(true);
  }

  function clearResultFilters() {
    setQuickFilter("");
    setFilterRules([]);
    setFilterJoin("and");
    resetGridScrollPosition(true);
  }

  return {
    sortRules,
    setSortRules,
    filtersOpen,
    setFiltersOpen,
    quickFilter,
    setQuickFilter,
    filterJoin,
    setFilterJoin,
    filterRules,
    setFilterRules,
    updateQuickFilter,
    clearQuickFilter,
    toggleSort,
    addFilterRule,
    updateFilterRule,
    removeFilterRule,
    clearResultFilters,
  };
}
