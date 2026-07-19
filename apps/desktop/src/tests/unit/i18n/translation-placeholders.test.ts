import { describe, expect, it } from "vitest";
import { interpolate } from "@/i18n";
import { en } from "@/i18n/locales/en";
import { ja } from "@/i18n/locales/ja";

/**
 * Guards the failure mode where a `t()` call and its template disagree about
 * interpolation values. Neither side errors at runtime, so both directions ship
 * silently:
 *
 * - value omitted -> `interpolate` leaves the placeholder alone and a literal
 *   `{count}` reaches the UI (screen readers read it out verbatim);
 * - value passed with no matching slot -> the value is dropped and the number
 *   the caller meant to show never appears.
 *
 * TypeScript checks the *key* but not the values bag, so this has to be a test.
 * The scan is textual: `tsgo` (TypeScript 7) does not expose the JS AST API, so
 * there is no parser to borrow here.
 */

/**
 * Every shipped module, as raw text. Vite resolves the glob at build time, so
 * the scan needs no filesystem access and stays correct wherever vitest runs
 * from. `tests` holds this file's own fixtures and `generated` is
 * machine-written, so both are excluded.
 */
const sources = import.meta.glob<string>(
  [
    "../../../**/*.ts",
    "../../../**/*.tsx",
    "!../../../tests/**",
    "!../../../generated/**",
  ],
  { query: "?raw", import: "default", eager: true },
);

/**
 * Mirrors the placeholder pattern in `interpolate` (src/i18n/index.ts). A
 * `$`-prefixed `${n}` is a snippet tabstop inside sample text, not a
 * translation placeholder, so it is deliberately not required of callers.
 * "en templates agree with interpolate" below pins this to the real
 * implementation.
 */
const PLACEHOLDER = /(\$?)\{\s*([A-Za-z0-9_.-]+)\s*\}/g;

function placeholdersOf(template: string): Set<string> {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (!match[1]) {
      found.add(match[2]);
    }
  }
  return found;
}

/** Skips a quoted string starting at `start`, returning the index of its close quote. */
function skipString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && text[i] === "$" && text[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < text.length && depth > 0) {
        if (text[i] === "{") depth++;
        else if (text[i] === "}") depth--;
        i++;
      }
      continue;
    }
    if (text[i] === quote) {
      return i;
    }
    i++;
  }
  return i;
}

type ObjectLiteral = {
  /** Top-level property names. */
  keys: Set<string>;
  /** A spread makes the property set unknowable, so the call is skipped. */
  dynamic: boolean;
};

/** Reads the top-level property names of the object literal opening at `start`. */
function parseObjectLiteral(text: string, start: number): ObjectLiteral {
  const keys = new Set<string>();
  let dynamic = false;
  let depth = 1;
  let expectKey = true;
  let i = start + 1;

  while (i < text.length && depth > 0) {
    const char = text[i];

    if (char === '"' || char === "'" || char === "`") {
      const close = skipString(text, i);
      if (depth === 1 && expectKey) {
        const name = text.slice(i + 1, close);
        let j = close + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] === ":") {
          keys.add(name);
          expectKey = false;
        }
      }
      i = close + 1;
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (char === "{" || char === "(" || char === "[") {
      depth++;
      i++;
      continue;
    }
    if (char === "}" || char === ")" || char === "]") {
      depth--;
      i++;
      continue;
    }
    if (depth === 1 && char === ",") {
      expectKey = true;
      i++;
      continue;
    }
    if (depth === 1 && text.startsWith("...", i)) {
      dynamic = true;
      i += 3;
      continue;
    }
    if (depth === 1 && expectKey && /[A-Za-z_$]/.test(char)) {
      const nameStart = i;
      while (i < text.length && /[A-Za-z0-9_$]/.test(text[i])) i++;
      const name = text.slice(nameStart, i);
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      // `name:` (pair) or `name,` / `name}` (shorthand)
      if (text[j] === ":" || text[j] === "," || text[j] === "}") {
        keys.add(name);
        expectKey = false;
      }
      continue;
    }
    i++;
  }

  return { keys, dynamic };
}

/** Index of the value of top-level property `wanted`, or -1. */
function propertyValueStart(
  text: string,
  objectStart: number,
  wanted: string,
): number {
  let depth = 1;
  let expectKey = true;
  let i = objectStart + 1;

  while (i < text.length && depth > 0) {
    const char = text[i];
    if (char === '"' || char === "'" || char === "`") {
      i = skipString(text, i) + 1;
      continue;
    }
    if (char === "{" || char === "(" || char === "[") {
      depth++;
      i++;
      continue;
    }
    if (char === "}" || char === ")" || char === "]") {
      depth--;
      i++;
      continue;
    }
    if (depth === 1 && char === ",") {
      expectKey = true;
      i++;
      continue;
    }
    if (depth === 1 && expectKey && /[A-Za-z_$]/.test(char)) {
      const nameStart = i;
      while (i < text.length && /[A-Za-z0-9_$]/.test(text[i])) i++;
      const name = text.slice(nameStart, i);
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (name === wanted && text[j] === ":") {
        let value = j + 1;
        while (value < text.length && /\s/.test(text[value])) value++;
        return value;
      }
      expectKey = false;
      continue;
    }
    i++;
  }
  return -1;
}

