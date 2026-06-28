import { expect, type Page, test } from "@playwright/test";

// Errors the app raises on purpose in a plain browser: Tauri IPC is absent, so
// `invoke` rejects. The app catches these and falls back to a mock snapshot.
const ignorable = (message: string) => /tauri|invoke|__TAURI/i.test(message);

async function runMenuCommand(
  page: Page,
  menuName: string,
  commandName: string | RegExp,
) {
  await page
    .getByRole("navigation", { name: "Application menu" })
    .getByRole("button", { name: menuName })
    .click();
  await page.getByRole("menuitem", { name: commandName }).click();
}

async function openWorkbench(page: Page) {
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 30_000 });
}

async function expectTitlebarConnectionCentered(page: Page) {
  const titlebar = page.locator(".titlebar");
  const connection = page.locator(".titlebar-connection");
  const menubar = page.locator(".menubar");
  const layoutButtons = page.locator(".titlebar-control-zone .icon-button");
  await expect(titlebar).toBeVisible();
  await expect(connection).toBeVisible();

  const titlebarBox = await titlebar.boundingBox();
  const connectionBox = await connection.boundingBox();
  expect(titlebarBox).toBeTruthy();
  expect(connectionBox).toBeTruthy();

  const titlebarCenter = titlebarBox!.x + titlebarBox!.width / 2;
  const connectionCenter = connectionBox!.x + connectionBox!.width / 2;
  expect(Math.abs(titlebarCenter - connectionCenter)).toBeLessThanOrEqual(4);
  expect(connectionBox!.x).toBeGreaterThanOrEqual(titlebarBox!.x);
  expect(connectionBox!.x + connectionBox!.width).toBeLessThanOrEqual(
    titlebarBox!.x + titlebarBox!.width,
  );

  const overlaps = (
    left: NonNullable<typeof connectionBox>,
    right: NonNullable<typeof connectionBox>,
  ) =>
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
  const menubarBox = await menubar.boundingBox();
  if (menubarBox) {
    expect(overlaps(connectionBox!, menubarBox)).toBe(false);
  }
  for (let index = 0; index < (await layoutButtons.count()); index += 1) {
    const buttonBox = await layoutButtons.nth(index).boundingBox();
    if (buttonBox) {
      expect(overlaps(connectionBox!, buttonBox)).toBe(false);
    }
  }
}

