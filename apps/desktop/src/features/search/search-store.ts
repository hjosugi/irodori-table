import { create } from "zustand";
import type { SearchOptions } from "@/sql/text-search";

type SearchState = {
  query: string;
  replacement: string;
  options: SearchOptions;
  showReplace: boolean;
  /** Bumped whenever the panel should focus + select its search input (e.g. when
   * opened from a command). */
  focusNonce: number;

  setQuery: (value: string) => void;
  setReplacement: (value: string) => void;
  toggleOption: (key: keyof SearchOptions) => void;
  setShowReplace: (value: boolean) => void;
  /** Prefill the query (used by "Search in all tabs" from a selection) and focus. */
  openWith: (query: string) => void;
  /** Just request focus on the existing query. */
  requestFocus: () => void;
};

export const useSearchStore = create<SearchState>((set) => ({
  query: "",
  replacement: "",
  options: { caseSensitive: false, wholeWord: false, useRegex: false },
  showReplace: false,
  focusNonce: 0,

  setQuery: (value) => set({ query: value }),
  setReplacement: (value) => set({ replacement: value }),
  toggleOption: (key) =>
    set((state) => ({ options: { ...state.options, [key]: !state.options[key] } })),
  setShowReplace: (value) => set({ showReplace: value }),
  openWith: (query) =>
    set((state) => ({
      query: query || state.query,
      focusNonce: state.focusNonce + 1,
    })),
  requestFocus: () => set((state) => ({ focusNonce: state.focusNonce + 1 })),
}));
