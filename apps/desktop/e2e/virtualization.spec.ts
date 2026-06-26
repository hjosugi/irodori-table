import { expect, type Locator, type Page, test } from "@playwright/test";
import type { QueryStreamEvent } from "../src/db-stream";
import type {
  ConnectionInfo,
  DatabaseMetadata,
  QueryParameterPromptSet,
  WorkspaceSnapshot,
} from "../src/generated/irodori-api";
import {
  calculateResultGridVirtualColumnWindow,
  calculateResultGridVirtualRowWindow,
} from "../src/result-grid";

const GRID_ROW_HEIGHT_PX = 27;
const GRID_OVERSCAN_ROWS = 8;
const GRID_COLUMN_WIDTH_PX = 148;
const GRID_COLUMN_OVERSCAN = 2;
const GRID_INITIAL_VIEWPORT_HEIGHT_PX = 480;
const GRID_INITIAL_VIEWPORT_WIDTH_PX = 900;

type VirtualizedResultFixture = {
  readonly columns: readonly string[];
  readonly rowCount: number;
  readonly rowsPerBatch: number;
  readonly logicalRows?: boolean;
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

type VirtualizationMetrics = {
  logicalRows: boolean;
  batches: number;
  sentRows: number;
  createdLogicalRows: number;
  materializedArrayRows: number;
  materializedArrayCells: number;
  logicalRowMapCalls: number;
  logicalCellReads: number;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: MockTauriInternals;
    __IRODORI_VIRTUALIZATION_DONE_COUNT__?: number;
    __IRODORI_VIRTUALIZATION_METRICS__?: VirtualizationMetrics;
  }
}

const hugeTableFixture = {
  columns: ["id", "val_a", "val_b", "val_c", "val_d"],
  rowCount: 10_000,
  rowsPerBatch: 1_000,
} satisfies VirtualizedResultFixture;

const wideTableFixture = {
  columns: Array.from({ length: 2_000 }, (_, index) => `col_${index}`),
  rowCount: 1_000,
  rowsPerBatch: 100,
} satisfies VirtualizedResultFixture;

const millionRowTableFixture = {
  columns: Array.from({ length: 128 }, (_, index) => `col_${index}`),
  rowCount: 1_000_000,
  rowsPerBatch: 10_000,
  logicalRows: true,
} satisfies VirtualizedResultFixture;

function createVirtualizationMockBackend(
  fixture: VirtualizedResultFixture,
): VirtualizationMockBackend {
  const tableColumns = fixture.columns.map((column, index) => ({
    name: column,
    dataType: index === 0 ? "text" : "varchar",
    nullable: index !== 0,
    ordinal: index + 1,
  }));
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
    metadata: {
      schemas: [
        {
          name: "public",
          objects: [
            {
              schema: "public",
              name: "huge_table",
              kind: "table",
              columns: tableColumns,
              indexes: [],
              primaryKey: [fixture.columns[0]],
              foreignKeys: [],
            },
          ],
        },
      ],
    },
    parameterPromptSet: { prompts: [], signature: "mock-sig" },
  };
}

function virtualRowBudget(
  viewportHeight: number,
  rowCount = hugeTableFixture.rowCount,
) {
  // The app initializes with a 480px grid viewport before ResizeObserver reports.
  // Budget against that fallback as well as the measured height so early renders
  // are still bounded without depending on a precise browser layout tick.
  return calculateResultGridVirtualRowWindow({
    rowCount,
    scrollTop: 0,
    viewportHeight: Math.max(viewportHeight, GRID_INITIAL_VIEWPORT_HEIGHT_PX),
    rowHeight: GRID_ROW_HEIGHT_PX,
    overscan: GRID_OVERSCAN_ROWS,
  }).maxRenderedRowCount;
}

