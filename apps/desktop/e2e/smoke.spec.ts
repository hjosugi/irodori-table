import { expect, test } from "@playwright/test";

// Errors the app raises on purpose in a plain browser: Tauri IPC is absent, so
// `invoke` rejects. The app catches these and falls back to a mock snapshot.
const ignorable = (message: string) => /tauri|invoke|__TAURI/i.test(message);

test("editor shell renders, themes, and formats", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto("/");

  // The shell mounts.
  await expect(page.getByText("Irodori Table")).toBeVisible();

  // CodeMirror is mounted with seeded SQL and produces highlight token spans.
  const content = page.locator(".cm-content");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(content).toContainText("select");
  await expect(content.locator("span").first()).toBeVisible();

  // Theme toggle flips the shell's data-theme.
  const shell = page.locator(".app-shell");
  await expect(shell).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(shell).toHaveAttribute("data-theme", "dark");

  // Format SQL reflows a one-line statement across multiple lines.
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("select a, b from t where a = 1");
  await expect(page.locator(".cm-line")).toHaveCount(1);
  await page.getByRole("button", { name: "Format SQL" }).click();
  expect(await page.locator(".cm-line").count()).toBeGreaterThan(1);

  // No unexpected (non-Tauri) uncaught errors.
  expect(pageErrors.filter((message) => !ignorable(message))).toEqual([]);
});
