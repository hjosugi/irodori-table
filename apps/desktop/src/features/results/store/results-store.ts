import { create } from "zustand";

type ValueUpdater<T> = T | ((current: T) => T);

type ResultsState = {
  resultOffloadEnabled: boolean;
  resultMemoryBudget: number;
  setResultOffloadEnabled: (value: ValueUpdater<boolean>) => void;
  setResultMemoryBudget: (value: ValueUpdater<number>) => void;
};

const resultOffloadStorageKey = "irodori.results.offload.v1";
const resultMemoryBudgetStorageKey = "irodori.results.memoryBudget.v1";
const resultMemoryBudgetDefault = 10_000;
const resultMemoryBudgetMin = 1_000;
const resultMemoryBudgetMax = 100_000;

function resolveValue<T>(current: T, value: ValueUpdater<T>): T {
  return typeof value === "function"
    ? (value as (current: T) => T)(current)
    : value;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function loadResultOffload() {
  return window.localStorage.getItem(resultOffloadStorageKey) === "true";
}

function loadResultMemoryBudget() {
  const stored = Number(window.localStorage.getItem(resultMemoryBudgetStorageKey));
  return Number.isFinite(stored)
    ? clampNumber(stored, resultMemoryBudgetMin, resultMemoryBudgetMax)
    : resultMemoryBudgetDefault;
}

export const useResultsStore = create<ResultsState>((set) => ({
  resultOffloadEnabled: loadResultOffload(),
  resultMemoryBudget: loadResultMemoryBudget(),
  setResultOffloadEnabled: (value) =>
    set((state) => ({
      resultOffloadEnabled: resolveValue(state.resultOffloadEnabled, value),
    })),
  setResultMemoryBudget: (value) =>
    set((state) => ({
      resultMemoryBudget: clampNumber(
        resolveValue(state.resultMemoryBudget, value),
        resultMemoryBudgetMin,
        resultMemoryBudgetMax,
      ),
    })),
}));

useResultsStore.subscribe((state) => {
  window.localStorage.setItem(
    resultOffloadStorageKey,
    String(state.resultOffloadEnabled),
  );
  window.localStorage.setItem(
    resultMemoryBudgetStorageKey,
    String(state.resultMemoryBudget),
  );
});
