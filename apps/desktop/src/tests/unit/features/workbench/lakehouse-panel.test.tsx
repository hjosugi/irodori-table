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

// Right-clicking the panel opens its context menu. Rendered inline it sat
// inside dockview's transformed subtree, which becomes the containing block
// for position:fixed — so the clamp ran in viewport space and the dock offset
// was applied after it, landing the menu at x=2654 on a 1600px window (#124).
// jsdom does no layout, so the guard asserts the two properties that made the
// bug possible: where the node lives and what its declared position is.
describe("LakehousePanel context menu", () => {
  it("portals the menu to <body>, position fixed, clamped to the viewport", () => {
    const { container } = renderPanel();

    fireEvent.contextMenu(
      container.querySelector(".lakehouse-panel") as HTMLElement,
      { clientX: 5000, clientY: 5000 },
    );

    const menu = screen.getByRole("menu");
    // Outside the component subtree — a child of body, beyond any transformed
    // or overflow-clipped dock ancestor.
    expect(container.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position).toBe("fixed");
    // Clamped: 5000 is far past jsdom's 1024x768 viewport.
    expect(Number.parseFloat(menu.style.left)).toBeLessThan(1024);
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(768);
  });

  it("stays open when clicked, closes on outside pointerdown", () => {
    const { container } = renderPanel();
    fireEvent.contextMenu(
      container.querySelector(".lakehouse-panel") as HTMLElement,
      { clientX: 40, clientY: 40 },
    );

    const menu = screen.getByRole("menu");
    // Portaled outside the React root, the menu no longer shields itself via
    // stopPropagation; the containment guard has to do it.
    fireEvent.pointerDown(within(menu).getAllByRole("menuitem")[0]);
    expect(screen.queryByRole("menu")).not.toBeNull();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
