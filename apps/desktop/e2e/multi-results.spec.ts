import { expect, type Locator, type Page, test } from "@playwright/test";
import type { QueryStreamEvent } from "../src/db-stream";
import type {
  ConnectionInfo,
  DatabaseMetadata,
  QueryParameterPromptSet,
  WorkspaceSnapshot,
} from "../src/generated/irodori-api";

const GRID_ROW_HEIGHT_PX = 27;
const GRID_COLUMN_WIDTH_PX = 148;

// Errors the app raises on purpose in a plain browser when IPC is absent. This
// spec installs a Tauri mock, so anything outside this pattern is unexpected.
const ignorable = (message: string) => /tauri|invoke|__TAURI/i.test(message);

type MultiResultSetFixture = {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly elapsedMs: number;
};

type MultiResultMockBackend = {
  readonly workspace: WorkspaceSnapshot;
  readonly metadata: DatabaseMetadata;
  readonly parameterPromptSet: QueryParameterPromptSet;
  readonly resultSets: readonly MultiResultSetFixture[];
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
    __IRODORI_MULTI_RESULTS_DONE_COUNT__?: number;
  }
}

const multiStatementFixture = [
  {
    columns: Array.from({ length: 16 }, (_, index) =>
      index === 0 ? "account_id" : `metric_${index}`,
    ),
    rows: Array.from({ length: 120 }, (_, rowIndex) =>
      Array.from({ length: 16 }, (_, columnIndex) =>
        columnIndex === 0
          ? `account_${rowIndex}`
          : `metric_${columnIndex}_${rowIndex}`,
      ),
    ),
    elapsedMs: 37,
  },
  {
    columns: ["region", "active_accounts", "last_seen"],
    rows: [
      ["apac", "7", "2026-06-24"],
      ["emea", "11", "2026-06-25"],
      ["amer", "5", "2026-06-26"],
    ],
    elapsedMs: 9,
  },
] satisfies readonly MultiResultSetFixture[];

function createMultiResultMockBackend(): MultiResultMockBackend {
  return {
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
              name: "accounts",
              kind: "table",
              rows: "120",
            },
          ],
        },
      ],
    },
    metadata: { schemas: [{ name: "public", objects: [] }] },
    parameterPromptSet: { prompts: [], signature: "mock-sig" },
    resultSets: multiStatementFixture,
  };
}

async function installMultiResultMock(page: Page) {
  await page.addInitScript(() => window.localStorage.clear());
  await page.addInitScript((backend: MultiResultMockBackend) => {
    const { metadata, parameterPromptSet, resultSets, workspace } = backend;
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

    const callbacks = new Map<number, TauriCallback<unknown>>();
    let nextCallbackId = 1;

    window.__IRODORI_MULTI_RESULTS_DONE_COUNT__ = 0;
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
            for (const [resultSetIndex, set] of resultSets.entries()) {
              channel.onmessage({
                type: "columns",
                resultSetIndex,
                columns: [...set.columns],
              });
              for (
                let rowIndex = 0;
                rowIndex < set.rows.length;
                rowIndex += 40
              ) {
                channel.onmessage({
                  type: "rows",
                  resultSetIndex,
                  rows: set.rows
                    .slice(rowIndex, rowIndex + 40)
                    .map((row) => [...row]),
                });
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
              }
            }
            channel.onmessage({
              type: "done",
              rowCount: resultSets.reduce(
                (sum, set) => sum + set.rows.length,
                0,
              ),
              truncated: false,
              elapsedMs: resultSets.reduce(
                (sum, set) => sum + set.elapsedMs,
                0,
              ),
              resultSets: resultSets.map((set, resultSetIndex) => ({
                resultSetIndex,
                rowCount: set.rows.length,
                elapsedMs: set.elapsedMs,
                truncated: false,
              })),
            });
            window.__IRODORI_MULTI_RESULTS_DONE_COUNT__ =
              (window.__IRODORI_MULTI_RESULTS_DONE_COUNT__ ?? 0) + 1;
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
  }, createMultiResultMockBackend());
}

