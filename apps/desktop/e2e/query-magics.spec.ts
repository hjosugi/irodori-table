import { expect, type Page, test } from "@playwright/test";
import type { QueryStreamEvent } from "../src/db-stream";
import type {
  ColumnMetadata,
  ConnectionInfo,
  DatabaseMetadata,
  DbObjectMetadata,
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

type QueryMagicMockBackend = {
  workspace: WorkspaceSnapshot;
  metadata: DatabaseMetadata;
  parameterPromptSet: QueryParameterPromptSet;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: MockTauriInternals;
    __IRODORI_MAGIC_LAST_SQL__?: string;
    __IRODORI_MAGIC_DONE_COUNT__?: number;
  }
}

function table(schema: string, name: string, columns: readonly string[]): DbObjectMetadata {
  return {
    schema,
    name,
    kind: "table",
    primaryKey: columns.includes("id") ? ["id"] : [],
    indexes: [],
    foreignKeys: [],
    columns: columns.map<ColumnMetadata>((column, index) => ({
      name: column,
      dataType: column === "id" ? "int4" : "text",
      nullable: column !== "id",
      ordinal: index + 1,
    })),
  };
}

function createQueryMagicMockBackend(): QueryMagicMockBackend {
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
          objects: [{ name: "customers", kind: "table", rows: "2" }],
        },
      ],
    },
    metadata: {
      schemas: [
        {
          name: "public",
          objects: [table("public", "customers", ["id", "name", "email"])],
        },
      ],
    },
    parameterPromptSet: { prompts: [], signature: "query-magic-test" },
  };
}

async function installQueryMagicMock(page: Page) {
  await page.addInitScript((backend: QueryMagicMockBackend) => {
    const { metadata, parameterPromptSet, workspace } = backend;
    const callbacks = new Map<number, TauriCallback<unknown>>();
    let nextCallbackId = 1;

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

    window.__IRODORI_MAGIC_LAST_SQL__ = undefined;
    window.__IRODORI_MAGIC_DONE_COUNT__ = 0;
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
            const sql = typeof args?.sql === "string" ? args.sql : "";
            const channel = streamChannelFrom(args);
            window.__IRODORI_MAGIC_LAST_SQL__ = sql;
            channel.onmessage({
              type: "columns",
              resultSetIndex: 0,
              columns: ["sql"],
            });
            channel.onmessage({
              type: "rows",
              resultSetIndex: 0,
              rows: [[sql]],
            });
            channel.onmessage({
              type: "done",
              rowCount: 1,
              truncated: false,
              elapsedMs: 5,
              resultSets: [
                {
                  resultSetIndex: 0,
                  rowCount: 1,
                  elapsedMs: 5,
                  truncated: false,
                },
              ],
            });
            window.__IRODORI_MAGIC_DONE_COUNT__ =
              (window.__IRODORI_MAGIC_DONE_COUNT__ ?? 0) + 1;
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
  }, createQueryMagicMockBackend());
}

async function connect(page: Page) {
  await page.goto("/");
  const connectionManager = page
    .getByRole("button", { name: "Connection manager", exact: true })
    .first();
  if ((await connectionManager.count()) > 0 && (await connectionManager.isVisible())) {
    await connectionManager.click();
  } else {
    await page.locator(".connection-select").click();
  }
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".statusbar-connection")).toContainText("Connected");
}

async function replaceEditorText(page: Page, text: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
}

test("query magic explain expands to visible SQL and executes it", async ({
  page,
}) => {
  await installQueryMagicMock(page);
  await connect(page);

  await replaceEditorText(page, "\\explain select * from customers");
  await page.getByRole("button", { name: "Run Current", exact: true }).click();

  await page.waitForFunction(() => (window.__IRODORI_MAGIC_DONE_COUNT__ ?? 0) >= 1);
  await expect(page.locator(".cm-content")).toContainText(
    "EXPLAIN select * from customers;",
  );
  await expect
    .poll(() => page.evaluate(() => window.__IRODORI_MAGIC_LAST_SQL__))
    .toBe("EXPLAIN select * from customers;");
});

test("query magic erd opens the diagram filtered by text", async ({ page }) => {
  await installQueryMagicMock(page);
  await connect(page);

  await replaceEditorText(page, "\\erd customers");
  await page.getByRole("button", { name: "Run Current", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "ER diagram" })).toBeVisible();
  await expect(page.getByPlaceholder("Filter schemas, tables, columns")).toHaveValue(
    "customers",
  );
});
