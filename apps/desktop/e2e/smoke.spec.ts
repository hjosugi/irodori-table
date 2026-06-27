import { expect, test } from "@playwright/test";

// Errors the app raises on purpose in a plain browser: Tauri IPC is absent, so
// `invoke` rejects. The app catches these and falls back to a mock snapshot.
const ignorable = (message: string) => /tauri|invoke|__TAURI/i.test(message);

test("editor shell renders, themes, and formats", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    console.error("BROWSER PAGE ERROR:", error);
    pageErrors.push(String(error));
  });
  page.on("console", (msg) => console.log("BROWSER LOG:", msg.text()));

  await page.goto("/");

  // The shell mounts.
  await expect(page.getByLabel("Irodori Table")).toBeVisible();

  // CodeMirror starts clean by default, then highlights once text is entered.
  const content = page.locator(".cm-content");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(content).toHaveText("");
  await content.click();
  await page.keyboard.type("select 1");
  await expect(content).toContainText("select");
  await expect(content.locator("span").first()).toBeVisible();

  // The object/connection sidebar is collapsible, like a workbench side bar.
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Close sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "Show sidebar" }).click();
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
  await page.getByRole("button", { name: "Settings" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await expect(settingsDialog).toBeVisible();
  const editorModeRow = settingsDialog
    .locator(".settings-row")
    .filter({ hasText: "Editor mode" });
  await editorModeRow.locator("button").filter({ hasText: /^Vim$/ }).click();
  await expect(page.locator(".cm-vimMode")).toBeVisible();
  await settingsDialog
    .locator("button")
    .filter({ hasText: /^Default$/ })
    .click();
  await settingsDialog.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".cm-vimMode")).toHaveCount(0);

  // Theme toggle flips the shell's data-theme from the system/default value.
  const shell = page.locator(".app-shell");
  await expect(shell).toHaveAttribute("data-theme", /^(dark|light)$/);
  const initialTheme = await shell.getAttribute("data-theme");
  await page.getByRole("button", { name: "Toggle color theme" }).click();
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
    .getByRole("toolbar", { name: "Editor actions" })
    .getByRole("button", { name: "Format SQL" })
    .click();
  expect(await page.locator(".cm-line").count()).toBeGreaterThan(1);

  // No unexpected (non-Tauri) uncaught errors.
  expect(pageErrors.filter((message) => !ignorable(message))).toEqual([]);
});
