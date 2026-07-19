import { expect, test } from "@playwright/test";

// The tab menu is position:fixed, but dockview's .dv-render-overlay sets
// transform/contain/will-change and so becomes the containing block for fixed
// descendants. Coordinates measured against the viewport therefore resolved
// against the dock panel, offsetting the menu by the panel's left edge — and
// with enough tabs open the "..." sits far enough right that the menu landed
// past the window edge and nothing appeared. Asserting the menu exists in the
// DOM would have passed the whole time; this asserts where it actually lands.
test("tab actions menu opens inside the viewport, next to its button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.waitForTimeout(2000);

  // Open enough tabs to push the "..." button toward the right edge, which is
  // the case that failed outright.
  const addTab = page.getByRole("button", { name: "New SQL tab" }).first();
  for (let i = 0; i < 8; i += 1) {
    await addTab.click();
    await page.waitForTimeout(60);
  }

  const trigger = page.getByRole("button", { name: "Tab actions" }).first();
  const triggerBox = await trigger.boundingBox();
  await trigger.click();

  const menu = page.locator(".editor-tab-menu");
  await expect(menu).toBeVisible();

  const box = await menu.boundingBox();
  expect(box, "menu has no box").not.toBeNull();
  if (!box || !triggerBox) return;

  // Inside the window on both axes.
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  expect(box.y + box.height).toBeLessThanOrEqual(800);

  // Anchored to its button rather than drifting by the dock panel's offset,
  // which measured 244px with the sidebar open.
  expect(Math.abs(box.x - triggerBox.x)).toBeLessThan(200);

  await expect(menu.locator("[role='menuitem']").first()).toBeVisible();
});
