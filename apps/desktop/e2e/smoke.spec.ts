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
  await expect(page.getByText("Irodori Table")).toBeVisible();

  // CodeMirror is mounted with seeded SQL and produces highlight token spans.
  const content = page.locator(".cm-content");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(content).toContainText("select");
  await expect(content.locator("span").first()).toBeVisible();

  // The object/connection sidebar is collapsible, like a workbench side bar.
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();

  // Vim mode can be toggled on/off without remounting the editor.
  const keymapToggle = page.getByRole("button", { name: "Keymap" });
  await expect(keymapToggle).toHaveAttribute("aria-pressed", "false");
  await keymapToggle.click();
  const vimToggle = page.getByRole("button", { name: "Vim" });
  await expect(vimToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cm-vimMode")).toBeVisible();
  await vimToggle.click();
  await expect(page.getByRole("button", { name: "Keymap" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // Theme toggle flips the shell's data-theme.
  const shell = page.locator(".app-shell");
  await expect(shell).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(shell).toHaveAttribute("data-theme", "light");

  // Format SQL reflows a one-line statement across multiple lines.
  await content.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("select a, b from t where a = 1");
  await expect(page.locator(".cm-line")).toHaveCount(1);
  await page.locator(".toolbar").getByRole("button", { name: "Format SQL" }).click();
  expect(await page.locator(".cm-line").count()).toBeGreaterThan(1);

  // No unexpected (non-Tauri) uncaught errors.
  expect(pageErrors.filter((message) => !ignorable(message))).toEqual([]);
});
