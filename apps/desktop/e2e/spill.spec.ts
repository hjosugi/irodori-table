import { expect, type Locator, type Page, test } from "@playwright/test";
import type { SpillStreamEvent } from "../src/db-stream";
import type {
  ConnectionInfo,
  DatabaseMetadata,
  QueryParameterPromptSet,
  WorkspaceSnapshot,
} from "../src/generated/irodori-api";
import { calculateResultGridVirtualRowWindow } from "../src/features/results/result-grid";

// EXEC-010: with disk offload on, a result larger than the in-memory budget is
// retained behind a backend store and the grid pages rows from disk via
// `db_result_window`. This spec proves the grid (a) paints the resident first page
// immediately, (b) fetches and renders far rows on demand when scrolled deep, (c)
// keeps DOM bounded, and (d) never loads the whole result — it pages on demand.

const GRID_ROW_HEIGHT_PX = 27;
const GRID_OVERSCAN_ROWS = 8;
const GRID_INITIAL_VIEWPORT_HEIGHT_PX = 480;
const PAGE_SIZE = 1_000;

const fixture = {
  columns: ["id", "val_a", "val_b"],
  total: 120_000,
  budget: 1_000,
} as const;

type MockInvokeArgs = Record<string, unknown>;
type TauriCallback<T = unknown> = (response: T) => void;
type MockStreamChannel = { onmessage: (event: SpillStreamEvent) => void };

type SpillMetrics = {
  windowCalls: number;
  windowOffsets: number[];
  releaseCalls: number;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: (command: string, args?: MockInvokeArgs) => Promise<unknown>;
      transformCallback: (callback?: TauriCallback, once?: boolean) => number;
      unregisterCallback: (id: number) => void;
    };
    __IRODORI_SPILL_DONE__?: number;
    __IRODORI_SPILL_METRICS__?: SpillMetrics;
  }
}

function cellFor(rowIndex: number, columnIndex: number): string {
  return columnIndex === 0
    ? `row_${rowIndex}`
    : `${fixture.columns[columnIndex]}_${rowIndex}`;
}

function rowsFor(offset: number, limit: number): string[][] {
  const length = Math.max(0, Math.min(limit, fixture.total - offset));
  return Array.from({ length }, (_, i) =>
    fixture.columns.map((_column, columnIndex) =>
      cellFor(offset + i, columnIndex),
    ),
  );
}

function expectedFirstRowIndex(scrollTop: number): number {
  return calculateResultGridVirtualRowWindow({
    rowCount: fixture.total,
    scrollTop,
    viewportHeight: GRID_INITIAL_VIEWPORT_HEIGHT_PX,
    rowHeight: GRID_ROW_HEIGHT_PX,
    overscan: GRID_OVERSCAN_ROWS,
  }).firstRowIndex;
}

function rowBudget(viewportHeight: number): number {
  return calculateResultGridVirtualRowWindow({
    rowCount: fixture.total,
    scrollTop: 0,
    viewportHeight: Math.max(viewportHeight, GRID_INITIAL_VIEWPORT_HEIGHT_PX),
    rowHeight: GRID_ROW_HEIGHT_PX,
    overscan: GRID_OVERSCAN_ROWS,
  }).maxRenderedRowCount;
}

