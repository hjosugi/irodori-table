import { expect, type Page, test } from "@playwright/test";
import {
  connectMockDatabase,
  installMultiResultMock,
  runFixtureQuery,
} from "./support/multi-result-mock";

// SCRATCH AUDIT SPEC — delete when the audit is done.

const SHOT = "/tmp/claude-1000/-home-hsugi-ghq-github-com-hjosugi-irodori-table/fd0ef8fe-c422-4b8a-9b51-be7d16ce63b7/scratchpad";

// Set the persisted locale. Must be added AFTER installMultiResultMock, whose
// own init script clears localStorage.
async function setLocale(page: Page, locale: string) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("irodori.locale.v1", value);
  }, locale);
}

test("A: terminal panel under ja locale", async ({ page }) => {
  await installMultiResultMock(page);
  await setLocale(page, "ja");
  await page.goto("/");
  await expect(page.locator(".cm-editor")).toBeVisible();

  // Ctrl+` toggles the terminal dock.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+`");
  await expect(page.locator(".terminal-panel")).toBeVisible();

  // Add a second tab so tab-switching is exercised.
  await page.getByRole("button", { name: "New terminal" }).click();
  await expect(page.locator(".terminal-tab")).toHaveCount(2);

  await page.locator(".terminal-panel").screenshot({
    path: `${SHOT}/A-terminal-ja.png`,
  });

  // What are the tab labels / accessible names under ja?
  const labels = await page.locator(".terminal-tab").allTextContents();
  const closeNames = await page
    .locator(".terminal-tab-close")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  const actionNames = await page
    .locator(".terminal-action")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  console.log("AUDIT terminal tab labels:", JSON.stringify(labels));
  console.log("AUDIT terminal close aria-labels:", JSON.stringify(closeNames));
  console.log("AUDIT terminal action aria-labels:", JSON.stringify(actionNames));

  // Is the tab itself keyboard reachable / activatable?
  const tabA11y = await page.locator(".terminal-tab").evaluateAll((els) =>
    els.map((e) => ({
      tag: e.tagName,
      role: e.getAttribute("role"),
      tabindex: e.getAttribute("tabindex"),
      ariaSelected: e.getAttribute("aria-selected"),
      hasOnClick: true,
    })),
  );
  console.log("AUDIT terminal tab element a11y:", JSON.stringify(tabA11y));

  // Walk the focus order through the terminal panel and record what is reachable.
  await page.locator(".terminal-panel").click({ position: { x: 5, y: 5 } });
  const focusOrder: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return "none";
      return `${el.tagName}.${el.className || ""}[${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20) ?? ""}]`;
    });
    focusOrder.push(info);
  }
  console.log("AUDIT terminal focus order:", JSON.stringify(focusOrder, null, 1));
});

test("B: results pane + result tabs under ja locale", async ({ page }) => {
  await installMultiResultMock(page);
  await setLocale(page, "ja");
  await page.goto("/");

  await connectMockDatabase(page);
  await runFixtureQuery(page);

  await expect(page.locator(".result-grid")).toBeVisible();
  await page.locator(".results-pane").screenshot({
    path: `${SHOT}/B-results-ja.png`,
  });
  await page.screenshot({ path: `${SHOT}/B-full-ja.png` });

  // Accessible name of the result-set tablist.
  const tablistName = await page
    .locator(".result-tabs")
    .getAttribute("aria-label");
  console.log("AUDIT result tablist aria-label:", JSON.stringify(tablistName));

  const headerText = await page.locator(".results-header").innerText();
  console.log("AUDIT results-header text:", JSON.stringify(headerText));

  // Export / copy split-button titles.
  const titles = await page
    .locator(".results-actions button")
    .evaluateAll((els) =>
      els.map((e) => ({
        text: e.textContent?.trim(),
        title: e.getAttribute("title"),
        aria: e.getAttribute("aria-label"),
      })),
    );
  console.log("AUDIT results action buttons:", JSON.stringify(titles, null, 1));
});

test("C: query history dialog under ja locale", async ({ page }) => {
  await installMultiResultMock(page);
  await setLocale(page, "ja");
  await page.goto("/");

  await connectMockDatabase(page);
  await runFixtureQuery(page);

  // Open the history dialog through the sidebar's expand button if present,
  // else through the command palette.
  const openBtn = page.locator('.history-list, .history-search').first();
  if ((await openBtn.count()) === 0) {
    await page.keyboard.press("Control+Shift+P");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT}/C-palette.png` });
  }

  await page.screenshot({ path: `${SHOT}/C-before.png`, fullPage: false });

  // Directly drive the history store's openDialog via the sidebar button.
  const expand = page.locator('.section-heading-actions button').first();
  console.log("AUDIT sidebar expand buttons:", await expand.count());

  await page.waitForTimeout(200);
  const dialog = page.locator(".history-dialog");
  if ((await dialog.count()) === 0) {
    // Try the History section in the sidebar.
    const historyOpen = page.getByRole("button", { name: /履歴|history/i });
    console.log("AUDIT history buttons found:", await historyOpen.count());
    for (let i = 0; i < (await historyOpen.count()); i += 1) {
      const n = await historyOpen.nth(i).getAttribute("aria-label");
      console.log("  history btn", i, JSON.stringify(n));
    }
  }
});