test("editor shell renders, themes, and formats", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    console.error("BROWSER PAGE ERROR:", error);
    pageErrors.push(String(error));
  });
  page.on("console", (msg) => console.log("BROWSER LOG:", msg.text()));

  await openWorkbench(page);

  // The shell mounts.
  await expect(page.locator(".app-shell")).toBeVisible();

  // CodeMirror starts clean by default, then highlights once text is entered.
  const content = page.locator(".cm-content");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(content).toHaveText("");
  await content.click();
  await page.keyboard.type("select 1");
  await expect(content).toContainText("select");
  await expect(content.locator("span").first()).toBeVisible();

  // Query actions belong in the top toolbar, not as floating editor chrome.
  const queryToolbar = page.locator(".query-toolbar");
  await expect(queryToolbar).toBeVisible();
  await expect(page.getByRole("button", { name: "Run All" })).toHaveCount(0);
  const toolbarBox = await queryToolbar.boundingBox();
  const editorBox = await page.locator(".editor-pane").boundingBox();
  expect(toolbarBox).toBeTruthy();
  expect(editorBox).toBeTruthy();
  expect(toolbarBox!.y + toolbarBox!.height).toBeLessThanOrEqual(
    editorBox!.y + 1,
  );

  // The object/connection sidebar is collapsible, like a workbench side bar.
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Hide left sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "Show left sidebar" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  const leftSidebarButton = page.locator(
    '.titlebar-control-zone [data-sidebar-toggle="left"]',
  );
  const rightSidebarButton = page.locator(
    '.titlebar-control-zone [data-sidebar-toggle="right"]',
  );
  await expect(leftSidebarButton).toHaveClass(/active/);
  await expect(rightSidebarButton).not.toHaveClass(/active/);
  const activeLayoutBackground = await leftSidebarButton.evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );
  const inactiveLayoutBackground = await rightSidebarButton.evaluate(
    (node) => getComputedStyle(node).backgroundColor,
  );
  expect(activeLayoutBackground).not.toEqual(inactiveLayoutBackground);
  await rightSidebarButton.click();
  await expect(rightSidebarButton).toHaveClass(/active/);
  await expect(page.locator(".sidebar.sidebar-right")).toBeVisible();
  await rightSidebarButton.click();
  await expect(rightSidebarButton).not.toHaveClass(/active/);
  await page.getByRole("button", { name: "Close sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "Show left sidebar" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();

  // Sidebar views switch like a workbench rather than showing every pane at once.
  await page.getByRole("tab", { name: "Completion" }).click();
  await expect(page.locator(".sidebar .completion-list")).toBeVisible();
  await expect(page.locator(".sidebar .history-list")).toHaveCount(0);
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.locator(".sidebar .history-list")).toBeVisible();
  await expect(page.locator(".sidebar .completion-list")).toHaveCount(0);
  await page.getByRole("tab", { name: "Tables" }).click();
  await expect(page.locator(".object-browser")).toBeVisible();

  // Vim mode can be toggled on/off without remounting the editor.
  await runMenuCommand(page, "File", "Open Settings");
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await expect(settingsDialog).toBeVisible();
  const editorModeRow = settingsDialog
    .locator(".settings-row")
    .filter({ hasText: "Editor mode" });
  await editorModeRow.locator("button").filter({ hasText: /^Vim$/ }).click();
  await expect(page.locator(".cm-vimMode")).toBeVisible();
  await expect(
    settingsDialog.getByText("Vim shortcut adjustments"),
  ).toBeVisible();
  await settingsDialog
    .getByRole("button", { name: "General", exact: true })
    .click();
  await settingsDialog
    .locator("button")
    .filter({ hasText: /^Default$/ })
    .click();
  await settingsDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.locator(".cm-vimMode")).toHaveCount(0);

  // About stays informational; preferences live in Settings/menu entry points.
  await runMenuCommand(page, "Help", "About Irodori Table");
  const aboutDialog = page.getByRole("dialog", { name: "About Irodori Table" });
  await expect(aboutDialog).toBeVisible();
  await expect(
    aboutDialog.getByRole("button", { name: "Settings" }),
  ).toHaveCount(0);
  await expect(
    aboutDialog.getByRole("button", { name: "Copy diagnostics" }),
  ).toBeVisible();
  await aboutDialog.getByRole("button", { name: "Close" }).click();
  await expect(aboutDialog).toHaveCount(0);

  // Theme toggle flips the shell's data-theme from the system/default value.
  const shell = page.locator(".app-shell");
  await expect(shell).toHaveAttribute("data-theme", /^(dark|light)$/);
  const initialTheme = await shell.getAttribute("data-theme");
  await runMenuCommand(
    page,
    "Tools",
    initialTheme === "dark" ? "Light Theme" : "Dark Theme",
  );
  await expect(shell).toHaveAttribute(
    "data-theme",
    initialTheme === "dark" ? "light" : "dark",
  );

  // Format SQL reflows a one-line statement across multiple lines.
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("select a, b from t where a = 1");
  await expect(page.locator(".cm-line")).toHaveCount(1);
  await page
    .getByRole("toolbar", { name: "SQL query actions" })
    .getByRole("button", { name: "Format SQL", exact: true })
    .click();
  expect(await page.locator(".cm-line").count()).toBeGreaterThan(1);

  // No unexpected (non-Tauri) uncaught errors.
  expect(pageErrors.filter((message) => !ignorable(message))).toEqual([]);
});

test("titlebar connection selector stays centered responsively", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1536, height: 900 },
    { width: 1280, height: 720 },
    { width: 900, height: 720 },
    { width: 640, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await openWorkbench(page);
    await expectTitlebarConnectionCentered(page);
  }
});
