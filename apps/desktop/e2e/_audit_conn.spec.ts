import { expect, test, type Page } from "@playwright/test";

const SHOT = "/tmp/claude-1000/-home-hsugi-ghq-github-com-hjosugi-irodori-table/fd0ef8fe-c422-4b8a-9b51-be7d16ce63b7/scratchpad";

async function boot(page: Page, locale: string) {
  await page.addInitScript((loc) => {
    window.localStorage.clear();
    window.localStorage.setItem("irodori.locale.v1", loc);
  }, locale);
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 45_000 });
}

async function accName(page: Page, selector: string, nth = 0) {
  return page.locator(selector).nth(nth).evaluate((el) => {
    // Rough accname: aria-label > aria-labelledby > <label> text > title > placeholder
    const e = el as HTMLElement;
    return {
      tag: e.tagName,
      ariaLabel: e.getAttribute("aria-label"),
      role: e.getAttribute("role"),
      title: e.getAttribute("title"),
      placeholder: e.getAttribute("placeholder"),
      labelText: e.closest("label")?.textContent?.trim() ?? null,
    };
  });
}

test("JA connection manager", async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, "ja");
  await page.locator(".connection-select").click();
  const dlg = page.locator(".connection-dialog");
  await expect(dlg).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT}/ja-conn-fields.png`, fullPage: false });

  // Field-label texts actually rendered in the form
  const labels = await dlg.locator(".connection-form-body label > span, .connection-form-body > div > span, .connection-transport span, .connection-transport strong, .form-toggle button").allTextContents();
  console.log("JA FORM LABELS:", JSON.stringify(labels));

  // Accessible-name probes
  console.log("SEARCH INPUT:", JSON.stringify(await accName(page, ".connection-search input")));
  console.log("MODE TOGGLE DIV:", JSON.stringify(await accName(page, ".mode-toggle.form-toggle")));
  const modeRole = await page.locator(".mode-toggle.form-toggle").getAttribute("role");
  console.log("mode-toggle role =", modeRole);

  // Does Playwright see an accessible name for the search box?
  const byRole = await page.getByRole("searchbox").count();
  const textboxes = await dlg.getByRole("textbox").count();
  console.log("searchbox count:", byRole, "textbox count:", textboxes);

  // switch to URL mode to catch the URL label
  await dlg.locator(".mode-toggle.form-toggle button").first().click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOT}/ja-conn-url.png` });
  console.log("URL MODE LABELS:", JSON.stringify(await dlg.locator(".connection-form-body label > span").allTextContents()));

  // sqlite engine -> different labels
  await dlg.locator(".mode-toggle.form-toggle button").nth(1).click();
  await dlg.locator("select").first().selectOption("sqlite");
  await page.waitForTimeout(300);
  console.log("SQLITE LABELS:", JSON.stringify(await dlg.locator(".connection-form-body label > span, .connection-transport strong").allTextContents()));
  await page.screenshot({ path: `${SHOT}/ja-conn-sqlite.png` });
});

test("JA empty connection list", async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, "ja");
  await page.locator(".connection-select").click();
  const dlg = page.locator(".connection-dialog");
  await expect(dlg).toBeVisible();
  // type a search that matches nothing -> empty state
  await page.locator(".connection-search input").fill("zzzzznomatch");
  await page.waitForTimeout(300);
  console.log("EMPTY TEXT (no match):", JSON.stringify(await page.locator(".connection-picker-empty").textContent()));
  await page.screenshot({ path: `${SHOT}/ja-conn-empty.png` });
});

