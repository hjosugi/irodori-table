import { expect, type Page, test } from "@playwright/test";

const SHOT = "e2e/_sweep-shots";

async function openWorkbench(page: Page, locale?: string) {
  if (locale) {
    await page.addInitScript((value) => {
      window.localStorage.setItem("irodori.locale.v1", value);
    }, locale);
  }
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 30_000 });
}

async function runMenuCommand(page: Page, menu: string, command: string | RegExp) {
  await page
    .getByRole("menubar", { name: /Application menu|アプリケーションメニュー/ })
    .getByRole("menuitem", { name: menu })
    .click();
  await page.getByRole("menuitem", { name: command }).click();
}

test("dump menubar structure", async ({ page }) => {
  await openWorkbench(page);
  const menubar = page.getByRole("menubar");
  const tops = menubar.getByRole("menuitem");
  const count = await tops.count();
  const structure: Record<string, string[]> = {};
  for (let i = 0; i < count; i += 1) {
    const label = (await tops.nth(i).textContent())?.trim() ?? `#${i}`;
    await tops.nth(i).click();
    await page.waitForTimeout(120);
    const items = await page.getByRole("menuitem").allTextContents();
    structure[label] = items.map((s) => s.trim()).filter(Boolean);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(60);
  }
  console.log("MENUBAR=" + JSON.stringify(structure, null, 1));
});

test("query history default is disabled on a fresh profile", async ({ page }) => {
  await openWorkbench(page);
  const state = await page.evaluate(() => {
    const raw = window.localStorage.getItem("irodori.queryHistory.maxItems.v1");
    const stored = Number(raw);
    return {
      rawMaxItems: raw,
      rawResultRows: window.localStorage.getItem(
        "irodori.queryHistory.resultRows.v1",
      ),
      numberOfNull: stored,
      isFinite: Number.isFinite(stored),
    };
  });
  console.log("HISTORY_STATE=" + JSON.stringify(state));
});

const surfaces = [
  { name: "erd", menu: "View", item: /Diagram|ER|Schema Diagram/i },
  { name: "migration", menu: "Tools", item: /Migration/i },
  { name: "history", menu: "View", item: /History/i },
];

test("screenshot feature surfaces (en)", async ({ page }) => {
  await openWorkbench(page);
  await page.screenshot({ path: `${SHOT}/00-shell-en.png`, fullPage: false });

  // sidebar views: knowledge, search, ai chat, git
  const railButtons = await page.getByRole("tab").allTextContents();
  console.log("TABS=" + JSON.stringify(railButtons));
  const buttons = await page.getByRole("button").allTextContents();
  console.log(
    "BUTTONS=" + JSON.stringify(buttons.map((b) => b.trim()).filter(Boolean)),
  );
});

test("screenshot feature surfaces (ja)", async ({ page }) => {
  await openWorkbench(page, "ja");
  await page.screenshot({ path: `${SHOT}/00-shell-ja.png`, fullPage: false });
  const buttons = await page.getByRole("button").allTextContents();
  console.log(
    "JA_BUTTONS=" + JSON.stringify(buttons.map((b) => b.trim()).filter(Boolean)),
  );
});
