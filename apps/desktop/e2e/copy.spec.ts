import { expect, type Page, test } from "@playwright/test";
import type { QueryStreamEvent } from "../src/db-stream";
import type {
  ConnectionInfo,
  DatabaseMetadata,
  QueryParameterPromptSet,
  WorkspaceSnapshot,
} from "../src/generated/irodori-api";

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

type CopyFixture = {
  columns: string[];
  rows: string[][];
};

type CopyMockBackend = {
  fixture: CopyFixture;
  workspace: WorkspaceSnapshot;
  metadata: DatabaseMetadata;
  parameterPromptSet: QueryParameterPromptSet;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: MockTauriInternals;
    __IRODORI_COPIED_TEXT__?: string;
    __IRODORI_COPY_DONE_COUNT__?: number;
  }
}

const copyFixture: CopyFixture = {
  columns: ["id", "name", "city"],
  rows: [
    ["1", "Aster Works", "Tokyo"],
    ["2", "Kawase Foods", "Osaka"],
  ],
};

function createCopyMockBackend(): CopyMockBackend {
  return {
    fixture: copyFixture,
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
          objects: [{ name: "customers", kind: "table", rows: "2" }],
        },
      ],
    },
    metadata: { schemas: [{ name: "public", objects: [] }] },
    parameterPromptSet: { prompts: [], signature: "copy-test" },
  };
}

async function installCopyMock(page: Page) {
  await page.addInitScript((backend: CopyMockBackend) => {
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

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.__IRODORI_COPIED_TEXT__ = text;
        },
      },
    });

    const callbacks = new Map<number, TauriCallback<unknown>>();
    let nextCallbackId = 1;

    window.__IRODORI_COPIED_TEXT__ = undefined;
    window.__IRODORI_COPY_DONE_COUNT__ = 0;
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
            channel.onmessage({
              type: "rows",
              resultSetIndex: 0,
              rows: fixture.rows.map((row) => [...row]),
            });
            channel.onmessage({
              type: "done",
              rowCount: fixture.rows.length,
              truncated: false,
              elapsedMs: 12,
              resultSets: [
                {
                  resultSetIndex: 0,
                  rowCount: fixture.rows.length,
                  elapsedMs: 12,
                  truncated: false,
                },
              ],
            });
            window.__IRODORI_COPY_DONE_COUNT__ =
              (window.__IRODORI_COPY_DONE_COUNT__ ?? 0) + 1;
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
  }, createCopyMockBackend());
}

async function connectAndRun(page: Page) {
  await page.goto("/");
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
  await page.locator(".cm-content").click();
  await page.keyboard.type("select * from customers");
  await page.getByRole("button", { name: "Run Current", exact: true }).click();
  await page.waitForFunction(
    () => (window.__IRODORI_COPY_DONE_COUNT__ ?? 0) >= 1,
  );
  await expect(page.locator(".statusbar")).toContainText("idle");
  await expect(page.locator(".results-title")).toContainText("2 rows");
}

async function runPaletteCommand(page: Page, query: string) {
  await page.keyboard.press("ControlOrMeta+Shift+P");
  const input = page.locator(".palette-input");
  await expect(input).toBeVisible();
  await input.fill(query);
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
}

async function expectCopiedText(page: Page, expected: string) {
  await expect
    .poll(() => page.evaluate(() => window.__IRODORI_COPIED_TEXT__))
    .toBe(expected);
}

test.describe("result grid copy", () => {
  test("copies the selected cell and selected row to navigator.clipboard", async ({
    page,
  }) => {
    await installCopyMock(page);
    await connectAndRun(page);

    const targetCell = page.getByRole("cell", { name: "Kawase Foods" });
    await targetCell.click();
    await expect(targetCell).toHaveAttribute("aria-selected", "true");
    await runPaletteCommand(page, "Copy selected cell or row");
    await expectCopiedText(page, "Kawase Foods");

    await runPaletteCommand(page, "Copy selected row as TSV");
    await expectCopiedText(page, "2\tKawase Foods\tOsaka");
  });

  test("copies the visible result with headers as TSV", async ({ page }) => {
    await installCopyMock(page);
    await connectAndRun(page);

    await page.getByRole("button", { name: "Copy TSV" }).click();
    await expectCopiedText(
      page,
      "id\tname\tcity\n1\tAster Works\tTokyo\n2\tKawase Foods\tOsaka",
    );
  });
});