async function installSpillMock(page: Page) {
  // Turn disk offload on before the app boots so runs take the spill path, with a
  // small resident budget so most of the result must page from disk.
  await page.addInitScript(() => {
    window.localStorage.setItem("irodori.results.offload.v1", "true");
    window.localStorage.setItem("irodori.results.memoryBudget.v1", "1000");
  });

  await page.addInitScript(
    (config: {
      columns: string[];
      total: number;
      budget: number;
      pageSize: number;
    }) => {
      const isRecord = (value: unknown): value is Record<string, unknown> =>
        typeof value === "object" && value !== null;

      const cell = (rowIndex: number, columnIndex: number) =>
        columnIndex === 0
          ? `row_${rowIndex}`
          : `${config.columns[columnIndex]}_${rowIndex}`;

      const rows = (offset: number, limit: number) => {
        const length = Math.max(0, Math.min(limit, config.total - offset));
        return Array.from({ length }, (_unused, i) =>
          config.columns.map((_column, columnIndex) =>
            cell(offset + i, columnIndex),
          ),
        );
      };

      const metrics: SpillMetrics = {
        windowCalls: 0,
        windowOffsets: [],
        releaseCalls: 0,
      };
      window.__IRODORI_SPILL_METRICS__ = metrics;
      window.__IRODORI_SPILL_DONE__ = 0;

      const workspace: WorkspaceSnapshot = {
        activeConnectionId: "local-pg",
        connections: [
          {
            id: "local-pg",
            name: "Mock Database",
            engine: "PostgreSQL 16",
            status: "idle",
            latencyMs: 5,
            proxy: "direct",
            objects: [
              {
                name: "huge_table",
                kind: "table",
                rows: config.total.toLocaleString(),
              },
            ],
          },
        ],
      };
      const metadata: DatabaseMetadata = {
        schemas: [
          {
            name: "public",
            objects: [
              {
                schema: "public",
                name: "huge_table",
                kind: "table",
                columns: config.columns.map((column, index) => ({
                  name: column,
                  dataType: index === 0 ? "text" : "varchar",
                  nullable: index !== 0,
                  ordinal: index + 1,
                })),
                indexes: [],
                primaryKey: [config.columns[0]],
                foreignKeys: [],
              },
            ],
          },
        ],
      };
      const promptSet: QueryParameterPromptSet = {
        prompts: [],
        signature: "mock",
      };

      const channelFrom = (args?: MockInvokeArgs): MockStreamChannel => {
        const onEvent = args?.onEvent;
        if (
          isRecord(onEvent) &&
          "onmessage" in onEvent &&
          typeof onEvent.onmessage === "function"
        ) {
          return onEvent as MockStreamChannel;
        }
        throw new Error("db_run_query_spill invoked without onEvent");
      };

      const callbacks = new Map<number, TauriCallback>();
      let nextCallbackId = 1;

      window.__TAURI_INTERNALS__ = {
        invoke: async (command, args) => {
          switch (command) {
            case "workspace_snapshot":
              return workspace;
            case "db_connect":
              return {
                id: "local-pg",
                engine: "postgres",
                serverVersion: "16",
              } satisfies ConnectionInfo;
            case "db_list_objects":
              return metadata;
            case "db_query_parameters":
              return promptSet;
            case "db_run_query_spill": {
              const channel = channelFrom(args);
              channel.onmessage({
                type: "columns",
                resultSetIndex: 0,
                columns: [...config.columns],
              });
              // Stream only the resident first page, like the real backend.
              for (let offset = 0; offset < config.budget; offset += 500) {
                channel.onmessage({
                  type: "rows",
                  resultSetIndex: 0,
                  rows: rows(offset, Math.min(500, config.budget - offset)),
                });
              }
              window.__IRODORI_SPILL_DONE__ =
                (window.__IRODORI_SPILL_DONE__ ?? 0) + 1;
              return {
                handle: "result-1",
                columns: [...config.columns],
                totalRows: config.total,
                inMemoryRows: config.budget,
                spilled: true,
                truncated: false,
                elapsedMs: 7,
              };
            }
            case "db_result_window": {
              const offset = Number(args?.offset ?? 0);
              const limit = Number(args?.limit ?? 0);
              metrics.windowCalls += 1;
              metrics.windowOffsets.push(offset);
              return { offset, rows: rows(offset, limit) };
            }
            case "db_release_result":
              metrics.releaseCalls += 1;
              return true;
            default:
              return null;
          }
        },
        transformCallback: (callback, once = false) => {
          const id = nextCallbackId;
          nextCallbackId += 1;
          if (callback) {
            callbacks.set(id, (response) => {
              callback(response);
              if (once) {
                callbacks.delete(id);
              }
            });
          }
          return id;
        },
        unregisterCallback: (id) => {
          callbacks.delete(id);
        },
      };
    },
    {
      columns: [...fixture.columns],
      total: fixture.total,
      budget: fixture.budget,
      pageSize: PAGE_SIZE,
    },
  );
}