function virtualColumnBudget(
  viewportWidth: number,
  columnCount: number,
  scrollLeft = 0,
  gutterWidth = 0,
) {
  // The app initializes with a 900px grid viewport before ResizeObserver reports.
  // Budget against that fallback as well as the measured width so the first paint
  // remains bounded without depending on a precise layout tick.
  return calculateResultGridVirtualColumnWindow({
    columnCount,
    scrollLeft: Math.max(0, scrollLeft - gutterWidth),
    viewportWidth: Math.max(
      0,
      Math.max(viewportWidth, GRID_INITIAL_VIEWPORT_WIDTH_PX) - gutterWidth,
    ),
    columnWidth: GRID_COLUMN_WIDTH_PX,
    overscan: GRID_COLUMN_OVERSCAN,
  });
}

function expectedFirstRowText(
  scrollTop: number,
  rowCount = hugeTableFixture.rowCount,
) {
  return `row_${expectedFirstRowIndex(scrollTop, rowCount)}`;
}

function expectedFirstRowIndex(scrollTop: number, rowCount: number) {
  const window = calculateResultGridVirtualRowWindow({
    rowCount,
    scrollTop,
    viewportHeight: GRID_INITIAL_VIEWPORT_HEIGHT_PX,
    rowHeight: GRID_ROW_HEIGHT_PX,
    overscan: GRID_OVERSCAN_ROWS,
  });
  return window.firstRowIndex;
}

async function installVirtualizationMock(
  page: Page,
  fixture = hugeTableFixture,
) {
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

    const metrics = {
      logicalRows: fixture.logicalRows === true,
      batches: 0,
      sentRows: 0,
      createdLogicalRows: 0,
      materializedArrayRows: 0,
      materializedArrayCells: 0,
      logicalRowMapCalls: 0,
      logicalCellReads: 0,
    };

    const cellFor = (rowIndex: number, columnIndex: number) =>
      columnIndex === 0
        ? `row_${rowIndex}`
        : `${fixture.columns[columnIndex] ?? `col_${columnIndex}`}_${rowIndex}`;

    const materializedRowFor = (rowIndex: number) => {
      metrics.materializedArrayRows += 1;
      metrics.materializedArrayCells += fixture.columns.length;
      return fixture.columns.map((_, columnIndex) =>
        cellFor(rowIndex, columnIndex),
      );
    };

    const logicalRowFor = (rowIndex: number) => {
      metrics.createdLogicalRows += 1;
      return {
        length: fixture.columns.length,
        map<T>(
          callback: (value: string, columnIndex: number, row: unknown) => T,
          thisArg?: unknown,
        ) {
          metrics.logicalRowMapCalls += 1;
          const cells: T[] = [];
          for (
            let columnIndex = 0;
            columnIndex < fixture.columns.length;
            columnIndex += 1
          ) {
            metrics.logicalCellReads += 1;
            cells.push(
              callback.call(
                thisArg,
                cellFor(rowIndex, columnIndex),
                columnIndex,
                this,
              ),
            );
          }
          return cells;
        },
      };
    };

    const rowsFrom = (startIndex: number, count: number) => {
      const length = Math.max(0, Math.min(count, fixture.rowCount - startIndex));
      metrics.batches += 1;
      metrics.sentRows += length;

      if (fixture.logicalRows) {
        return {
          *[Symbol.iterator]() {
            for (let offset = 0; offset < length; offset += 1) {
              yield logicalRowFor(startIndex + offset);
            }
          },
        } as unknown as unknown[][];
      }

      return Array.from({ length }, (_, offset) =>
        materializedRowFor(startIndex + offset),
      );
    };

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
        if (!fixture.logicalRows) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
    };

    const callbacks = new Map<number, TauriCallback<unknown>>();
    let nextCallbackId = 1;

    window.__IRODORI_VIRTUALIZATION_DONE_COUNT__ = 0;
    window.__IRODORI_VIRTUALIZATION_METRICS__ = metrics;
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
  }, createVirtualizationMockBackend(fixture));
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
  await page
    .getByRole("button", { name: "Connection manager", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".editor-meta")).toContainText("ready");
}

async function replaceEditorText(page: Page, text: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
}

