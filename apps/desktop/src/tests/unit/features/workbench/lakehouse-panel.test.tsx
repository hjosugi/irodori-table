import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/features/preferences";
import {
  isLakehouseEngine,
  LakehousePanel,
} from "@/features/workbench/components/LakehousePanel";
import { componentRenderer } from "@/tests/helpers/render";

const renderPanel = componentRenderer(
  LakehousePanel,
  () =>
    ({
      editorEngine: "mysql",
      activeConnectionName: "Local Postgres",
      activeConnectionOpen: false,
      activeMetadata: undefined,
      onInsertSql: vi.fn(),
      onLoadSql: vi.fn(),
      onClose: vi.fn(),
    }) satisfies Parameters<typeof LakehousePanel>[0],
);

beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
});

describe("LakehousePanel", () => {
  it("detects lakehouse contract engines", () => {
    expect(isLakehouseEngine("duckdb")).toBe(true);
    expect(isLakehouseEngine("motherduck")).toBe(true);
    expect(isLakehouseEngine("hive")).toBe(true);
    expect(isLakehouseEngine("athena")).toBe(true);
    expect(isLakehouseEngine("iceberg")).toBe(true);
    expect(isLakehouseEngine("s3Tables")).toBe(true);
    expect(isLakehouseEngine("deltaLake")).toBe(true);
    expect(isLakehouseEngine("hudi")).toBe(true);
    expect(isLakehouseEngine("databricks")).toBe(true);
    expect(isLakehouseEngine("mysql")).toBe(false);
  });

  it("renders action titles and details as separate readable blocks", () => {
    const { container } = renderPanel();

    // Title and detail must stay distinct elements: run together they read as
    // one sentence.
    const action = container.querySelector<HTMLElement>(".lakehouse-action");
    expect(action).not.toBeNull();
    expect(
      within(action as HTMLElement).getByText("DuckDB Iceberg"),
    ).toBeVisible();
    expect(action?.querySelector("span")?.textContent).toContain(
      "S3/R2/GCS object storage",
    );
  });

  it("opens an action context menu on right click", async () => {
    const { props, user, container } = renderPanel();
    const action = container.querySelector<HTMLElement>(".lakehouse-action");
    expect(action).not.toBeNull();

    // The handler must call preventDefault, or the OS menu opens on top.
    expect(
      fireEvent.contextMenu(action as HTMLElement, {
        clientX: 48,
        clientY: 64,
      }),
    ).toBe(false);

    const menu = screen.getByRole("menu");
    expect(menu).toBeVisible();
    const load = within(menu).getByRole("menuitem", {
      name: "Load DuckDB Iceberg SQL",
    });
    expect(load).toBeVisible();

    await user.click(load);

    expect(props.onLoadSql).toHaveBeenCalledTimes(1);
  });
});
