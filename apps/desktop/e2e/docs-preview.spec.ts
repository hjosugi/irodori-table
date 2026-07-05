import { expect, test } from "@playwright/test";

// Regenerates the README workbench preview (docs/assets/irodori-table-preview.png).
// Opt-in so normal e2e runs skip it:
//   CAPTURE_PREVIEW=1 npx playwright test e2e/docs-preview.spec.ts --project=chromium
test("capture README workbench preview", async ({ page }) => {
  test.skip(!process.env.CAPTURE_PREVIEW, "docs capture is opt-in");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".cm-editor")).toBeVisible();
  // Let fonts, icons, and the dock layout settle before the shot.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1_000);

  await page.screenshot({
    path: "../../docs/assets/irodori-table-preview.png",
    fullPage: false,
  });
});
