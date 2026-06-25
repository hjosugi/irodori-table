import { expect, type Locator, type Page, test } from "@playwright/test";
import type { QueryStreamEvent } from "../src/db-stream";
import type {
  ConnectionInfo,
  DatabaseMetadata,
  QueryParameterPromptSet,
  WorkspaceSnapshot,
} from "../src/generated/irodori-api";
import { calculateResultGridVirtualRowWindow } from "../src/result-grid";

const GRID_ROW_HEIGHT_PX = 27;
const GRID_OVERSCAN_ROWS = 8;
const GRID_INITIAL_VIEWPORT_HEIGHT_PX = 480;

type VirtualizedResultFixture = {
  readonly columns: readonly string[];
  readonly rowCount: number;
  readonly rowsPerBatch: number;
};

type VirtualizationMockBackend = {
  readonly fixture: VirtualizedResultFixture;
  readonly workspace: WorkspaceSnapshot;
  readonly metadata: DatabaseMetadata;
  readonly parameterPromptSet: QueryParameterPromptSet;
};

type TauriCallback<T = unknown> = (response: T) => void;
type MockInvokeArgs = Record<string, unknown>;

type MockStreamChannel = {
  onmessage: (event: QueryStreamEvent) => void;
};

type MockTauriInternals = {
  invoke: (command: string, args?: MockInvokeArgs) => Promise<unknown>;
  transformCallback: (
    callback?: TauriCallback<unknown>,
    once?: boolean,
  ) => number;
  unregisterCallback: (id: number) => void;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: MockTauriInternals;
    __IRODORI_VIRTUALIZATION_DONE_COUNT__?: number;
  }
}

const hugeTableFixture = {
  columns: ["id", "val_a", "val_b", "val_c", "val_d"],
  rowCount: 10_000,
  rowsPerBatch: 1_000,
} satisfies VirtualizedResultFixture;

function createVirtualizationMockBackend(
  fixture: VirtualizedResultFixture,
): VirtualizationMockBackend {
  return {
    fixture,
    workspace: {
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
              rows: fixture.rowCount.toLocaleString(),
            },
          ],
        },
      ],
    },
    metadata: { schemas: [{ name: "public", objects: [] }] },
    parameterPromptSet: { prompts: [], signature: "mock-sig" },
  };
}

function virtualRowBudget(viewportHeight: number) {
  // The app initializes with a 480px grid viewport before ResizeObserver reports.
  // Budget against that fallback as well as the measured height so early renders
  // are still bounded without depending on a precise browser layout tick.
  return calculateResultGridVirtualRowWindow({
    rowCount: hugeTableFixture.rowCount,
    scrollTop: 0,
    viewportHeight: Math.max(viewportHeight, GRID_INITIAL_VIEWPORT_HEIGHT_PX),
    rowHeight: GRID_ROW_HEIGHT_PX,
    overscan: GRID_OVERSCAN_ROWS,
  }).maxRenderedRowCount;
}

function expectedFirstRowText(scrollTop: number) {
  const window = calculateResultGridVirtualRowWindow({
    rowCount: hugeTableFixture.rowCount,
    scrollTop,
    viewportHeight: GRID_INITIAL_VIEWPORT_HEIGHT_PX,
    rowHeight: GRID_ROW_HEIGHT_PX,
    overscan: GRID_OVERSCAN_ROWS,
  });
  return `row_${window.firstRowIndex}`;
}

