import { describe, expect, it } from "vitest";
import {
  countMatches,
  findMatches,
  isValidQuery,
  replaceAllInText,
  replaceMatchAt,
  type SearchOptions,
} from "@/sql/text-search";

const base: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
};

describe("findMatches", () => {
  it("finds case-insensitive matches by default with line/column", () => {
    const text = "select Id\nfrom Orders";
    const matches = findMatches(text, "id", base);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ line: 1, column: 8 });
    expect(matches[0].lineText).toBe("select Id");
  });

  it("respects case sensitivity", () => {
    const text = "Id id ID";
    expect(findMatches(text, "id", base)).toHaveLength(3);
    expect(
      findMatches(text, "id", { ...base, caseSensitive: true }),
    ).toHaveLength(1);
  });

  it("respects whole-word boundaries", () => {
    const text = "order orders reorder";
    expect(
      findMatches(text, "order", { ...base, wholeWord: true }),
    ).toHaveLength(1);
    expect(findMatches(text, "order", base)).toHaveLength(3);
  });

  it("supports regular expressions", () => {
    const text = "a1 b2 c3";
    const matches = findMatches(text, "[a-z]\\d", { ...base, useRegex: true });
    expect(matches.map((m) => m.start)).toEqual([0, 3, 6]);
  });

  it("does not loop forever on a zero-width regex", () => {
    const matches = findMatches("abc", "x*", { ...base, useRegex: true });
    expect(matches).toEqual([]);
  });
});

describe("countMatches", () => {
  it("counts without materializing", () => {
    expect(countMatches("a a a", "a", base)).toBe(3);
  });
});

describe("replaceAllInText", () => {
  it("replaces all literal matches and reports the count", () => {
    const { text, count } = replaceAllInText("foo foo", "foo", "bar", base);
    expect(text).toBe("bar bar");
    expect(count).toBe(2);
  });

  it("treats a literal $ in the replacement literally", () => {
    const { text } = replaceAllInText("price", "price", "$amount", base);
    expect(text).toBe("$amount");
  });

  it("honors regex group references when useRegex is on", () => {
    const opts = { ...base, useRegex: true };
    const { text, count } = replaceAllInText(
      "2024-01",
      "(\\d+)-(\\d+)",
      "$2/$1",
      opts,
    );
    expect(text).toBe("01/2024");
    expect(count).toBe(1);
  });
});

describe("replaceMatchAt", () => {
  it("replaces only the match at the given offset", () => {
    const text = "foo foo";
    const next = replaceMatchAt(text, 4, "foo", "bar", base);
    expect(next).toBe("foo bar");
  });

  it("returns null when no match starts at the offset", () => {
    expect(replaceMatchAt("foo", 1, "foo", "bar", base)).toBeNull();
  });
});

describe("isValidQuery", () => {
  it("rejects invalid regex", () => {
    expect(isValidQuery("(", { ...base, useRegex: true })).toBe(false);
    expect(isValidQuery("(", base)).toBe(true); // literal paren is fine
  });
});