test("JA settings tabs", async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page, "ja");
  // open settings via menubar
  await page.locator(".menubar [role=menuitem]").first().click();
  await page.waitForTimeout(200);
  const items = await page.locator("[role=menuitem]").allTextContents();
  console.log("FILE MENU:", JSON.stringify(items));
  await page.keyboard.press("Escape");

  // Fall back to the command palette / direct nav: use the settings dialog selector
  await page.locator(".menubar [role=menuitem]").first().click();
  await page.waitForTimeout(150);
  // find the settings entry by looking for a menuitem containing 設定
  const settingsItem = page.locator("[role=menuitem]").filter({ hasText: /設定|Settings/ }).last();
  await settingsItem.click();
  const dlg = page.locator(".settings-dialog");
  await expect(dlg).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);

  const navButtons = dlg.locator(".settings-nav button");
  const navNames = await navButtons.allTextContents();
  console.log("SETTINGS NAV:", JSON.stringify(navNames));

  for (let i = 0; i < (await navButtons.count()); i += 1) {
    const name = (await navButtons.nth(i).textContent())?.trim() ?? String(i);
    await navButtons.nth(i).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOT}/ja-settings-${i}-${name.replace(/[^\w一-龯ぁ-んァ-ン]/g, "")}.png` });
    // dump select option texts on this tab
    const opts = await dlg.locator("select option").allTextContents();
    if (opts.length) console.log(`TAB ${i} (${name}) OPTIONS:`, JSON.stringify(opts.slice(0, 25)));
  }

  // JSON tab textarea accessible name
  await dlg.locator(".settings-nav button").last().click();
  await page.waitForTimeout(400);
  console.log("JSON TEXTAREA:", JSON.stringify(await accName(page, ".settings-json textarea")));
  const taName = await page.locator(".settings-json textarea").evaluate((el) => {
    const t = el as HTMLTextAreaElement;
    return { labels: t.labels?.length ?? 0, ariaLabel: t.getAttribute("aria-label"), id: t.id };
  });
  console.log("JSON TEXTAREA LABELS:", JSON.stringify(taName));
});

test("JA extensions tab", async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page, "ja");
  await page.locator(".menubar [role=menuitem]").first().click();
  await page.waitForTimeout(150);
  await page.locator("[role=menuitem]").filter({ hasText: /設定|Settings/ }).last().click();
  const dlg = page.locator(".settings-dialog");
  await expect(dlg).toBeVisible({ timeout: 10_000 });
  const extBtn = dlg.locator(".settings-nav button").filter({ hasText: /拡張|Extension/ });
  await extBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT}/ja-ext-top.png` });

  const sectionHeaders = await dlg.locator(".extension-section-header").allTextContents();
  console.log("EXT SECTIONS:", JSON.stringify(sectionHeaders));
  const empties = await dlg.locator(".extension-empty").allTextContents();
  console.log("EXT EMPTIES:", JSON.stringify(empties));
  const note = await dlg.locator(".extension-store-note").textContent();
  console.log("EXT STORE NOTE:", JSON.stringify(note));
  const runtimeNotice = await dlg.locator(".extension-runtime-notice").textContent();
  console.log("EXT RUNTIME NOTICE:", JSON.stringify(runtimeNotice));

  // first few marketplace item metas + action labels
  const metas = await dlg.locator(".extension-item .extension-meta").allTextContents();
  console.log("EXT METAS (first 5):", JSON.stringify(metas.slice(0, 5)));
  const actions = await dlg.locator(".extension-item .extension-actions .text-button").allTextContents();
  console.log("EXT ACTIONS (first 8):", JSON.stringify(actions.slice(0, 8)));

  // scroll to recommended section
  const sections = dlg.locator(".extension-section");
  const count = await sections.count();
  console.log("section count:", count);
  if (count > 0) {
    await sections.nth(count - 1).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT}/ja-ext-recommended.png` });
    console.log("LAST SECTION TEXT:", JSON.stringify((await sections.nth(count - 1).textContent())?.slice(0, 400)));
  }
});

test("EN settings + overflow probes", async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page, "en");
  await page.locator(".connection-select").click();
  const dlg = page.locator(".connection-dialog");
  await expect(dlg).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOT}/en-conn.png` });

  // Overflow probe: put a very long value in the name + host and see if it clips
  await dlg.locator(".connection-form-body input").first().fill(
    "Production analytics replica in eu-central-1 for the finance data platform",
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOT}/en-conn-longname.png` });
  const header = dlg.locator(".dialog-header strong");
  const ov = await header.evaluate((el) => ({
    scrollW: el.scrollWidth,
    clientW: el.clientWidth,
    text: el.textContent,
    overflow: getComputedStyle(el).overflow,
    textOverflow: getComputedStyle(el).textOverflow,
    title: el.getAttribute("title"),
  }));
  console.log("HEADER OVERFLOW:", JSON.stringify(ov));

  // profile list item overflow
  const item = dlg.locator(".connection-profile small").first();
  if (await item.count()) {
    console.log("PROFILE SMALL:", JSON.stringify(await item.evaluate((el) => ({
      scrollW: el.scrollWidth, clientW: el.clientWidth, text: el.textContent,
    }))));
  }

  // footer buttons: enabled/disabled state
  const footer = await dlg.locator(".dialog-footer button").evaluateAll((els) =>
    els.map((e) => ({ text: e.textContent?.trim(), disabled: (e as HTMLButtonElement).disabled, title: e.getAttribute("title") })),
  );
  console.log("FOOTER BUTTONS:", JSON.stringify(footer));
});
