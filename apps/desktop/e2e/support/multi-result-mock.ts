import { expect, type Page } from "@playwright/test";
import type { QueryStreamEvent } from "../../src/db-stream";
import type {
  ConnectionInfo,
  DatabaseMetadata,
  QueryParameterPromptSet,
  WorkspaceSnapshot,
} from "../../src/generated/irodori-api";

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

export async function installMultiResultMock(page: Page) {
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

export async function connectMockDatabase(page: Page) {
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

export async function runFixtureQuery(page: Page) {
  await page.locator(".cm-content").click();
  await page.keyboard.type("select * from customers; select * from orders");
  await page.getByRole("button", { name: "Run Current", exact: true }).click();
  await page.waitForFunction(
    () => (window.__IRODORI_MULTI_RESULTS_DONE_COUNT__ ?? 0) >= 1,
  );
  await expect(page.locator(".statusbar")).toContainText(/idle/i);
}