type Violation = {
  where: string;
  key: string;
  template: string;
  missing: string[];
  extra: string[];
};

/** Matches `t("key"` / `translate("key"`, including `translator.t("key"`. */
const TRANSLATOR_CALL = /\b(t|translate)\s*\(\s*(["'])((?:[^"'\\]|\\.)*?)\2/g;

const templates = en as Record<string, string | undefined>;

function analyzeSource(text: string, where: string): Violation[] {
  const violations: Violation[] = [];

  for (const match of text.matchAll(TRANSLATOR_CALL)) {
    const key = match[3];
    const template = templates[key];
    // Not a translation key (some other one-letter `t`), or a key built at
    // runtime -- nothing statically checkable either way.
    if (template === undefined) {
      continue;
    }

    let i = match.index + match[0].length;
    while (i < text.length && /\s/.test(text[i])) i++;

    let passed = new Set<string>();
    let dynamic = false;

    if (text[i] === ",") {
      i++;
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] === "{") {
        if (match[1] === "translate") {
          // translate(key, { locale, values: { ... } })
          const valuesStart = propertyValueStart(text, i, "values");
          if (valuesStart !== -1) {
            if (text[valuesStart] === "{") {
              const parsed = parseObjectLiteral(text, valuesStart);
              passed = parsed.keys;
              dynamic = parsed.dynamic;
            } else {
              dynamic = true;
            }
          }
        } else {
          const parsed = parseObjectLiteral(text, i);
          passed = parsed.keys;
          dynamic = parsed.dynamic;
        }
      } else if (text[i] !== ")") {
        // a variable or call expression -- contents unknowable
        dynamic = true;
      }
    }

    if (dynamic) {
      continue;
    }

    const required = placeholdersOf(template);
    const missing = [...required].filter((name) => !passed.has(name));
    const extra = [...passed].filter((name) => !required.has(name));

    if (missing.length > 0 || extra.length > 0) {
      const line = text.slice(0, match.index).split("\n").length;
      violations.push({
        where: `${where}:${line}`,
        key,
        template,
        missing,
        extra,
      });
    }
  }

  return violations;
}

function describeViolation(violation: Violation): string {
  const problems: string[] = [];
  if (violation.missing.length > 0) {
    problems.push(
      `no value for {${violation.missing.join("}, {")}} (renders raw)`,
    );
  }
  if (violation.extra.length > 0) {
    problems.push(
      `template has no slot for ${violation.extra.join(", ")} (value dropped)`,
    );
  }
  return `${violation.where} t("${violation.key}") -> ${problems.join("; ")} -- template: ${JSON.stringify(violation.template)}`;
}

describe("translation placeholders", () => {
  it("passes exactly the values each template interpolates", () => {
    const files = Object.entries(sources);
    // Fail loudly rather than silently scanning nothing if the glob breaks.
    expect(files.length).toBeGreaterThan(100);

    const violations = files.flatMap(([path, text]) =>
      analyzeSource(text, path.replace("../../../", "")),
    );

    expect(violations.map(describeViolation)).toEqual([]);
  });

  it("declares the same placeholders in en and ja", () => {
    const drift: string[] = [];
    for (const [key, template] of Object.entries(en)) {
      const translated = (ja as Record<string, string>)[key];
      const source = [...placeholdersOf(template)].sort().join(", ");
      const target = [...placeholdersOf(translated)].sort().join(", ");
      if (source !== target) {
        drift.push(`${key}: en has {${source}}, ja has {${target}}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it("detects placeholder regex drift against interpolate", () => {
    const leftovers: string[] = [];
    for (const [key, template] of Object.entries(en)) {
      const values = Object.fromEntries(
        [...placeholdersOf(template)].map((name) => [name, ""]),
      );
      // Anything interpolate still recognises after we satisfied every
      // placeholder we found means the two patterns have diverged. `${n}`
      // snippet tabstops are the one intended survivor.
      for (const match of interpolate(template, values).matchAll(PLACEHOLDER)) {
        if (!match[1]) {
          leftovers.push(`${key}: ${match[0]}`);
        }
      }
    }
    expect(leftovers).toEqual([]);
  });

  it("reports a value the template cannot render", () => {
    const violations = analyzeSource(
      'const label = t("common.save", { name: "x" });',
      "fixture.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.extra).toEqual(["name"]);
    expect(violations[0]?.missing).toEqual([]);
  });

  it("reports a placeholder left without a value", () => {
    const violations = analyzeSource(
      'const label = t("history.entries");',
      "fixture.ts",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.missing).toEqual(["count"]);
    expect(violations[0]?.extra).toEqual([]);
  });

  it("accepts a matching call and skips unknowable ones", () => {
    expect(
      analyzeSource('t("history.entries", { count: 3 });', "fixture.ts"),
    ).toEqual([]);
    // spread and non-literal bags cannot be resolved statically
    expect(
      analyzeSource('t("history.entries", { ...counts });', "fixture.ts"),
    ).toEqual([]);
    expect(analyzeSource('t("history.entries", bag);', "fixture.ts")).toEqual(
      [],
    );
    expect(
      analyzeSource(
        'translate("history.entries", { locale, values: { count: 1 } });',
        "fixture.ts",
      ),
    ).toEqual([]);
  });
});
