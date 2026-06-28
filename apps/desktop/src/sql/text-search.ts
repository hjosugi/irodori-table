/**
 * Shared text search/replace primitives — the common core behind both the
 * cross-tab Search & Replace panel and any other find feature. Supports the three
 * VSCode-style toggles: case sensitivity, whole word, and regular expressions.
 *
 * Keeping match/replace logic here (rather than in a panel) means in-tab and
 * across-tab search behave identically and there's a single place to test.
 */

export type SearchOptions = {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
};

export type TextMatch = {
  /** Absolute character offset of the match start. */
  start: number;
  /** Absolute character offset of the match end (exclusive). */
  end: number;
  /** 1-based line number of the match start. */
  line: number;
  /** 1-based column of the match start. */
  column: number;
  /** The full text of the line the match starts on (for preview). */
  lineText: string;
};

/** Cap to keep a pathological query (e.g. `.`) from freezing the UI. */
const MAX_MATCHES = 5000;

/** Identifier characters used for whole-word boundaries (matches SQL identifiers). */
const WORD_CHARS = "A-Za-z0-9_$";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile the query into a global RegExp honoring the options, or return null if
 * the query is empty or an invalid regex.
 */
export function buildPattern(query: string, opts: SearchOptions): RegExp | null {
  if (!query) return null;
  let source = opts.useRegex ? query : escapeRegExp(query);
  if (opts.wholeWord) {
    source = `(?<![${WORD_CHARS}])(?:${source})(?![${WORD_CHARS}])`;
  }
  const flags = opts.caseSensitive ? "g" : "gi";
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/** Whether the query compiles (used to show an "invalid regex" hint). */
export function isValidQuery(query: string, opts: SearchOptions): boolean {
  if (!query) return true;
  return buildPattern(query, opts) !== null;
}

/** Precompute line-start offsets so line/column lookup is O(log n) per match. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineIndexAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** All matches of `query` in `text` (capped at {@link MAX_MATCHES}). */
export function findMatches(
  text: string,
  query: string,
  opts: SearchOptions,
): TextMatch[] {
  const re = buildPattern(query, opts);
  if (!re) return [];
  const starts = lineStarts(text);
  const matches: TextMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === "") {
      // Zero-width match: advance to avoid an infinite loop.
      re.lastIndex += 1;
      continue;
    }
    const start = m.index;
    const lineIdx = lineIndexAt(starts, start);
    const lineStart = starts[lineIdx];
    const lineEnd = lineIdx + 1 < starts.length ? starts[lineIdx + 1] - 1 : text.length;
    matches.push({
      start,
      end: start + m[0].length,
      line: lineIdx + 1,
      column: start - lineStart + 1,
      lineText: text.slice(lineStart, lineEnd),
    });
    if (matches.length >= MAX_MATCHES) break;
  }
  return matches;
}

/** Count of matches without materializing them. */
export function countMatches(text: string, query: string, opts: SearchOptions): number {
  const re = buildPattern(query, opts);
  if (!re) return 0;
  const found = text.match(re);
  return found ? found.length : 0;
}

/**
 * Replace every match in `text`. With `useRegex`, `$1`/`$&` group references in
 * the replacement are honored; otherwise the replacement is inserted literally
 * (so a literal `$` is safe). Returns the new text and the number of replacements.
 */
export function replaceAllInText(
  text: string,
  query: string,
  replacement: string,
  opts: SearchOptions,
): { text: string; count: number } {
  const re = buildPattern(query, opts);
  if (!re) return { text, count: 0 };
  let count = 0;
  const safeReplacement = opts.useRegex ? replacement : replacement.replace(/\$/g, "$$$$");
  const next = text.replace(re, (matched: string, ...rest: unknown[]) => {
    if (matched === "") return matched;
    count += 1;
    // `String.prototype.replace` interprets `$n` in a string replacement, so for
    // regex mode we let it; we still need a callback to count, so re-expand here.
    if (!opts.useRegex) return safeReplacement;
    return expandGroups(replacement, matched, rest);
  });
  return { text: next, count };
}

/**
 * Replace a single match located at absolute offset `start`. Used by per-result
 * "Replace". Honors regex group references when `useRegex` is on.
 */
export function replaceMatchAt(
  text: string,
  start: number,
  query: string,
  replacement: string,
  opts: SearchOptions,
): string | null {
  const re = buildPattern(query, opts);
  if (!re) return null;
  re.lastIndex = start;
  const m = re.exec(text);
  if (!m || m.index !== start) return null;
  const value = opts.useRegex
    ? expandGroups(replacement, m[0], m.slice(1))
    : replacement;
  return text.slice(0, start) + value + text.slice(start + m[0].length);
}

/** Expand `$1`..`$9`, `$&`, `$$` in a regex replacement string. */
function expandGroups(replacement: string, matched: string, groups: unknown[]): string {
  return replacement.replace(/\$(\$|&|\d{1,2})/g, (_token, ref: string) => {
    if (ref === "$") return "$";
    if (ref === "&") return matched;
    const idx = Number(ref) - 1;
    const group = groups[idx];
    return typeof group === "string" ? group : "";
  });
}