async function installVirtualizationMock(page: Page) {
  await page.addInitScript((backend: VirtualizationMockBackend) => {
    const { fixture, metadata, parameterPromptSet, workspace } = backend;
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null;

    const streamChannelFrom = (args?: MockInvokeArgs): MockStreamChannel => {
      const onEvent = args?.onEvent;
      if (
        isRecord(onEvent) &&
        "onmessage" in onEvent &&
        typeof onEvent.onmessage === "function"
      ) {
        return onEvent as MockStreamChannel;
      }
      throw new Error("db_run_query_stream was invoked without onEvent");
    };

    const profileIdFrom = (args?: MockInvokeArgs) => {
      const profile = args?.profile;
      return isRecord(profile) && typeof profile.id === "string"
        ? profile.id
        : "local-pg";
    };

    const rowFor = (rowIndex: number) =>
      fixture.columns.map((column, columnIndex) =>
        columnIndex === 0 ? `row_${rowIndex}` : `${column}_${rowIndex}`,
      );

    const rowsFrom = (startIndex: number, count: number) =>
      Array.from(
        {
          length: Math.max(
            0,
            Math.min(count, fixture.rowCount - startIndex),
          ),
        },
        (_, offset) => rowFor(startIndex + offset),
      );

    const streamRows = async (channel: MockStreamChannel) => {
      for (
        let rowIndex = 0;
        rowIndex < fixture.rowCount;
        rowIndex += fixture.rowsPerBatch
      ) {
        channel.onmessage({
          type: "rows",
          resultSetIndex: 0,
          rows: rowsFrom(rowIndex, fixture.rowsPerBatch),
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    };

    const callbacks = new Map<number, TauriCallback<unknown>>();
    let nextCallbackId = 1;

    window.__IRODORI_VIRTUALIZATION_DONE_COUNT__ = 0;
    window.__TAURI_INTERNALS__ = {
      invoke: async (command, args) => {
        switch (command) {
          case "workspace_snapshot":
            return workspace;
          case "db_connect":
            return {
              id: profileIdFrom(args),
              engine: "postgres",
              serverVersion: "16",
            } satisfies ConnectionInfo;
          case "db_list_objects":
            return metadata;
          case "db_query_parameters":
            return parameterPromptSet;
          case "db_run_query_stream": {
            const channel = streamChannelFrom(args);
            channel.onmessage({
              type: "columns",
              resultSetIndex: 0,
              columns: [...fixture.columns],
            });
            await streamRows(channel);
            channel.onmessage({
              type: "done",
              rowCount: fixture.rowCount,
              truncated: false,
              elapsedMs: 250,
              resultSets: [
                {
                  resultSetIndex: 0,
                  rowCount: fixture.rowCount,
                  elapsedMs: 250,
                  truncated: false,
                },
              ],
            });
            window.__IRODORI_VIRTUALIZATION_DONE_COUNT__ =
              (window.__IRODORI_VIRTUALIZATION_DONE_COUNT__ ?? 0) + 1;
            return undefined;
          }
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
  }, createVirtualizationMockBackend(hugeTableFixture));
}

async function waitForCompletedRun(page: Page, expectedDoneCount: number) {
  await page.waitForFunction(
    (expected) =>
      (window.__IRODORI_VIRTUALIZATION_DONE_COUNT__ ?? 0) >= expected,
    expectedDoneCount,
  );
  await expect(page.locator(".statusbar")).toContainText("idle");
}

async function waitForGridPaint() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function connectMockDatabase(page: Page) {
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".editor-meta")).toContainText("ready");
}

async function runFixtureQuery(page: Page, expectedDoneCount: number) {
  await page.getByRole("button", { name: "Run Current", exact: true }).click();
  await waitForCompletedRun(page, expectedDoneCount);
}

async function scrollGridTo(
  grid: Locator,
  position: { top?: number; left?: number },
) {
  await grid.evaluate((element, nextPosition) => {
    if (nextPosition.top !== undefined) {
      element.scrollTop = nextPosition.top;
    }
    if (nextPosition.left !== undefined) {
      element.scrollLeft = nextPosition.left;
    }
  }, position);
  await grid.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function expectRenderedRowsWithinBudget(grid: Locator, rows: Locator) {
  const viewportHeight = await grid.evaluate((element) => element.clientHeight);
  const budget = virtualRowBudget(viewportHeight);

  await expect
    .poll(() => rows.count(), {
      message: `rendered rows stay within virtualized budget (${budget})`,
    })
    .toBeGreaterThan(0);

  expect(
    await rows.count(),
    `rendered rows should stay within virtualized budget (${budget})`,
  ).toBeLessThanOrEqual(budget);
}

async function expectStickyGutterPinned(grid: Locator) {
  const gutter = grid.locator(".grid-gutter").first();
  await expect(gutter).toBeVisible();
  const stickyState = await gutter.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const gridRect = element.closest(".result-grid")?.getBoundingClientRect();
    const gutterRect = element.getBoundingClientRect();
    return {
      position: style.position,
      left: style.left,
      offsetPx: gridRect ? gutterRect.left - gridRect.left : Number.NaN,
    };
  });
  expect(stickyState.position).toBe("sticky");
  expect(stickyState.left).toBe("0px");
  expect(Math.abs(stickyState.offsetPx)).toBeLessThanOrEqual(1);
}

async function expectGridScrollPosition(
  grid: Locator,
  expected: { top: number; left: number },
) {
  await expect
    .poll(() =>
      grid.evaluate((element) => ({
        top: element.scrollTop,
        left: element.scrollLeft,
      })),
    )
    .toEqual(expected);
}

test.describe("Result Grid Virtualization and Sticky Gutter", () => {
  test.beforeEach(async ({ page }) => {
    await installVirtualizationMock(page);
  });

  test("virtualization limits DOM nodes and handles large scrolling", async ({
    page,
  }) => {
    await page.goto("/");

    await connectMockDatabase(page);
    await runFixtureQuery(page, 1);
    await waitForGridPaint();

    const grid = page.locator(".result-grid");
    const renderedRows = grid.locator(".grid-row:not(.header)");
    await expect(grid).toBeVisible();
    await expect(page.locator(".results-title")).toContainText("10,000 rows");
    await expect(renderedRows.first()).toContainText("row_0");
    await expectRenderedRowsWithinBudget(grid, renderedRows);

    const deepScrollTop = 7_500 * GRID_ROW_HEIGHT_PX;
    await scrollGridTo(grid, { top: deepScrollTop });
    await expect(renderedRows.first()).toContainText(
      expectedFirstRowText(deepScrollTop),
    );
    await expectRenderedRowsWithinBudget(grid, renderedRows);

    await page.getByRole("button", { name: "Edit Data", exact: true }).click();
    await scrollGridTo(grid, { left: 200 });
    await expectStickyGutterPinned(grid);

    await runFixtureQuery(page, 2);
    await expectGridScrollPosition(grid, { top: 0, left: 0 });
  });
});
