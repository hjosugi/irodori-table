import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SnippetsTab } from "@/features/settings/tabs/SnippetsTab";
import { createTranslator } from "@/i18n";
import { componentRenderer } from "@/tests/helpers/render";
import type { SqlSnippetDefinition } from "@/sql/completion";

const { t } = createTranslator("en");

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

// Every card holds one <textarea> for the template, so an open editor is
// exactly a template field on screen. Collapsed cards render none.
function openEditorCount() {
  return screen.queryAllByLabelText("Template").length;
}

const renderTab = componentRenderer(
  SnippetsTab,
  () =>
    ({
      t,
      sqlSnippets: [
        snippet({ label: "sel", detail: "select rows", tags: ["dml"] }),
        snippet({
          label: "crt",
          detail: "create table",
          template: "create table ${1:t} (${0});",
          tags: ["ddl"],
        }),
        snippet({
          label: "idx",
          detail: "create index",
          template: "create index ${1:i} on ${2:t};",
          tags: ["ddl"],
        }),
      ],
      setSqlSnippets: vi.fn(),
    }) satisfies Parameters<typeof SnippetsTab>[0],
);

describe("SnippetsTab discoverability", () => {
  it("renders every snippet collapsed, not as a wall of open editors", () => {
    renderTab();
    // Three snippets, three summary rows, zero open template editors.
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(3);
    expect(openEditorCount()).toBe(0);
  });

  it("expands a card on click to reveal its editor", async () => {
    const { user } = renderTab();
    expect(openEditorCount()).toBe(0);
    await user.click(screen.getByRole("button", { name: /crt/ }));
    expect(openEditorCount()).toBe(1);
  });

  it("filters the list as you type in the search box", async () => {
    const { user } = renderTab();
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(3);

    await user.type(screen.getByLabelText("Search snippets"), "index");

    const rows = screen.getAllByRole("button", { expanded: false });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("idx");
  });

  it("filters by tag, matching any selected tag", async () => {
    const { user } = renderTab();
    await user.click(
      screen.getByRole("button", { name: "ddl", pressed: false }),
    );

    const rows = screen.getAllByRole("button", { expanded: false });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("crt"),
      expect.stringContaining("idx"),
    ]);
  });

  it("shows a no-match empty state instead of a blank list", async () => {
    const { user } = renderTab();
    await user.type(screen.getByLabelText("Search snippets"), "zzz-nothing");
    expect(screen.getByText("No snippets match your search")).toBeVisible();
    expect(openEditorCount()).toBe(0);
  });
});
