import { describe, expect, it } from "vitest";
import {
  collectSqlSnippetTags,
  formatSnippetTagInput,
  normalizeSnippetTags,
  parseSnippetTagInput,
  snippetMatchesFilter,
  snippetMatchesSearch,
  snippetMatchesTags,
  sqlSnippetsFromJson,
  sqlSnippetsFromText,
  SQL_SNIPPETS_SCHEMA_VERSION,
  type SqlSnippetDefinition,
} from "@/sql/completion";

function snippet(
  patch: Partial<SqlSnippetDefinition> = {},
): SqlSnippetDefinition {
  return {
    label: "sel",
    detail: "select statement",
    template: "select ${1:*} from ${2:table};${0}",
    scope: "statement",
    ...patch,
  };
}

describe("snippet tag parsing", () => {
  it("lower-cases, trims, de-duplicates, and drops blank tags", () => {
    expect(parseSnippetTagInput(" DDL , ddl ,, Reporting ")).toEqual([
      "ddl",
      "reporting",
    ]);
  });

  it("round-trips through the comma-separated field format", () => {
    expect(formatSnippetTagInput(["ddl", "reporting"])).toBe("ddl, reporting");
    expect(formatSnippetTagInput(undefined)).toBe("");
  });

  it("caps a single tag at the maximum length", () => {
    const long = "a".repeat(80);
    expect(normalizeSnippetTags([long])[0]).toHaveLength(32);
  });

  it("collects every tag in use, sorted, for the filter", () => {
    const tags = collectSqlSnippetTags([
      snippet({ label: "a", tags: ["reporting", "ddl"] }),
      snippet({ label: "b", tags: ["dml"] }),
      snippet({ label: "c" }),
    ]);
    expect(tags).toEqual(["ddl", "dml", "reporting"]);
  });
});

describe("snippet filtering", () => {
  it("searches across trigger, detail, template, and tags", () => {
    const s = snippet({
      label: "grp",
      detail: "group by helper",
      template: "group by ${1:col};${0}",
      tags: ["aggregation"],
    });
    expect(snippetMatchesSearch(s, "grp")).toBe(true); // trigger
    expect(snippetMatchesSearch(s, "helper")).toBe(true); // detail
    expect(snippetMatchesSearch(s, "group by")).toBe(true); // template
    expect(snippetMatchesSearch(s, "aggreg")).toBe(true); // tag
    expect(snippetMatchesSearch(s, "delete")).toBe(false);
    // An empty query matches everything.
    expect(snippetMatchesSearch(s, "  ")).toBe(true);
  });

  it("matches any selected tag rather than requiring all of them", () => {
    const s = snippet({ tags: ["ddl"] });
    expect(snippetMatchesTags(s, [])).toBe(true);
    expect(snippetMatchesTags(s, ["ddl", "dml"])).toBe(true);
    expect(snippetMatchesTags(s, ["dml"])).toBe(false);
  });

  it("combines search and tag filters", () => {
    const s = snippet({ detail: "reporting rollup", tags: ["reporting"] });
    expect(snippetMatchesFilter(s, "rollup", ["reporting"])).toBe(true);
    expect(snippetMatchesFilter(s, "rollup", ["ddl"])).toBe(false);
    expect(snippetMatchesFilter(s, "missing", ["reporting"])).toBe(false);
  });
});

describe("snippet tags stay on schemaVersion 1", () => {
  it("keeps loading tagless snippets saved before tags existed", () => {
    // The exact shape a pre-tags snippet has in localStorage: no `tags` key.
    const parsed = sqlSnippetsFromJson([
      {
        label: "sel",
        detail: "select",
        template: "select ${1:*};${0}",
        scope: "statement",
      },
    ]);
    expect(parsed[0]?.tags).toBeUndefined();
  });

  it("parses tags when present without bumping the schema version", () => {
    const parsed = sqlSnippetsFromJson([
      {
        label: "sel",
        detail: "select",
        template: "select ${1:*};${0}",
        scope: "statement",
        tags: ["DDL", "reporting"],
      },
    ]);
    expect(parsed[0]?.tags).toEqual(["ddl", "reporting"]);
  });

  it("imports tags from a schemaVersion 1 document", async () => {
    const imported = await sqlSnippetsFromText(
      JSON.stringify({
        schemaVersion: SQL_SNIPPETS_SCHEMA_VERSION,
        snippets: [
          {
            label: "ops",
            detail: "ops",
            template: "select ${1:*};${0}",
            scope: "statement",
            tags: ["ops", "ops"],
          },
        ],
      }),
      "snippets.json",
    );
    expect(imported.schemaVersion).toBe(SQL_SNIPPETS_SCHEMA_VERSION);
    expect(imported.snippets[0]?.tags).toEqual(["ops"]);
  });

  it("rejects a non-string tag list", () => {
    expect(() =>
      sqlSnippetsFromJson([
        {
          label: "sel",
          detail: "select",
          template: "select ${1:*};${0}",
          scope: "statement",
          tags: [1, 2],
        },
      ]),
    ).toThrow("tags must contain strings");
  });
});
