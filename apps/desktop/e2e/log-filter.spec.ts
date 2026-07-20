import { expect, type Page, test } from "@playwright/test";

// Log-buffer level/regex filtering (issue #177, tier 2). This drives the Vite
// frontend only: Tauri IPC is absent, `invoke` rejects, and the app falls back
// to its mock snapshot. Renaming a tab to `app.log` routes the buffer to the
// log language, which shows the filter bar above the editor.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const logFixture = [
  "2026-07-18 10:00:00 INFO service started",
  "2026-07-18 10:00:01 DEBUG cache warmed",
  "2026-07-18 10:00:02 ERROR request failed",
  "    at example.handler (handler.js:10)",
  "2026-07-18 10:00:03 WARN slow response",
].join("\n");

async function openLogTab(page: Page) {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await expect(page.locator(".cm-editor").first()).toBeVisible();

  // Rename the active tab to a .log name via the tab context menu; the
  // rename prompt is a plain window.prompt.
  page.once("dialog", (dialog) => void dialog.accept("app.log"));
  await page
    .getByRole("tab", { name: "scratch.sql" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename tab" }).click();
  await expect(page.getByRole("group", { name: "Log filters" })).toBeVisible();

  // Replace the seeded SQL with the log fixture.
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(logFixture);
  await expect(page.locator(".cm-content")).toContainText("service started");
}

test("level filter hides entries below the minimum, keeping stack traces", async ({
  page,
}) => {
  await openLogTab(page);

  await page.getByRole("button", { name: "ERROR" }).click();
  await expect(page.locator(".cm-content")).not.toContainText("cache warmed");
  await expect(page.locator(".cm-content")).not.toContainText("slow response");
  await expect(page.locator(".cm-content")).toContainText("request failed");
  // The stack-trace continuation belongs to the ERROR entry and stays.
  await expect(page.locator(".cm-content")).toContainText("example.handler");
  await expect(page.getByText("3 lines hidden")).toBeVisible();

  // The document is untouched: select-all copy still yields every line.
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(logFixture);

  await page.getByRole("button", { name: "Clear log filters" }).click();
  await expect(page.locator(".cm-content")).toContainText("cache warmed");
});

test("regex filter composes with the level filter and clears on Escape", async ({
  page,
}) => {
  await openLogTab(page);
  const pattern = page.getByRole("textbox", {
    name: "Filter log entries (regex)",
  });

  await pattern.fill("cache|slow");
  await expect(page.locator(".cm-content")).toContainText("cache warmed");
  await expect(page.locator(".cm-content")).toContainText("slow response");
  await expect(page.locator(".cm-content")).not.toContainText(
    "service started",
  );
  await expect(page.locator(".cm-content")).not.toContainText("request failed");
  await expect(page.getByText("3 lines hidden")).toBeVisible();

  // Composing with a minimum level of ERROR leaves nothing visible.
  await page.getByRole("button", { name: "ERROR" }).click();
  await expect(page.getByText("5 lines hidden")).toBeVisible();
  await expect(page.locator(".cm-content")).not.toContainText("cache warmed");

  // Escape clears the text filter only; the level filter stays put.
  await pattern.press("Escape");
  await expect(pattern).toHaveValue("");
  await expect(page.locator(".cm-content")).toContainText("request failed");
  await expect(page.getByText("3 lines hidden")).toBeVisible();
});
