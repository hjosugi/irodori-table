import { expect, type Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
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

type ErdMockBackend = {
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
  foreignKeys: DbObjectMetadata["foreignKeys"] = [],
): DbObjectMetadata {
  return {
    schema,
    name,
    kind: "table",
    primaryKey: columns.includes("id") ? ["id"] : [],
    indexes: [],
    foreignKeys,
    columns: columns.map<ColumnMetadata>((column, index) => ({
      name: column,
      dataType: column === "id" ? "int4" : "text",
      nullable: column !== "id",
      ordinal: index + 1,
    })),
  };
}

function createErdMockBackend(): ErdMockBackend {
  return {
    workspace: {
      activeConnectionId: "local-pg",
      connections: [
        {
          id: "local-pg",
          name: "ERD QA Database",
          engine: "PostgreSQL 16",
          status: "idle",
          latencyMs: 5,
          proxy: "direct",
          objects: [{ name: "orders", kind: "table", rows: "12" }],
        },
      ],
    },
    metadata: {
      schemas: [
        {
          name: "sales",
          objects: [
            table("sales", "customers", ["id", "name", "email"]),
            table("sales", "orders", ["id", "customer_id", "owner_id"], [
              {
                columns: ["customer_id"],
                referencesTable: "customers",
                referencesColumns: ["id"],
              },
              {
                columns: ["owner_id"],
                referencesSchema: "auth",
                referencesTable: "users",
                referencesColumns: ["id"],
              },
            ]),
            table("sales", "order_items", ["id", "order_id", "sku"], [
              {
                columns: ["order_id"],
                referencesTable: "orders",
                referencesColumns: ["id"],
              },
            ]),
          ],
        },
        {
          name: "auth",
          objects: [
            table("auth", "users", ["id", "display_name"]),
            table("auth", "teams", ["id", "owner_id"], [
              {
                columns: ["owner_id"],
                referencesTable: "users",
                referencesColumns: ["id"],
              },
            ]),
          ],
        },
      ],
    },
    parameterPromptSet: { prompts: [], signature: "erd-export-test" },
  };
}

async function installErdMock(page: Page) {
  await page.addInitScript((backend: ErdMockBackend) => {
    const { metadata, parameterPromptSet, workspace } = backend;
    const callbacks = new Map<number, TauriCallback<unknown>>();
    let nextCallbackId = 1;

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null;
    const profileIdFrom = (args?: MockInvokeArgs) => {
      const profile = args?.profile;
      return isRecord(profile) && typeof profile.id === "string"
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
  }, createErdMockBackend());
}

async function connect(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const connectionManager = page
    .getByRole("button", { name: "Connection manager", exact: true })
    .first();
  if ((await connectionManager.count()) > 0 && (await connectionManager.isVisible())) {
    await connectionManager.click();
  } else {
    await page.locator(".connection-select").click();
  }
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".editor-meta")).toContainText("ready");
}

async function openErd(page: Page) {
  await page.getByRole("button", { name: "ER diagram" }).click();
  const dialog = page.getByRole("dialog", { name: "ER diagram" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("5/5 tables · 4 edges")).toBeVisible();
  await expect(page.locator("svg.erd-svg path.erd-edge")).toHaveCount(4);
  return dialog;
}

async function downloadedBytes(page: Page, buttonName: string) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  return {
    fileName: download.suggestedFilename(),
    bytes: await readFile(path!),
  };
}

async function pngStats(page: Page, bytes: Buffer) {
  return page.evaluate(async (base64) => {
    const binary = window.atob(base64);
    const pngBytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      pngBytes[index] = binary.charCodeAt(index);
    }
    const url = URL.createObjectURL(new Blob([pngBytes], { type: "image/png" }));
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("downloaded PNG did not decode"));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        throw new Error("canvas is unavailable");
      }
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set<string>();
      let opaquePixels = 0;
      const step = Math.max(1, Math.floor((canvas.width * canvas.height) / 2000));
      for (let offset = 0; offset < pixels.length; offset += step * 4) {
        const alpha = pixels[offset + 3];
        if (alpha > 0) {
          opaquePixels += 1;
          colors.add(
            `${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${alpha}`,
          );
        }
      }
      return {
        width: canvas.width,
        height: canvas.height,
        opaquePixels,
        colorCount: colors.size,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, bytes.toString("base64"));
}

test("ERD downloads SVG and non-empty PNG from the rendered diagram", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installErdMock(page);
  await connect(page);
  await openErd(page);

  const svg = await downloadedBytes(page, "Download ERD SVG");
  expect(svg.fileName).toMatch(/^irodori-erd-local-pg-.*\.svg$/);
  const svgMarkup = svg.bytes.toString("utf8");
  expect(svgMarkup).toContain("<svg");
  expect(svgMarkup).toContain("Entity relationship diagram");
  expect(svgMarkup).toContain("sales");
  expect(svgMarkup).toContain("auth");
  expect(svgMarkup.match(/<path[^>]+class="erd-edge/g)).toHaveLength(4);

  const png = await downloadedBytes(page, "Download ERD PNG");
  expect(png.fileName).toMatch(/^irodori-erd-local-pg-.*\.png$/);
  expect(png.bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(png.bytes.length).toBeGreaterThan(1_000);

  const stats = await pngStats(page, png.bytes);
  expect(stats.width).toBeGreaterThan(500);
  expect(stats.height).toBeGreaterThan(300);
  expect(stats.opaquePixels).toBeGreaterThan(100);
  expect(stats.colorCount).toBeGreaterThan(3);

  const specJson = await downloadedBytes(page, "Spec JSON");
  expect(specJson.fileName).toMatch(
    /^irodori-table-spec-local-pg-.*\.irodori-schema\.json$/,
  );
  const spec = JSON.parse(specJson.bytes.toString("utf8")) as {
    format: string;
    schemas: Array<{ tables: Array<{ name: string }> }>;
  };
  expect(spec.format).toBe("irodori.table-spec.v1");
  expect(spec.schemas.flatMap((schema) => schema.tables).map((table) => table.name)).toEqual(
    ["customers", "orders", "order_items", "users", "teams"],
  );

  const specMarkdown = await downloadedBytes(page, "Spec MD");
  expect(specMarkdown.fileName).toMatch(/^irodori-table-spec-local-pg-.*\.md$/);
  const markdown = specMarkdown.bytes.toString("utf8");
  expect(markdown).toContain("# Table Definition Specification");
  expect(markdown).toContain("| sales | orders | 3 | id | 2 |");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Spec to DDL" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "spec.irodori-schema.json",
    mimeType: "application/json",
    buffer: specJson.bytes,
  });

  await expect(page.getByRole("dialog", { name: "ER diagram" })).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText(
    'CREATE TABLE "sales"."orders"',
  );
  await expect(page.locator(".cm-content")).toContainText(
    'FOREIGN KEY ("customer_id") REFERENCES "sales"."customers" ("id")',
  );
});
