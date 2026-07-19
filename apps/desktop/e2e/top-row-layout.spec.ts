import { expect, type Page, test } from "@playwright/test";

// The top band is three regions side by side -- the left sidebar's view tabs,
// the editor tab strip, and the right sidebar's view tabs. It has to stay one
// level row as width comes off, and the sidebars have to compact rather than
// take their content away. Tauri `invoke` rejects here and the app falls back
// to its mock snapshot, which is enough to lay the row out.

const bothSidebars = {
  "irodori.sidebar.open.v1": "true",
  "irodori.sidebar.right.open.v1": "true",
  "irodori.sidebar.width.v2": "300",
  "irodori.inspector.width.v1": "320",
};

// The legible floor from styles/base.css (--tab-min-width), less the 1px
// borders a tab draws inside it.
const TAB_LEGIBLE_FLOOR = 118;

async function openWorkbench(page: Page, seed: Record<string, string> = {}) {
  await page.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) {
      window.localStorage.setItem(key, value);
    }
  }, seed);
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(600);
}

async function openSqlTabs(page: Page, count: number) {
  const newTab = page.locator('button[title="New SQL tab"]').first();
  for (let index = 0; index < count; index += 1) {
    await newTab.click();
  }
  await page.waitForTimeout(300);
}

function boxesOverlap(
  left: { x: number; width: number },
  right: { x: number; width: number },
) {
  return left.x < right.x + right.width && left.x + left.width > right.x;
}

test.describe("ui type scale", () => {
  test("renders every element on a step of the ladder, anchored on the menu", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await openWorkbench(page, bothSidebars);

    const census = await page.evaluate(() => {
      // The editor and terminal set their own monospace metrics; the ladder
      // governs the chrome around them.
      const exempt = (element: Element) =>
        element.closest(".cm-editor, .xterm, .mermaid, svg") !== null;

      const sizes = new Map<string, string[]>();
      for (const element of document.querySelectorAll("*")) {
        if (exempt(element)) continue;
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        const rendersText = [...element.childNodes].some(
          (node) => node.nodeType === 3 && node.textContent?.trim(),
        );
        if (!rendersText) continue;
        const size = getComputedStyle(element).fontSize;
        const sample = sizes.get(size) ?? [];
        if (sample.length < 3) {
          sample.push(
            `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 30)}`,
          );
        }
        sizes.set(size, sample);
      }

      const shell = document.querySelector(".app-shell")!;
      const menuButton = document.querySelector(".menubar-item > button")!;
      return {
        sizes: [...sizes.entries()],
        base: getComputedStyle(shell).fontSize,
        menu: getComputedStyle(menuButton).fontSize,
      };
    });

    // The complaint this encodes: "if the menu text is the baseline, the rest
    // is too big". The menu is body text, so it renders at the shell default.
    expect(census.menu).toBe(census.base);
    expect(census.base).toBe("12px");

    // And nothing renders off the ladder.
    const ladder = new Set(["10px", "11px", "12px", "13px", "15px"]);
    const offLadder = census.sizes.filter(([size]) => !ladder.has(size));
    expect(offLadder).toEqual([]);
  });
});

test.describe("top row layout", () => {
  test("tabs stop shrinking at a legible width and the strip scrolls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openWorkbench(page, bothSidebars);
    await openSqlTabs(page, 16);

    const strip = page.locator(".editor-tab-strip .tab-strip-scroll");
    const metrics = await strip.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      tabWidths: [...element.querySelectorAll(".tab")].map(
        (tab) => tab.getBoundingClientRect().width,
      ),
      // The new-tab and tab-actions buttons must stay on screen rather than
      // scrolling away with the tabs.
      actionsVisible: [
        ...(element.parentElement?.querySelectorAll(
          ".tab-strip-actions button",
        ) ?? []),
      ].every((button) => {
        const box = button.getBoundingClientRect();
        return box.width > 0 && box.right <= window.innerWidth + 1;
      }),
    }));

    // An ordinary working set, not a stress case.
    expect(metrics.tabWidths.length).toBeGreaterThanOrEqual(16);

    // Every tab keeps enough width to show more than one character...
    for (const width of metrics.tabWidths) {
      expect(width).toBeGreaterThanOrEqual(TAB_LEGIBLE_FLOOR);
    }

    // ...and the overflow goes to the scroller instead of subdividing the row.
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

    // Scrolling the tabs must not carry the strip's own controls off with them.
    expect(metrics.actionsVisible).toBe(true);
  });

  test("the top row stays one level band across widths", async ({ page }) => {
    for (const width of [1536, 1280, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await openWorkbench(page, bothSidebars);
      await openSqlTabs(page, 8);

      const row = await page.evaluate(() => {
        const rect = (element: Element | null) => {
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        };
        return {
          switchers: [
            ...document.querySelectorAll(".sidebar-view-switcher"),
          ].map((switcher) => ({
            ...rect(switcher)!,
            // One row means every button shares a single top edge.
            rows: new Set(
              [...switcher.querySelectorAll("button")].map((button) =>
                Math.round(button.getBoundingClientRect().y),
              ),
            ).size,
          })),
          strip: rect(document.querySelector(".editor-tab-strip")),
        };
      });

      expect(row.switchers.length).toBeGreaterThan(0);
      expect(row.strip).not.toBeNull();

      for (const switcher of row.switchers) {
        // Never wraps to a second row, whatever the tab count and width.
        expect(switcher.rows).toBe(1);
        // Every region of the band is the same height, so the row reads level.
        expect(Math.round(switcher.height)).toBe(Math.round(row.strip!.height));
        // And no region sits on top of another.
        expect(boxesOverlap(switcher, row.strip!)).toBe(false);
      }

      for (const [index, switcher] of row.switchers.entries()) {
        for (const other of row.switchers.slice(index + 1)) {
          expect(boxesOverlap(switcher, other)).toBe(false);
        }
      }
    }
  });

  test("dragging a sidebar narrow compacts it instead of hiding it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1536, height: 900 });
    await openWorkbench(page, bothSidebars);

    const sash = page.locator(".dv-sash.dv-enabled").first();
    const box = await sash.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + box!.width / 2, 400);
    await page.mouse.down();
    for (const target of [220, 160, 100, 40]) {
      await page.mouse.move(target, 400, { steps: 4 });
    }
    await page.mouse.up();
    await page.waitForTimeout(400);

    const sidebar = page.locator("aside.sidebar").first();
    await expect(sidebar).toBeVisible();

    const compact = await sidebar.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        width: box.width,
        // Content that paints outside the panel is not a compact state, it is
        // a clipped one.
        spilling: [...element.querySelectorAll("*")].filter(
          (child) => child.getBoundingClientRect().right > box.right + 1,
        ).length,
        // The view tabs survive as icons rather than being dropped.
        viewTabs: element.querySelectorAll(".sidebar-view-switcher button")
          .length,
      };
    });

    // It got genuinely narrow...
    expect(compact.width).toBeLessThanOrEqual(140);
    // ...but it is still there, still usable, and still inside its own box.
    expect(compact.width).toBeGreaterThan(0);
    expect(compact.viewTabs).toBeGreaterThan(0);
    expect(compact.spilling).toBe(0);
  });
});
