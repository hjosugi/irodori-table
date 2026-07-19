// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { SchemaDesignerDialog } from "@/features/schema-designer";
import type { SchemaDesignerDraft } from "@/features/schema-designer/schema-designer";
import { renderUi } from "../../helpers/render";

// In Alter mode the generated ALTER TABLE ... ADD COLUMN never includes a
// PRIMARY KEY constraint, but the PK checkbox stayed enabled for new columns
// and silently ignored the tick (#120). The checkbox is now disabled in Alter
// mode with an explanatory tooltip so the UI matches what the SQL does.

function draft(mode: SchemaDesignerDraft["mode"]): SchemaDesignerDraft {
  return {
    mode,
    schema: "public",
    table: "orders",
    columns: [
      {
        id: "existing",
        name: "id",
        dataType: "INTEGER",
        nullable: false,
        primaryKey: true,
        defaultValue: "",
        existing: true,
      },
      {
        id: "fresh",
        name: "note",
        dataType: "TEXT",
        nullable: true,
        primaryKey: false,
        defaultValue: "",
      },
    ],
    indexes: [],
    foreignKeys: [],
  };
}

function renderDialog(mode: SchemaDesignerDraft["mode"]) {
  renderUi(
    <SchemaDesignerDialog
      draft={draft(mode)}
      sqlPreview=""
      onDraftChange={vi.fn()}
      onClose={vi.fn()}
      onCopySql={vi.fn()}
      onPutSqlInEditor={vi.fn()}
    />,
  );
  return screen.getAllByText("PK").map((span) => {
    const label = span.closest("label");
    const checkbox = label?.querySelector("input");
    if (!label || !checkbox) {
      throw new Error("PK checkbox not found");
    }
    return { label, checkbox };
  });
}

describe("SchemaDesignerDialog primary-key checkbox", () => {
  it("disables the PK checkbox for every column in alter mode and says why", () => {
    const cells = renderDialog("alter");

    expect(cells).toHaveLength(2);
    for (const { label, checkbox } of cells) {
      expect(checkbox.disabled).toBe(true);
      expect(label.title).toContain("Alter mode");
    }
  });

  it("keeps the PK checkbox editable in create mode", () => {
    const cells = renderDialog("create");

    expect(cells).toHaveLength(2);
    for (const { label, checkbox } of cells) {
      expect(checkbox.disabled).toBe(false);
      expect(label.title).toBe("");
    }
  });
});
