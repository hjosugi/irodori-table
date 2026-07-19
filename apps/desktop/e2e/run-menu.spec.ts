import { expect, test } from "@playwright/test";

// The run control sits at the bottom edge of .workbench-dock-panel.editor,
// which is overflow:hidden. Rendered in place, the options menu opened
// correctly by every state measure — aria-expanded true, opacity 1, z-index 25 —
// but its box began 3px below the panel's bottom edge, so the panel clipped
// every pixel and the caret looked dead. Asserting aria-expanded would not have
// caught it; this asserts what the user actually gets.
test("run options menu is visible and clickable, not clipped by the editor pane", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForTimeout(2000);

  await page.locator(".run-menu-toggle").first().click();

  const menu = page.locator(".run-menu-portal [role='menu']");
  await expect(menu).toBeVisible();

  const clip = await page.evaluate(() => {
    const m = document.querySelector(
      ".run-menu-portal [role='menu']",
    ) as HTMLElement | null;
    if (!m) return "NO_MENU";
    const r = m.getBoundingClientRect();
    let el: HTMLElement | null = m.parentElement;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      if (s.overflow !== "visible") {
        const er = el.getBoundingClientRect();
        if (r.top >= er.bottom || r.bottom <= er.top) {
          return `clipped by ${el.className}`;
        }
      }
      el = el.parentElement;
    }
    return r.bottom > 0 && r.top < window.innerHeight ? "visible" : "offscreen";
  });
  expect(clip).toBe("visible");

  await expect(menu.locator("[role='menuitem']").first()).toBeVisible();
});