async function runFixtureQuery(page: Page, expectedDoneCount: number) {
  await replaceEditorText(page, "select * from huge_table;");
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

async function expectRenderedRowsWithinBudget(
  grid: Locator,
  rows: Locator,
  rowCount = hugeTableFixture.rowCount,
) {
  const viewportHeight = await grid.evaluate((element) => element.clientHeight);
  const budget = virtualRowBudget(viewportHeight, rowCount);

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

async function expectRenderedColumnsWithinBudget(
  grid: Locator,
  headers: Locator,
  columnCount: number,
) {
  const viewport = await grid.evaluate((element) => ({
    width: element.clientWidth,
    left: element.scrollLeft,
  }));
  const budget = virtualColumnBudget(viewport.width, columnCount, viewport.left);

  await expect
    .poll(() => headers.count(), {
      message: `rendered columns stay within virtualized budget (${budget.maxRenderedColumnCount})`,
    })
    .toBeGreaterThan(0);

  expect(
    await headers.count(),
    `rendered columns should stay within virtualized budget (${budget.maxRenderedColumnCount})`,
  ).toBeLessThanOrEqual(budget.maxRenderedColumnCount);
}

async function expectRenderedCellsWithinBudget(
  grid: Locator,
  rows: Locator,
  headers: Locator,
) {
  const [visibleRowCount, visibleColumnCount, renderedCellCount] =
    await Promise.all([
      rows.count(),
      headers.count(),
      grid.locator(".grid-row:not(.header) [role='cell']").count(),
    ]);

  expect(
    renderedCellCount,
    "rendered body cells should stay within the visible row x visible column window",
  ).toBeLessThanOrEqual(visibleRowCount * visibleColumnCount);
}

async function expectedFirstColumnText(grid: Locator, columnCount: number) {
  const viewport = await grid.evaluate((element) => ({
    width: element.clientWidth,
    left: element.scrollLeft,
  }));
  const window = virtualColumnBudget(viewport.width, columnCount, viewport.left);
  return `col_${window.firstColumnIndex}`;
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

async function rapidScrollBenchmark(
  grid: Locator,
  positions: readonly { top: number; left?: number }[],
) {
  return grid.evaluate(async (element, nextPositions) => {
    const frameDurations: number[] = [];
    let blankFrameCount = 0;
    const started = performance.now();
    let previousFrameAt = started;

    for (const position of nextPositions) {
      element.scrollTop = position.top;
      if (position.left !== undefined) {
        element.scrollLeft = position.left;
      }

      const frameAt = await new Promise<number>((resolve) =>
        requestAnimationFrame(resolve),
      );
      frameDurations.push(frameAt - previousFrameAt);
      previousFrameAt = frameAt;
      if (element.querySelectorAll(".grid-row:not(.header)").length === 0) {
        blankFrameCount += 1;
      }
    }

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    return {
      blankFrameCount,
      elapsedMs: performance.now() - started,
      left: element.scrollLeft,
      maxFrameMs: Math.max(0, ...frameDurations),
      top: element.scrollTop,
    };
  }, positions);
}

async function readVirtualizationMetrics(page: Page) {
  const metrics = await page.evaluate(
    () => window.__IRODORI_VIRTUALIZATION_METRICS__,
  );
  expect(
    metrics,
    "virtualization fixture metrics should be installed",
  ).toBeTruthy();
  return metrics as VirtualizationMetrics;
}

async function expectLogicalFixtureStayedLazy(
  page: Page,
  fixture: VirtualizedResultFixture,
) {
  const metrics = await readVirtualizationMetrics(page);

  expect(metrics.logicalRows).toBe(true);
  expect(metrics.sentRows).toBe(fixture.rowCount);
  expect(metrics.createdLogicalRows).toBe(fixture.rowCount);
  expect(metrics.materializedArrayRows).toBe(0);
  expect(metrics.materializedArrayCells).toBe(0);
  expect(metrics.logicalRowMapCalls).toBeLessThan(10_000);
  expect(metrics.logicalCellReads).toBeLessThan(fixture.rowCount * 2);
}

test.describe("Result Grid Virtualization and Sticky Gutter", () => {
  test.describe.configure({ mode: "serial" });

  test("virtualization limits DOM nodes and handles large scrolling", async ({
    page,
  }) => {
    await installVirtualizationMock(page);
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

  test("EXEC-004B million-row logical fixture stays bounded while scrolling", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await installVirtualizationMock(page, millionRowTableFixture);
    await page.goto("/");

    await connectMockDatabase(page);
    await runFixtureQuery(page, 1);
    await waitForGridPaint();

    const grid = page.locator(".result-grid");
    const renderedRows = grid.locator(".grid-row:not(.header)");
    const renderedHeaders = grid.locator(
      ".grid-row.header [role='columnheader']",
    );
    await expect(grid).toBeVisible();
    await expect(page.locator(".results-title")).toContainText("1,000,000 rows");
    await expect(grid).toHaveAttribute("aria-rowcount", "1000001");
    await expect(grid).toHaveAttribute(
      "aria-colcount",
      String(millionRowTableFixture.columns.length),
    );
    await expect(renderedRows.first()).toContainText("row_0");
    await expectRenderedRowsWithinBudget(
      grid,
      renderedRows,
      millionRowTableFixture.rowCount,
    );
    await expectRenderedColumnsWithinBudget(
      grid,
      renderedHeaders,
      millionRowTableFixture.columns.length,
    );
    await expectRenderedCellsWithinBudget(grid, renderedRows, renderedHeaders);

    const middleScrollTop = 500_000 * GRID_ROW_HEIGHT_PX;
    await scrollGridTo(grid, { top: middleScrollTop, left: 0 });
    const middleActualTop = await grid.evaluate((element) => element.scrollTop);
    await expect(renderedRows.first()).toHaveAttribute(
      "aria-rowindex",
      String(
        expectedFirstRowIndex(
          middleActualTop,
          millionRowTableFixture.rowCount,
        ) + 2,
      ),
    );
    await expect(renderedRows.first()).toContainText(
      expectedFirstRowText(middleActualTop, millionRowTableFixture.rowCount),
    );
    await expectRenderedRowsWithinBudget(
      grid,
      renderedRows,
      millionRowTableFixture.rowCount,
    );
    await expectRenderedCellsWithinBudget(grid, renderedRows, renderedHeaders);

    const bottomScrollTop =
      (millionRowTableFixture.rowCount - 20) * GRID_ROW_HEIGHT_PX;
    await scrollGridTo(grid, { top: bottomScrollTop, left: 0 });
    await expect(renderedRows.last()).toHaveAttribute(
      "aria-rowindex",
      String(millionRowTableFixture.rowCount + 1),
    );
    await expect(renderedRows.last()).toContainText(
      `row_${millionRowTableFixture.rowCount - 1}`,
    );
    await expectRenderedRowsWithinBudget(
      grid,
      renderedRows,
      millionRowTableFixture.rowCount,
    );

    const deepScrollLeft = 96 * GRID_COLUMN_WIDTH_PX;
    await scrollGridTo(grid, { top: middleScrollTop, left: deepScrollLeft });
    const horizontalActualTop = await grid.evaluate(
      (element) => element.scrollTop,
    );
    await expect(renderedRows.first()).toHaveAttribute(
      "aria-rowindex",
      String(
        expectedFirstRowIndex(
          horizontalActualTop,
          millionRowTableFixture.rowCount,
        ) + 2,
      ),
    );
    await expect(renderedHeaders.first()).toContainText(
      await expectedFirstColumnText(grid, millionRowTableFixture.columns.length),
    );
    await expectRenderedColumnsWithinBudget(
      grid,
      renderedHeaders,
      millionRowTableFixture.columns.length,
    );
    await expectRenderedCellsWithinBudget(grid, renderedRows, renderedHeaders);

    const benchmark = await rapidScrollBenchmark(grid, [
      { top: 0, left: 0 },
      { top: 125_000 * GRID_ROW_HEIGHT_PX, left: deepScrollLeft / 2 },
      { top: 750_000 * GRID_ROW_HEIGHT_PX, left: deepScrollLeft },
      { top: 250_000 * GRID_ROW_HEIGHT_PX, left: 0 },
      { top: bottomScrollTop, left: deepScrollLeft },
      { top: middleScrollTop, left: 0 },
    ]);
    expect(benchmark.blankFrameCount).toBe(0);
    expect(
      benchmark.maxFrameMs,
      `rapid virtual scroll max frame was ${benchmark.maxFrameMs.toFixed(1)} ms`,
    ).toBeLessThan(500);
    expect(
      benchmark.elapsedMs,
      `rapid virtual scroll elapsed ${benchmark.elapsedMs.toFixed(1)} ms`,
    ).toBeLessThan(2_500);

    await expect(renderedRows.first()).toHaveAttribute(
      "aria-rowindex",
      String(
        expectedFirstRowIndex(
          benchmark.top,
          millionRowTableFixture.rowCount,
        ) + 2,
      ),
    );
    await expectRenderedRowsWithinBudget(
      grid,
      renderedRows,
      millionRowTableFixture.rowCount,
    );
    await expectRenderedColumnsWithinBudget(
      grid,
      renderedHeaders,
      millionRowTableFixture.columns.length,
    );
    await expectRenderedCellsWithinBudget(grid, renderedRows, renderedHeaders);
    await expectLogicalFixtureStayedLazy(page, millionRowTableFixture);
  });

  test("wide-column virtualization keeps DOM cells bounded while scrolling", async ({
    page,
  }) => {
    await installVirtualizationMock(page, wideTableFixture);
    await page.goto("/");

    await connectMockDatabase(page);
    await runFixtureQuery(page, 1);
    await waitForGridPaint();

    const grid = page.locator(".result-grid");
    const renderedRows = grid.locator(".grid-row:not(.header)");
    const renderedHeaders = grid.locator(
      ".grid-row.header [role='columnheader']",
    );
    await expect(page.locator(".results-title")).toContainText("1,000 rows");
    await expect(renderedRows.first()).toContainText("row_0");
    await expect(renderedHeaders.first()).toContainText("col_0");
    await expectRenderedRowsWithinBudget(grid, renderedRows);
    await expectRenderedColumnsWithinBudget(
      grid,
      renderedHeaders,
      wideTableFixture.columns.length,
    );

    const deepScrollTop = 500 * GRID_ROW_HEIGHT_PX;
    const deepScrollLeft = 1_500 * GRID_COLUMN_WIDTH_PX;
    await scrollGridTo(grid, { top: deepScrollTop, left: deepScrollLeft });
    await expect(renderedRows.first()).toHaveAttribute(
      "aria-rowindex",
      String(expectedFirstRowIndex(deepScrollTop, wideTableFixture.rowCount) + 2),
    );
    await expect(renderedHeaders.first()).toContainText(
      await expectedFirstColumnText(grid, wideTableFixture.columns.length),
    );
    await expectRenderedRowsWithinBudget(grid, renderedRows);
    await expectRenderedColumnsWithinBudget(
      grid,
      renderedHeaders,
      wideTableFixture.columns.length,
    );

    const visibleRowCount = await renderedRows.count();
    const visibleColumnCount = await renderedHeaders.count();
    const renderedCellCount = await grid
      .locator(".grid-row:not(.header) [role='cell']")
      .count();
    expect(renderedCellCount).toBeLessThanOrEqual(
      visibleRowCount * visibleColumnCount,
    );

    await page.getByRole("button", { name: "Edit Data", exact: true }).click();
    await scrollGridTo(grid, { left: deepScrollLeft + 400 });
    await expectStickyGutterPinned(grid);
    await expectRenderedColumnsWithinBudget(
      grid,
      renderedHeaders,
      wideTableFixture.columns.length,
    );
  });
});
