import { expect, type Page, test } from "@playwright/test";

// Errors the app raises on purpose in a plain browser: Tauri IPC is absent, so
// `invoke` rejects. The app catches these and falls back to a mock snapshot.
const ignorable = (message: string) => /tauri|invoke|__TAURI/i.test(message);

async function editorText(page: Page) {
  return (await page.locator(".cm-line").allTextContents()).join("\n");
}

async function replaceEditorText(page: Page, text: string) {
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(text);
  await expect.poll(() => editorText(page)).toBe(text);
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: /Open Settings/ }).click();
}

test("Vim mode handles insert, normal-mode delete, and cleanly toggles off", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    console.error("BROWSER PAGE ERROR:", error);
    pageErrors.push(String(error));
  });

  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");

  const content = page.locator(".cm-content");
  await expect(page.getByLabel("Irodori Table")).toBeVisible();
  await expect(page.locator(".cm-editor")).toBeVisible();

  await replaceEditorText(page, "select alpha;\nselect beta;\nselect gamma;");

  await openSettings(page);
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await expect(settingsDialog).toBeVisible();
  const editorModeRow = settingsDialog
    .locator(".settings-row")
    .filter({ hasText: "Editor mode" });
  await editorModeRow.locator("button").filter({ hasText: /^Vim$/ }).click();
  await settingsDialog.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".cm-vimMode")).toBeVisible();

  await content.locator(".cm-line").first().click({ position: { x: 1, y: 8 } });
  await page.keyboard.press("Escape");
  await page.keyboard.press("i");
  await page.keyboard.type("-- inserted in vim\n");
  await expect.poll(() => editorText(page)).toBe(
    "-- inserted in vim\nselect alpha;\nselect beta;\nselect gamma;",
  );

  await page.keyboard.press("Escape");
  await page.keyboard.press("j");
  await page.keyboard.press("d");
  await page.keyboard.press("d");
  await expect.poll(() => editorText(page)).toBe(
    "-- inserted in vim\nselect alpha;\nselect gamma;",
  );

  await openSettings(page);
  await expect(settingsDialog).toBeVisible();
  await settingsDialog
    .locator("button")
    .filter({ hasText: /^Default$/ })
    .click();
  await settingsDialog.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".cm-vimMode")).toHaveCount(0);

  await replaceEditorText(page, "select 42 as answer;");
  await expect.poll(() => editorText(page)).toBe("select 42 as answer;");

  expect(pageErrors.filter((message) => !ignorable(message))).toEqual([]);
});
