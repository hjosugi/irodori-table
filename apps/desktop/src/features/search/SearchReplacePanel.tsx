import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Replace, Search, X } from "lucide-react";
import {
  findMatches,
  isValidQuery,
  replaceAllInText,
  replaceMatchAt,
  type SearchOptions,
  type TextMatch,
} from "@/sql/text-search";
import "./search-replace.css";

/** One searchable editor tab (one entry per group, since split groups hold
 * independent text for the same tab id). */
export type SearchTab = {
  /** Stable unique key across groups, e.g. `primary:scratch`. */
  key: string;
  group: string;
  tabId: string;
  label: string;
  text: string;
};

export type SearchReplacePanelProps = {
  tabs: SearchTab[];
  /** Jump to a match: activate its tab and select the range. */
  onReveal: (tab: SearchTab, match: TextMatch) => void;
  /** Replace a tab's full text (used for both single and bulk replace). */
  onReplaceTab: (tab: SearchTab, nextText: string) => void;
  onClose: () => void;
};

type TabResult = { tab: SearchTab; matches: TextMatch[] };

export function SearchReplacePanel({
  tabs,
  onReveal,
  onReplaceTab,
  onClose,
}: SearchReplacePanelProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [opts, setOpts] = useState<SearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const valid = isValidQuery(query, opts);

  const results = useMemo<TabResult[]>(() => {
    if (!query || !valid) return [];
    return tabs
      .map((tab) => ({ tab, matches: findMatches(tab.text, query, opts) }))
      .filter((r) => r.matches.length > 0);
  }, [tabs, query, opts, valid]);

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);

  const toggle = (key: keyof SearchOptions) =>
    setOpts((o) => ({ ...o, [key]: !o[key] }));

  const toggleCollapsed = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const replaceOne = (tab: SearchTab, match: TextMatch) => {
    const next = replaceMatchAt(tab.text, match.start, query, replacement, opts);
    if (next !== null) onReplaceTab(tab, next);
  };

  const replaceAllInTab = (tab: SearchTab) => {
    const { text, count } = replaceAllInText(tab.text, query, replacement, opts);
    if (count > 0) onReplaceTab(tab, text);
  };

  const replaceEverywhere = () => {
    for (const { tab } of results) replaceAllInTab(tab);
  };

  return (
    <section className="search-panel" aria-label="Search and replace">
      <header className="search-header">
        <span className="search-title">
          <Search size={14} /> Search
        </span>
        <button type="button" title="Close" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </header>

      <div className="search-inputs">
        <button
          type="button"
          className="search-replace-expand"
          aria-label={showReplace ? "Hide replace" : "Show replace"}
          aria-expanded={showReplace}
          onClick={() => setShowReplace((v) => !v)}
        >
          {showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="search-fields">
          <div className={`search-field${valid ? "" : " invalid"}`}>
            <input
              autoFocus
              value={query}
              placeholder="Search across all tabs"
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="search-toggles">
              <button
                type="button"
                className={opts.caseSensitive ? "active" : undefined}
                title="Match case"
                aria-pressed={opts.caseSensitive}
                onClick={() => toggle("caseSensitive")}
              >
                Aa
              </button>
              <button
                type="button"
                className={opts.wholeWord ? "active" : undefined}
                title="Match whole word"
                aria-pressed={opts.wholeWord}
                onClick={() => toggle("wholeWord")}
              >
                ab
              </button>
              <button
                type="button"
                className={opts.useRegex ? "active" : undefined}
                title="Use regular expression"
                aria-pressed={opts.useRegex}
                onClick={() => toggle("useRegex")}
              >
                .*
              </button>
            </div>
          </div>

          {showReplace ? (
            <div className="search-field">
              <input
                value={replacement}
                placeholder="Replace"
                onChange={(e) => setReplacement(e.target.value)}
              />
              <button
                type="button"
                className="search-replace-all"
                title="Replace all (every tab)"
                disabled={!query || !valid || totalMatches === 0}
                onClick={replaceEverywhere}
              >
                <Replace size={13} /> All
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="search-summary">
        {!query ? (
          "Type to search every open editor tab."
        ) : !valid ? (
          <span className="search-invalid">Invalid regular expression</span>
        ) : totalMatches === 0 ? (
          "No results."
        ) : (
          `${totalMatches} result${totalMatches === 1 ? "" : "s"} in ${results.length} tab${
            results.length === 1 ? "" : "s"
          }`
        )}
      </div>

      <div className="search-results">
        {results.map(({ tab, matches }) => {
          const isCollapsed = collapsed.has(tab.key);
          return (
            <div key={tab.key} className="search-file">
              <div className="search-file-head">
                <button
                  type="button"
                  className="search-file-toggle"
                  onClick={() => toggleCollapsed(tab.key)}
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <span className="search-file-name">{tab.label}</span>
                  <span className="search-file-count">{matches.length}</span>
                </button>
                {showReplace ? (
                  <button
                    type="button"
                    className="search-file-replace"
                    title="Replace all in this tab"
                    onClick={() => replaceAllInTab(tab)}
                  >
                    <Replace size={12} />
                  </button>
                ) : null}
              </div>
              {!isCollapsed
                ? matches.map((match, i) => (
                    <div key={`${match.start}-${i}`} className="search-match">
                      <button
                        type="button"
                        className="search-match-line"
                        title={`Line ${match.line}, Col ${match.column}`}
                        onClick={() => onReveal(tab, match)}
                      >
                        <span className="search-match-ln">{match.line}</span>
                        <span className="search-match-text">
                          {renderPreview(match)}
                        </span>
                      </button>
                      {showReplace ? (
                        <button
                          type="button"
                          className="search-match-replace"
                          title="Replace this match"
                          onClick={() => replaceOne(tab, match)}
                        >
                          <Replace size={11} />
                        </button>
                      ) : null}
                    </div>
                  ))
                : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Highlight the matched span within its line, trimming long leading context. */
function renderPreview(match: TextMatch) {
  const col = match.column - 1;
  const len = match.end - match.start;
  const leadTrim = Math.max(0, col - 30);
  const before = match.lineText.slice(leadTrim, col);
  const hit = match.lineText.slice(col, col + len);
  const after = match.lineText.slice(col + len);
  return (
    <>
      {leadTrim > 0 ? "…" : ""}
      {before}
      <mark>{hit}</mark>
      {after.slice(0, 80)}
    </>
  );
}
