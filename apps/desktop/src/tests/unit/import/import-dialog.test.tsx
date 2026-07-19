import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SetStateAction } from "react";
import {
  ImportDialog,
  type ImportPreview,
} from "@/features/import/ImportDialog";
import { usePreferencesStore } from "@/features/preferences";
import { componentRenderer } from "@/tests/helpers/render";

function preview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    columns: ["id", "name"],
    rows: [
      [1, "Ada"],
      [2, "Grace"],
    ],
    totalRows: 2,
    truncated: false,
    fileName: "people.csv",
    format: "csv",
    tableName: "people",
    mode: "create",
    ...overrides,
  };
}

const renderDialog = componentRenderer(ImportDialog, () => ({
  preview: preview(),
  sqlPreview: "CREATE TABLE ...",
  onPreviewChange: vi.fn(),
  onClose: vi.fn(),
  onPutSqlInEditor: vi.fn(),
  formatCell: (value: unknown) => String(value),
  formatCount: (value: bigint | number) => String(value),
}));

function applyUpdater(
  updater: SetStateAction<ImportPreview | null>,
  current: ImportPreview,
): ImportPreview | null {
  return typeof updater === "function" ? updater(current) : updater;
}

beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
});

describe("ImportDialog append mode (#164)", () => {
  // Pre-fix the dialog had no mode control at all: generateImportSql's tested
  // insert-only path (includeCreate = false) was unreachable from the UI.
  it("offers a create/append mode choice defaulting to create", () => {
    renderDialog();

    const group = screen.getByRole("radiogroup", { name: "Import mode" });
    expect(group).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Create new table" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Append to existing table" }),
    ).not.toBeChecked();
  });

  it("propagates the append choice into the preview state", async () => {
    const { user, props } = renderDialog();

    await user.click(
      screen.getByRole("radio", { name: "Append to existing table" }),
    );

    const updater = vi.mocked(props.onPreviewChange).mock.lastCall?.[0];
    expect(updater).toBeDefined();
    expect(applyUpdater(updater!, preview())).toMatchObject({
      mode: "append",
    });
    // The updater keeps a dismissed dialog dismissed.
    expect(applyUpdater(updater!, null as never)).toBeNull();
  });

  it("explains append mode next to the toggle", () => {
    renderDialog({ preview: preview({ mode: "append" }) });

    expect(
      screen.getByRole("radio", { name: "Append to existing table" }),
    ).toBeChecked();
    expect(
      screen.getByText(
        "Only INSERT statements are generated; the table must already exist.",
      ),
    ).toBeInTheDocument();
  });

  it("localizes the mode strings", () => {
    usePreferencesStore.setState({ locale: "ja" });
    renderDialog({ preview: preview({ mode: "append" }) });

    expect(
      screen.getByRole("radiogroup", { name: "インポートモード" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "新しいテーブルを作成" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "既存のテーブルに追記" }),
    ).toBeChecked();
  });
});
