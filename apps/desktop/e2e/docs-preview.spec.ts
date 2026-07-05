import { expect, test } from "@playwright/test";
import {
  connectMockDatabase,
  installMultiResultMock,
  runFixtureQuery,
} from "./support/multi-result-mock";

// Regenerates the README workbench preview (docs/assets/irodori-table-preview.png)
// showing a connected workspace with results and the Row Detail right sidebar.
// Opt-in so normal e2e runs skip it:
//   CAPTURE_PREVIEW=1 npx playwright test e2e/docs-preview.spec.ts --project=chromium
test("capture README workbench preview", async ({ page }) => {
  test.skip(!process.env.CAPTURE_PREVIEW, "docs capture is opt-in");

  await page.setViewportSize({ width: 1440, height: 900 });
  await installMultiResultMock(page);
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 30_000 });

  await connectMockDatabase(page);
  await runFixtureQuery(page);
  await page.locator(".grid-row [role='cell']").first().click();
  await expect(
    page.locator(".sidebar.sidebar-right .row-detail"),
  ).toBeVisible();

  // Let the connect/query toasts expire and fonts settle before the shot.
  await expect(page.locator(".action-toast")).toHaveCount(0, {
    timeout: 15_000,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  await page.screenshot({
    path: "../../docs/assets/irodori-table-preview.png",
    fullPage: false,
  });
});
