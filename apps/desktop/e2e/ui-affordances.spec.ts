import { expect, type Locator, type Page, test } from "@playwright/test";

// Regressions for controls that rendered but could not be used, or that read as
// the wrong thing. Tauri `invoke` rejects here and the app falls back to its
// mock snapshot, which is exactly the "no desktop runtime" path some of these
// controls have to degrade into.

type MockInvokeArgs = Record<string, unknown>;

type MockTauriInternals = {
  invoke: (command: string, args?: MockInvokeArgs) => Promise<unknown>;
  transformCallback: () => number;
  unregisterCallback: () => void;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: MockTauriInternals;
    __IRODORI_COPIED_TEXT__?: string;
  }
}

const LOG_DIR = "/home/tester/.local/share/dev.irodori.table/logs";

async function openWorkbench(page: Page) {
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 30_000 });
}

async function runMenuCommand(
  page: Page,
  menuName: string,
  commandName: string,
) {
  await page
    .getByRole("menubar", { name: "Application menu" })
    .getByRole("menuitem", { name: menuName })
    .click();
  await page.getByRole("menuitem", { name: commandName }).click();
}

async function openRightSidebarView(page: Page, tabName: string) {
  await page
    .locator('.titlebar-control-zone [data-sidebar-toggle="right"]')
    .click();
  await page.getByRole("tab", { name: tabName }).click();
}

function boxesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

async function requireBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  return box!;
}

test("the About log directory opens the folder, and copies it when it cannot", async ({
  page,
}) => {
  // The log directory row only renders once the backend answers, and the copy
  // fallback needs a clipboard that works headlessly.
  await page.addInitScript((logDir: string) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.__IRODORI_COPIED_TEXT__ = text;
        },
      },
    });
    window.__TAURI_INTERNALS__ = {
      invoke: async (command) => {
        if (command === "crash_report_status") {
          return {
            hasReport: false,
            logDir,
            telemetryEnabled: false,
            appVersion: "0.0.0-test",
            platform: "linux",
          };
        }
        // Everything else, including the opener plugin, is unavailable here.
        throw new Error(`no mock for ${command}`);
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };
  }, LOG_DIR);

  await openWorkbench(page);
  await runMenuCommand(page, "Help", "About Irodori Table");
  const about = page.getByRole("dialog", { name: "About Irodori Table" });
  await expect(about).toBeVisible();

  // The path is a control, not dead text.
  const openLogDir = about.getByRole("button", {
    name: "Show log directory in file manager",
  });
  await expect(openLogDir).toBeVisible();
  await expect(openLogDir).toContainText(LOG_DIR);

  // With no Tauri opener behind it, the click still leaves the user with the
  // path rather than failing silently.
  await openLogDir.click();
  await expect(about.getByText("Log directory path copied")).toBeVisible();
  expect(await page.evaluate(() => window.__IRODORI_COPIED_TEXT__)).toBe(
    LOG_DIR,
  );
});

test("the ERD button does not reuse the Git icon's node-and-line glyph", async ({
  page,
}) => {
  await openWorkbench(page);

  const erdIcon = page
    .getByRole("button", { name: "ER Diagram" })
    .locator("svg");
  const gitIcon = page.getByRole("tab", { name: "Git" }).locator("svg");
  await expect(erdIcon).toHaveCount(1);
  await expect(gitIcon).toHaveCount(1);

  // The Git glyph is circles joined by lines. The ERD glyph sat right beside it
  // and was drawn the same way, so tell them apart by shape rather than by name.
  expect(await gitIcon.locator("circle").count()).toBeGreaterThan(0);
  expect(await erdIcon.locator("circle").count()).toBe(0);
  expect(await erdIcon.locator("rect").count()).toBeGreaterThan(0);
});

test("the marketplace refresh button never lands on the source line", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1536, height: 900 },
    { width: 1280, height: 720 },
    { width: 1024, height: 720 },
    { width: 820, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await openWorkbench(page);
    await runMenuCommand(page, "Tools", "Open Extensions");
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();

    const search = dialog.locator(".extension-search");
    const note = dialog.locator(".extension-store-note");
    await expect(search).toBeVisible();
    await expect(note).toBeVisible();

    const refresh = search.getByRole("button", {
      name: "Refresh extension store",
    });
    const refreshBox = await requireBox(refresh);
    const searchBox = await requireBox(search);
    const noteBox = await requireBox(note);

    expect(
      boxesOverlap(refreshBox, noteBox),
      `refresh overlaps the source line at ${viewport.width}px`,
    ).toBe(false);
    // It also has to stay inside its own field instead of spilling out of it.
    expect(refreshBox.y).toBeGreaterThanOrEqual(searchBox.y - 0.5);
    expect(refreshBox.y + refreshBox.height).toBeLessThanOrEqual(
      searchBox.y + searchBox.height + 0.5,
    );
  }
});

test("the row detail panel closes when no row is selected", async ({
  page,
}) => {
  await openWorkbench(page);
  // The tab is labelled "Row" — #113 shortened it from "Row detail" to match
  // its single-word siblings (Plan, Lake, BI, Chat).
  await openRightSidebarView(page, "Row");

  const panel = page.locator(".row-detail");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("No row selected");

  // This was disabled without a selection, which left the panel unclosable.
  await panel.getByRole("button", { name: "Close row detail" }).click();
  await expect(panel).toHaveCount(0);
});

test("the AI provider settings toggle has a real accessible name", async ({
  page,
}) => {
  await openWorkbench(page);
  await openRightSidebarView(page, "Chat");

  await expect(
    page.getByRole("button", { name: "Provider settings" }),
  ).toBeVisible();
  // The gear glyph used to be the accessible name, because content beats title.
  await expect(
    page.getByRole("button", { name: "⚙", exact: true }),
  ).toHaveCount(0);
});
