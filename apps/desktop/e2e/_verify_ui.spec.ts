import { expect, type Page, test } from "@playwright/test";

const SHOT =
  "/tmp/claude-1000/-home-hsugi-ghq-github-com-hjosugi-irodori-table/fd0ef8fe-c422-4b8a-9b51-be7d16ce63b7/scratchpad/shots";

async function openWorkbench(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
}

test("D1 find the containing-block culprit for fixed popovers", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openWorkbench(page);

  await page.getByRole("button", { name: "Tab actions" }).click();
  await expect(page.locator(".editor-tab-menu")).toBeVisible();

  const chain = await page.evaluate(() => {
    const menu = document.querySelector(".editor-tab-menu") as HTMLElement;
    const out: string[] = [];
    let node: HTMLElement | null = menu.parentElement;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      const creates =
        cs.transform !== "none" ||
        cs.perspective !== "none" ||
        cs.filter !== "none" ||
        cs.backdropFilter !== "none" ||
        (cs.willChange !== "auto" &&
          /transform|perspective|filter/.test(cs.willChange)) ||
        cs.contain.includes("paint") ||
        cs.contain.includes("layout") ||
        cs.contain.includes("strict") ||
        cs.contain.includes("content") ||
        cs.containerType !== "normal";
      const r = node.getBoundingClientRect();
      out.push(
        `${creates ? ">>> CONTAINING BLOCK <<< " : ""}${node.tagName.toLowerCase()}.${node.className
          ?.toString()
          .slice(0, 55)} | x=${Math.round(r.x)} | transform=${cs.transform} | contain=${cs.contain} | containerType=${cs.containerType} | filter=${cs.filter} | willChange=${cs.willChange} | backdrop=${cs.backdropFilter}`,
      );
      node = node.parentElement;
    }
    return out.join("\n");
  });
  console.log("=== ANCESTOR CHAIN OF .editor-tab-menu ===\n" + chain);

  // Which other fixed-position popovers live under the same subtree?
  const shared = await page.evaluate(() => {
    const names = [
      ".editor-context-menu",
      ".workbench-context-menu",
      ".lakehouse-context-menu",
      ".object-action-menu",
      ".menubar-popover",
    ];
    return names.map((n) => `${n}: ${document.querySelectorAll(n).length} present`).join("\n");
  });
  console.log("=== OTHER POPOVERS PRESENT NOW ===\n" + shared);
});

test("D2 right-click tab context menu has the same offset", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openWorkbench(page);

  const tab = page.locator(".editor-tab-strip .tab-select").first();
  const tb = await tab.boundingBox();
  await tab.click({ button: "right" });
  await page.waitForTimeout(300);
  const menu = page.locator(".editor-tab-menu");
  const vis = await menu.isVisible().catch(() => false);
  const mb = vis ? await menu.boundingBox() : null;
  console.log(
    "RIGHT-CLICK TAB: tabBox=", JSON.stringify(tb),
    "menuVisible=", vis, "menuBox=", JSON.stringify(mb),
  );
  await page.screenshot({ path: `${SHOT}/d2-tab-contextmenu.png` });

  // Editor right-click context menu, for comparison.
  await page.keyboard.press("Escape");
  const cm = page.locator(".cm-content");
  const cb = await cm.boundingBox();
  await cm.click({ button: "right", position: { x: 60, y: 40 } });
  await page.waitForTimeout(300);
  const ecm = page.locator(".editor-context-menu");
  const evis = await ecm.isVisible().catch(() => false);
  const eb = evis ? await ecm.boundingBox() : null;
  console.log(
    "RIGHT-CLICK EDITOR: editorBox=", JSON.stringify(cb),
    "expected~x=", (cb?.x ?? 0) + 60, "menuVisible=", evis, "menuBox=", JSON.stringify(eb),
  );
  await page.screenshot({ path: `${SHOT}/d2-editor-contextmenu.png` });
});

test("D3 menu offset scales with sidebar width", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openWorkbench(page);

  const measure = async (label: string) => {
    const dots = page.getByRole("button", { name: "Tab actions" });
    await dots.click();
    await page.waitForTimeout(250);
    const db = await dots.boundingBox();
    const mb = await page.locator(".editor-tab-menu").boundingBox().catch(() => null);
    console.log(
      `${label}: dots.x=${db?.x?.toFixed(0)} menu.x=${mb?.x?.toFixed(0)} offset=${
        mb && db ? (mb.x - db.x).toFixed(0) : "n/a"
      }`,
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  };

  await measure("sidebar SHOWN ");
  await page.getByRole("button", { name: "Hide left sidebar" }).click();
  await page.waitForTimeout(400);
  await measure("sidebar HIDDEN");
  await page.getByRole("button", { name: "Show left sidebar" }).click();
  await page.waitForTimeout(400);
  await measure("sidebar SHOWN ");
});
