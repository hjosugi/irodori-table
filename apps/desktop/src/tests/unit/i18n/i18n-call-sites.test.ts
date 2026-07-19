import { describe, expect, it } from "vitest";
import { dictionaries, type SupportedLocale } from "@/i18n";

/**
 * `interpolate` leaves a placeholder it was given no value for untouched, so a
 * caller that forgets one ships a literal `{count}` to the user instead of
 * throwing. That fallback is deliberate and load-bearing (see
 * PLACEHOLDER_SYNTAX_KEYS below), which is why it is not a runtime error — but
 * it means a forgotten value is invisible until someone looks at the screen.
 *
 * These tests move that check to build time: every `t(...)`/`translate(...)`
 * call site is matched against the placeholders its key actually declares.
 */

/**
 * Source text for every module under src/, via Vite's raw glob rather than
 * node:fs — the app is browser-targeted and has no @types/node, and pulling
 * Node globals into its type space to read files would be a poor trade.
 */
const sources: Record<string, string> = import.meta.glob(
  "../../../**/*.{ts,tsx}",
  { query: "?raw", import: "default", eager: true },
);

/** `../../../features/x.ts` reads better as `src/features/x.ts` in a failure. */
function displayPath(path: string): string {
  return path.replace(/^(?:\.\.\/)+/, "src/");
}

/** `tests` names keys without rendering them; `generated` is machine-written. */
function isScanned(path: string): boolean {
  const normalized = displayPath(path);
  return (
    !normalized.startsWith("src/tests/") &&
    !normalized.startsWith("src/generated/")
  );
}

/**
 * Keys whose braces are not interpolation placeholders. `interpolate` still
 * matches them, and leaving them alone is exactly the behaviour these strings
 * need — a CodeMirror snippet template has to reach the user with its `${0}`
 * tab stops intact.
 */
const PLACEHOLDER_SYNTAX_KEYS = new Set([
  "settings.snippets.importPlaceholder",
]);

const PLACEHOLDER_PATTERN = /\{\s*([A-Za-z0-9_.-]+)\s*\}/g;

function placeholdersIn(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]);
}

function placeholdersByKey(locale: SupportedLocale): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [key, template] of Object.entries(dictionaries[locale])) {
    const names = [...new Set(placeholdersIn(template))];
    if (names.length > 0) {
      result.set(key, names);
    }
  }
  return result;
}

interface CallSite {
  key: string;
  args: string;
  file: string;
  line: number;
}

/** Find `t("key", …)` / `translate("key", …)` and capture the rest of the call. */
function callSites(text: string, file: string): CallSite[] {
  const found: CallSite[] = [];
  const opener = /\b(?:t|translate)\(\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text))) {
    let depth = 1;
    let index = opener.lastIndex;
    let quote: string | null = null;
    while (index < text.length && depth > 0) {
      const char = text[index];
      if (quote) {
        if (char === "\\") {
          index += 1;
        } else if (char === quote) {
          quote = null;
        }
      } else if (char === '"' || char === "'" || char === "`") {
        quote = char;
      } else if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
      }
      index += 1;
    }
    found.push({
      key: match[1],
      args: text.slice(opener.lastIndex, index - 1),
      file,
      line: text.slice(0, match.index).split("\n").length,
    });
  }
  return found;
}

/**
 * Property names the call supplies, covering both `{ count: n }` and the
 * `{ count }` shorthand. Nested literals count too, so `translate(key, {
 * values: { count } })` resolves.
 */
function suppliedNames(args: string): Set<string> {
  return new Set([
    ...[...args.matchAll(/([A-Za-z0-9_$]+)\s*:/g)].map((match) => match[1]),
    ...[...args.matchAll(/[{,]\s*([A-Za-z0-9_$]+)\s*(?=[,}])/g)].map(
      (match) => match[1],
    ),
  ]);
}

/**
 * Calls that hand over a values object built elsewhere cannot be checked from
 * the source text, so they are skipped rather than guessed at.
 */
function isDynamic(args: string): boolean {
  return /\.\.\./.test(args) || /\bvalues\s*:\s*[^{\s]/.test(args);
}

describe("i18n call sites", () => {
  it("passes every placeholder the translation key declares", () => {
    const required = placeholdersByKey("en");
    const violations: string[] = [];

    for (const [path, text] of Object.entries(sources)) {
      if (!isScanned(path)) {
        continue;
      }
      for (const call of callSites(text, displayPath(path))) {
        const needed = required.get(call.key);
        if (!needed || PLACEHOLDER_SYNTAX_KEYS.has(call.key)) {
          continue;
        }
        if (isDynamic(call.args)) {
          continue;
        }
        const supplied = suppliedNames(call.args);
        const missing = needed.filter((name) => !supplied.has(name));
        if (missing.length > 0) {
          violations.push(
            `${call.file}:${call.line} — ` +
              `"${call.key}" renders {${missing.join("}, {")}} literally`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // A placeholder that exists only in one locale leaks raw braces to the users
  // of that locale, and no call site can be blamed for it.
  it("declares the same placeholders in every locale", () => {
    const mismatches: string[] = [];

    for (const [key, template] of Object.entries(dictionaries.en)) {
      const english = [...new Set(placeholdersIn(template))].sort();
      for (const locale of ["ja"] as const) {
        const translated = dictionaries[locale][key as never];
        if (typeof translated !== "string") {
          continue;
        }
        const other = [...new Set(placeholdersIn(translated))].sort();
        const extra = other.filter((name) => !english.includes(name));
        if (extra.length > 0) {
          mismatches.push(
            `${locale} "${key}" uses {${extra.join("}, {")}}, absent from en`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