async function connectMockDatabase(page: Page) {
  const connectionManager = page
    .getByRole("button", { name: "Connection manager", exact: true })
    .first();
  if (
    (await connectionManager.count()) > 0 &&
    (await connectionManager.isVisible())
  ) {
    await connectionManager.click();
  } else {
    await page.locator(".connection-select").click();
  }
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".statusbar-connection")).toContainText(
    "Connected",
  );
}

async function runFixtureQuery(page: Page) {
  await page.locator(".cm-content").click();
  await page.keyboard.type("select * from customers; select * from orders");
  await page.getByRole("button", { name: "Run Current", exact: true }).click();
  await page.waitForFunction(
    () => (window.__IRODORI_MULTI_RESULTS_DONE_COUNT__ ?? 0) >= 1,
  );
  await expect(page.locator(".statusbar")).toContainText(/idle/i);
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

test("streamed multi-statement results expose tabs, summaries, switching, and reset grid state", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    console.error("BROWSER PAGE ERROR:", error);
    pageErrors.push(String(error));
  });

  await installMultiResultMock(page);
  await page.goto("/");

  await connectMockDatabase(page);
  await runFixtureQuery(page);

  const grid = page.locator(".result-grid");
  const resultTabs = page.getByRole("tablist", { name: "Result sets" });
  const resultOneTab = page.getByRole("tab", { name: "Result set 1" });
  const resultTwoTab = page.getByRole("tab", { name: "Result set 2" });

  await expect(resultTabs).toBeVisible();
  await expect(resultOneTab).toHaveAttribute("aria-selected", "true");
  await expect(resultTwoTab).toHaveAttribute("aria-selected", "false");
  await expect(page.locator(".results-title")).toContainText(
    "120 rows in 37 ms",
  );
  await expect(
    grid.getByRole("columnheader", { name: "account_id" }),
  ).toBeVisible();
  await expect(grid.getByRole("cell", { name: "account_0" })).toBeVisible();

  const selectedCell = grid.getByRole("cell", { name: "metric_1_0" });
  await selectedCell.click();
  await expect(selectedCell).toHaveAttribute("aria-selected", "true");
  await expect(grid.locator(".grid-row.row-selected")).toHaveCount(1);

  await scrollGridTo(grid, {
    top: 35 * GRID_ROW_HEIGHT_PX,
    left: 6 * GRID_COLUMN_WIDTH_PX,
  });
  const scrolledPosition = await grid.evaluate((element) => ({
    top: element.scrollTop,
    left: element.scrollLeft,
  }));
  expect(
    scrolledPosition.top,
    "test setup should leave the first result vertically scrolled",
  ).toBeGreaterThan(0);
  expect(
    scrolledPosition.left,
    "test setup should leave the first result horizontally scrolled",
  ).toBeGreaterThan(0);

  await resultTwoTab.click();
  await expect(resultOneTab).toHaveAttribute("aria-selected", "false");
  await expect(resultTwoTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".results-title")).toContainText("3 rows in 9 ms");
  await expectGridScrollPosition(grid, { top: 0, left: 0 });
  await expect(grid.locator(".grid-row.row-selected")).toHaveCount(0);
  await expect(grid.locator("[role='cell'][aria-selected='true']")).toHaveCount(
    0,
  );
  await expect(
    grid.getByRole("columnheader", { name: "region" }),
  ).toBeVisible();
  await expect(grid.getByRole("cell", { name: "apac" })).toBeVisible();
  await expect(grid.getByRole("cell", { name: "account_0" })).toHaveCount(0);

  await resultOneTab.click();
  await expect(resultOneTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".results-title")).toContainText(
    "120 rows in 37 ms",
  );
  await expectGridScrollPosition(grid, { top: 0, left: 0 });
  await expect(grid.locator(".grid-row.row-selected")).toHaveCount(0);
  await expect(grid.getByRole("cell", { name: "account_0" })).toBeVisible();

  expect(pageErrors.filter((message) => !ignorable(message))).toEqual([]);
});
