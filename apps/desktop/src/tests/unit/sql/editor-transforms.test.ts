import { describe, expect, it } from "vitest";
import { transformSqlEditorText } from "@/sql/editor-transforms";

describe("SQL editor transforms", () => {
  it("changes selection case", () => {
    expect(transformSqlEditorText("select Name", "uppercase")).toBe("SELECT NAME");
    expect(transformSqlEditorText("SELECT Name", "lowercase")).toBe("select name");
  });

  it("appends commas to non-empty lines once", () => {
    expect(
      transformSqlEditorText("id\nname,\n\ncreated_at  ", "appendCommas"),
    ).toBe("id,\nname,\n\ncreated_at,  ");
  });

  it("replaces double quotes with SQL single quotes", () => {
    expect(transformSqlEditorText('"public"."customers"', "doubleToSingleQuotes")).toBe(
      "'public'.'customers'",
    );
  });
});
