import { expect, test } from "@playwright/test";

// Removing a root-edge panel makes dockview redistribute the freed space
// proportionally, stretching the surviving sidebar. Closing the right dock grew
// the left from 260 to 618, and reopening the right then gave back 258 rather
// than its stored 320 — so the width was corrupted, not just momentarily wrong.
// localStorage held the correct values throughout, which is why persistence
// tests would not have caught this.
test("closing one dock leaves the other at its own width", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("irodori.sidebar.width.v2", "260");
    window.localStorage.setItem("irodori.inspector.width.v1", "320");
  });
  await page.goto("/");
  await page.waitForTimeout(2500);

  const toggle = {
    left: page.locator('.titlebar-control-zone [data-sidebar-toggle="left"]'),
    right: page.locator('.titlebar-control-zone [data-sidebar-toggle="right"]'),
  };
  const width = async (side: "left" | "right") => {
    const el = page.locator(`aside.sidebar-${side}`).first();
    if ((await el.count()) === 0) return null;
    const box = await el.boundingBox();
    return box ? Math.round(box.width) : null;
  };

  if ((await width("left")) === null) await toggle.left.click();
  await page.waitForTimeout(400);
  if ((await width("right")) === null) await toggle.right.click();
  await page.waitForTimeout(700);

  const leftOpen = await width("left");
  const rightOpen = await width("right");
  expect(leftOpen, "left dock did not open").not.toBeNull();
  expect(rightOpen, "right dock did not open").not.toBeNull();

  // Closing the right must not move the left.
  await toggle.right.click();
  await page.waitForTimeout(900);
  expect(await width("left")).toBeCloseTo(leftOpen as number, -1);

  // Reopening must give the right dock its own width back, not a rescaled one.
  await toggle.right.click();
  await page.waitForTimeout(900);
  expect(await width("right")).toBeCloseTo(rightOpen as number, -1);

  // And the mirror case.
  await toggle.left.click();
  await page.waitForTimeout(900);
  expect(await width("right")).toBeCloseTo(rightOpen as number, -1);
});
