import { expect, test } from "@playwright/test";

// Tauri IPC is absent in the browser harness. Opening the terminal used to
// construct a Tauri Channel unconditionally, throw "Cannot read properties of
// undefined (reading 'transformCallback')", and take the entire workbench
// down to the app-root error boundary (#186). The panel must degrade to a
// clear desktop-app notice instead.
test("opening the terminal without the Tauri runtime keeps the workbench alive", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 30_000 });

  // Toggle the terminal through the command palette (same path as Ctrl+`).
  await page.keyboard.press("ControlOrMeta+Shift+P");
  const paletteInput = page.locator(".palette-input");
  await expect(paletteInput).toBeVisible();
  await paletteInput.fill("Toggle Terminal");
  await page.keyboard.press("Enter");
  await expect(paletteInput).toHaveCount(0);

  const panel = page.locator(".terminal-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("status")).toContainText(
    "The terminal requires the desktop app",
  );

  // The workbench survives: no boundary fallback, no uncaught Channel error.
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".error-boundary")).toHaveCount(0);
  expect(pageErrors.filter((m) => /transformCallback/.test(m))).toEqual([]);

  await panel.screenshot({
    path: "test-results/terminal-browser-fallback.png",
  });

  // The degraded panel can still be dismissed from its own chrome.
  await panel.getByRole("button", { name: "Close panel" }).click();
  await expect(page.locator(".terminal-panel")).toHaveCount(0);
  await expect(page.locator(".app-shell")).toBeVisible();
});
