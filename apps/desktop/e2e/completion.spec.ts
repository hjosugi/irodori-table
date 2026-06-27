import { expect, type Page, test } from "@playwright/test";
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

type MockTauriInternals = {
  invoke: (command: string, args?: MockInvokeArgs) => Promise<unknown>;
  transformCallback: (
    callback?: TauriCallback<unknown>,
    once?: boolean,
  ) => number;
  unregisterCallback: (id: number) => void;
};

type CompletionMockBackend = {
  workspace: WorkspaceSnapshot;
  metadata: DatabaseMetadata;
  parameterPromptSet: QueryParameterPromptSet;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: MockTauriInternals;
  }
}

function table(
  schema: string,
  name: string,
  columns: readonly string[],
): DbObjectMetadata {
  return {
    schema,
    name,
    kind: "table",
    primaryKey: columns.includes("id") ? ["id"] : [],
    indexes: [],
    foreignKeys: [],
    columns: columns.map<ColumnMetadata>((column, index) => ({
      name: column,
      dataType: column.endsWith("_id") || column === "id" ? "int4" : "text",
      nullable: column !== "id",
      ordinal: index + 1,
    })),
  };
}

function createCompletionMockBackend(): CompletionMockBackend {
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
          objects: [
            table("public", "customers", ["id", "name", "email"]),
            table("public", "orders", ["id", "customer_id", "total"]),
          ],
        },
        {
          name: "sales",
          objects: [table("sales", "invoices", ["id", "customer_id", "status"])],
        },
      ],
    },
    parameterPromptSet: { prompts: [], signature: "completion-test" },
  };
}

async function installCompletionMock(page: Page) {
  await page.addInitScript((backend: CompletionMockBackend) => {
    const { metadata, parameterPromptSet, workspace } = backend;
    const callbacks = new Map<number, TauriCallback<unknown>>();
    let nextCallbackId = 1;

    const profileIdFrom = (args?: MockInvokeArgs) => {
      const profile = args?.profile;
      return typeof profile === "object" &&
        profile !== null &&
        "id" in profile &&
        typeof profile.id === "string"
        ? profile.id
        : "local-pg";
    };

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
  }, createCompletionMockBackend());
}

async function replaceEditorText(page: Page, text: string) {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
}

async function moveEditorCursorTo(page: Page, offset: number) {
  await page.keyboard.press("Home");
  for (let index = 0; index < offset; index += 1) {
    await page.keyboard.press("ArrowRight");
  }
}

async function connectMockDatabase(page: Page) {
  const connectionManager = page
    .getByRole("button", { name: "Connection manager", exact: true })
    .first();
  if ((await connectionManager.count()) > 0 && (await connectionManager.isVisible())) {
    await connectionManager.click();
  } else {
    await page.locator(".connection-select").click();
  }
  await page.getByRole("button", { name: "Connect", exact: true }).click();
}

test("schema metadata drives table and column completion in the editor", async ({
  page,
}) => {
  await installCompletionMock(page);
  await page.goto("/");
  await connectMockDatabase(page);
  await expect(page.locator(".editor-meta")).toContainText("ready");
  await page.getByRole("tab", { name: "Completion" }).click();
  await expect(page.locator(".sidebar .completion-item").first()).toContainText(
    "customers",
  );
  await page
    .locator(".sidebar .completion-item")
    .filter({ hasText: "customers" })
    .first()
    .click();
  await expect(page.locator(".cm-content")).toContainText("public.customers");

  await replaceEditorText(page, "select * from cust");
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
    "customers",
  );

  await replaceEditorText(page, "select c. from customers c");
  await moveEditorCursorTo(page, "select c.".length);
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("email");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("name");

  await page.keyboard.press("Escape");
  await replaceEditorText(page, "select * from sales.");
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText(
    "invoices",
  );

  await page.keyboard.press("Escape");
  await replaceEditorText(page, "ili");
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("ilike");
});
