import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import {
  SchemaDiagramDialog,
  diagramFromMetadata,
  useSchemaDiagramStore,
} from "@/features/schema-diagram";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function table(
  schema: string,
  name: string,
  columns: Array<[string, string]>,
  foreignKeys: DbObjectMetadata["foreignKeys"] = [],
): DbObjectMetadata {
  return {
    schema,
    name,
    kind: "table",
    columns: columns.map(([column, dataType], index) => ({
      name: column,
      dataType,
      nullable: column !== "id",
      ordinal: index + 1,
    })),
    indexes: [],
    primaryKey: ["id"],
    foreignKeys,
  };
}

const metadata: DatabaseMetadata = {
  schemas: [
    {
      name: "sales",
      objects: [
        table("sales", "customers", [
          ["id", "INTEGER"],
          ["name", "TEXT"],
        ]),
        table(
          "sales",
          "orders",
          [
            ["id", "INTEGER"],
            ["customer_id", "INTEGER"],
          ],
          [
            {
              columns: ["customer_id"],
              referencesSchema: "sales",
              referencesTable: "customers",
              referencesColumns: ["id"],
            },
          ],
        ),
      ],
    },
  ],
};

function tableNames(host: HTMLElement): string[] {
  return Array.from(
    host.querySelectorAll<HTMLInputElement>('input[aria-label="Table name"]'),
  ).map((input) => input.value);
}

describe("SchemaDiagramDialog interactions", () => {
  it("renders the seeded diagram, adds tables, and emits CREATE SQL", () => {
    useSchemaDiagramStore.setState({
      open: true,
      document: diagramFromMetadata(metadata),
      selectedTableId: null,
    });
    const onPutSqlInEditor = vi.fn();

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        createElement(SchemaDiagramDialog, {
          onClose: () => {},
          onPutSqlInEditor,
          onCopySql: () => {},
          onSeedFromDb: () => {},
          canSeedFromDb: true,
        }),
      );
    });

    expect(tableNames(host)).toEqual(
      expect.arrayContaining(["customers", "orders"]),
    );

    const addButton = host.querySelector<HTMLButtonElement>(
      'button[title="Add a new table"]',
    );
    act(() => addButton?.click());
    expect(tableNames(host)).toHaveLength(3);

    const createButton = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Create DB SQL");
    act(() => createButton?.click());

    expect(onPutSqlInEditor).toHaveBeenCalledTimes(1);
    expect(onPutSqlInEditor.mock.calls[0][0]).toContain("CREATE TABLE");

    act(() => root.unmount());
    host.remove();
  });
});
