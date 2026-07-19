import { expect, type Locator, type Page, test } from "@playwright/test";

// Dragging a view's tab onto the opposite sidebar docks it there (#129). This
// drives the real HTML5 drag-and-drop path the app wires up, and asserts the
// moved tab actually renders on the far side (not just that state changed).

async function openWorkbench(page: Page) {
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 60_000 });
}

// A user drag of a `draggable` element is not reproducible with mouse events in
// headless Chromium, so dispatch the HTML5 drag sequence with one shared
// DataTransfer — the same object the browser would hand every stage of a real
// drag.
async function dragTab(page: Page, source: Locator, target: Locator) {
  const sourceHandle = await source.elementHandle();
  const targetHandle = await target.elementHandle();
  if (!sourceHandle || !targetHandle) {
    throw new Error("drag endpoints not found");
  }
  await page.evaluate(
    ([from, to]) => {
      const dataTransfer = new DataTransfer();
      const fire = (node: Element, type: string) =>
        node.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          }),
        );
      fire(from as Element, "dragstart");
      fire(to as Element, "dragenter");
      fire(to as Element, "dragover");
      fire(to as Element, "drop");
      fire(from as Element, "dragend");
    },
    [sourceHandle, targetHandle],
  );
}

test("dragging the Git tab onto the right sidebar docks it there", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openWorkbench(page);

  const leftSide = page.locator("aside.sidebar-left");
  const rightSide = page.locator("aside.sidebar-right");
  const leftGit = leftSide.getByRole("tab", { name: "Git" });
  const rightGit = rightSide.getByRole("tab", { name: "Git" });

  // Git starts on the left; open the right sidebar so it has a drop target.
  await expect(leftGit).toHaveCount(1);
  await page
    .locator('.titlebar-control-zone [data-sidebar-toggle="right"]')
    .click();
  await expect(rightSide).toBeVisible();
  const leftWidthBefore = (await leftSide.boundingBox())?.width ?? 0;

  const rightStrip = rightSide.locator(".sidebar-view-switcher");
  await dragTab(page, leftGit, rightStrip);

  // The Git tab now lives on the right, and renders in the right half of the
  // window rather than existing only in the DOM.
  await expect(rightGit).toHaveCount(1);
  await expect(leftGit).toHaveCount(0);
  const gitBox = await rightGit.boundingBox();
  expect(gitBox).not.toBeNull();
  const viewport = page.viewportSize();
  expect(gitBox!.width).toBeGreaterThan(0);
  expect(gitBox!.height).toBeGreaterThan(0);
  expect(gitBox!.x).toBeGreaterThan((viewport?.width ?? 1280) / 2);

  // An open->open move adds/removes no dock panel, so the left keeps its width
  // (the #116 redistribution bug does not apply, and must not be reintroduced).
  const leftWidthAfter = (await leftSide.boundingBox())?.width ?? 0;
  expect(Math.round(leftWidthAfter)).toBeCloseTo(
    Math.round(leftWidthBefore),
    -1,
  );

  // And back the other way.
  const leftStrip = leftSide.locator(".sidebar-view-switcher");
  await dragTab(page, rightGit, leftStrip);
  await expect(leftGit).toHaveCount(1);
  await expect(rightGit).toHaveCount(0);
});
