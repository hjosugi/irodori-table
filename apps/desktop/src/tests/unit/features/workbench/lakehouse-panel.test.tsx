import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLakehouseEngine,
  LakehousePanel,
} from "@/features/workbench/components/LakehousePanel";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
});

function renderPanel(
  overrides: Partial<Parameters<typeof LakehousePanel>[0]> = {},
) {
  const props: Parameters<typeof LakehousePanel>[0] = {
    editorEngine: "mysql",
    activeConnectionName: "Local Postgres",
    activeConnectionOpen: false,
    activeMetadata: undefined,
    onInsertSql: vi.fn(),
    onLoadSql: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  flushSync(() => root.render(<LakehousePanel {...props} />));
  return props;
}

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
    renderPanel();

    const action = container.querySelector(".lakehouse-action");
    expect(action?.querySelector("strong")?.textContent).toBe("DuckDB Iceberg");
    expect(action?.querySelector("span")?.textContent).toContain(
      "S3/R2/GCS object storage",
    );
  });

  it("opens an action context menu on right click", () => {
    const props = renderPanel();
    const action = container.querySelector<HTMLElement>(".lakehouse-action");

    let dispatched: boolean | undefined;
    flushSync(() => {
      dispatched = action?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 48,
          clientY: 64,
        }),
      );
    });

    expect(dispatched).toBe(false);
    const menu = container.querySelector<HTMLElement>(
      ".lakehouse-context-menu",
    );
    expect(menu?.textContent).toContain("Load DuckDB Iceberg SQL");

    menu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.click();
    expect(props.onLoadSql).toHaveBeenCalledTimes(1);
  });
});