// The refactored UI connects through the connection-manager dialog: open it, start
// a fresh URL-mode draft, fill it, and submit "Connect". The mock `db_connect`
// resolves to the `local-pg` connection, after which the status bar reports it.
async function connectMock(page: Page) {
  const connectionManager = page
    .getByRole("button", { name: "Connection manager" })
    .first();
  if (
    (await connectionManager.count()) > 0 &&
    (await connectionManager.isVisible())
  ) {
    await connectionManager.click();
  } else {
    await page.locator(".connection-select").click();
  }
  await page.getByRole("button", { name: "New connection" }).last().click();
  await page.getByPlaceholder("Connection's name").fill("Mock Database");
  await page.getByRole("button", { name: "URL", exact: true }).click();
  await page
    .getByPlaceholder("postgres://user:password@host:5432/database")
    .fill("postgres://u:p@localhost:5432/db");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".statusbar-connection")).toContainText(
    "Connected",
  );
}

async function runHugeTable(page: Page, expectedDone: number) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("select * from huge_table;");
  await page.getByRole("button", { name: "Run Current", exact: true }).click();
  await page.waitForFunction(
    (expected) => (window.__IRODORI_SPILL_DONE__ ?? 0) >= expected,
    expectedDone,
  );
  await expect(page.locator(".statusbar")).toContainText("idle");
}

async function connectAndRun(page: Page) {
  await connectMock(page);
  await runHugeTable(page, 1);
}

async function scrollGridTo(grid: Locator, top: number) {
  await grid.evaluate((element, nextTop) => {
    element.scrollTop = nextTop;
  }, top);
  await grid.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function readMetrics(page: Page): Promise<SpillMetrics> {
  return page.evaluate(() => window.__IRODORI_SPILL_METRICS__ as SpillMetrics);
}

test.describe("EXEC-010 disk offload paging", () => {
  test.describe.configure({ mode: "serial" });

  test("pages far rows from disk while keeping the DOM and fetches bounded", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installSpillMock(page);
    await page.goto("/");
    await connectAndRun(page);

    const grid = page.locator(".result-grid");
    const renderedRows = grid.locator(".grid-row:not(.header)");
    await expect(grid).toBeVisible();

    // Total row count comes from the spill result, and the resident first page
    // paints immediately.
    await expect(page.locator(".results-title")).toContainText("120,000 rows");
    await expect(renderedRows.first()).toContainText("row_0");
    const viewportHeight = await grid.evaluate(
      (element) => element.clientHeight,
    );
    expect(await renderedRows.count()).toBeLessThanOrEqual(
      rowBudget(viewportHeight),
    );

    // Scrolling deep into the spilled region triggers an on-demand page fetch and
    // renders the real far row (not the "…" placeholder).
    const deepTop = 60_000 * GRID_ROW_HEIGHT_PX;
    await scrollGridTo(grid, deepTop);
    const deepActualTop = await grid.evaluate((element) => element.scrollTop);
    const deepIndex = expectedFirstRowIndex(deepActualTop);
    await expect(renderedRows.first()).toContainText(`row_${deepIndex}`);
    expect(await renderedRows.count()).toBeLessThanOrEqual(
      rowBudget(viewportHeight),
    );

    // Jump to the very bottom: the last row pages in from disk.
    const bottomTop = (fixture.total - 12) * GRID_ROW_HEIGHT_PX;
    await scrollGridTo(grid, bottomTop);
    await expect(renderedRows.last()).toContainText(`row_${fixture.total - 1}`);

    // The grid paged on demand — it fetched only a handful of pages, never the
    // ~120 pages a full load would require.
    const metrics = await readMetrics(page);
    expect(metrics.windowCalls).toBeGreaterThan(0);
    expect(
      metrics.windowCalls,
      `paged ${metrics.windowCalls} windows; should stay far below a full load`,
    ).toBeLessThan(20);
    // The pages it fetched cover the regions we actually visited.
    expect(
      metrics.windowOffsets.some(
        (offset) => offset >= 59_000 && offset <= 61_000,
      ),
    ).toBe(true);
  });

  test("releases the retained result when a new run replaces it", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await installSpillMock(page);
    await page.goto("/");
    await connectAndRun(page);

    // A second run releases the first result's disk-backed store.
    await page
      .getByRole("button", { name: "Run Current", exact: true })
      .click();
    await page.waitForFunction(() => (window.__IRODORI_SPILL_DONE__ ?? 0) >= 2);
    const metrics = await readMetrics(page);
    expect(metrics.releaseCalls).toBeGreaterThanOrEqual(1);
  });
});
