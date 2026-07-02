import { expect, test } from "@playwright/test";

const SQL = [
  "select",
  "  u.id, u.email, u.created_at,",
  "  count(o.id) as orders,",
  "  sum(o.total) as revenue",
  "from public.users u",
  "left join public.orders o on o.user_id = u.id",
  "where u.created_at >= :start_date",
  "group by 1, 2, 3",
  "order by revenue desc",
  "limit 100;",
].join("\n");

type Box = { top: number; height: number; text: string };

async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const editor = document.querySelector(".cm-editor");
    if (!editor) {
      return null;
    }
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height, text: el.textContent ?? "" };
    };
    return {
      lines: Array.from(editor.querySelectorAll(".cm-line")).map(box),
      nums: Array.from(
        editor.querySelectorAll(".cm-lineNumbers .cm-gutterElement"),
      )
        .map(box)
        .filter((n) => /^\d+$/.test(n.text.trim()) && n.height > 0),
    };
  });
}

for (const zoom of ["1", "1.15"]) {
  test(`gutter numbers align with editor lines at ui zoom ${zoom}`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.addInitScript((value) => {
      window.localStorage.setItem("irodori.ui.zoom.v1", value);
    }, zoom);
    await page.goto("/");
    const content = page.locator(".cm-content").first();
    await content.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(SQL);
    await page.waitForTimeout(300);

    const data = await measure(page);
    expect(data).not.toBeNull();
    const lines = data!.lines as Box[];
    const nums = data!.nums as Box[];
    expect(nums.length).toBe(lines.length);
    for (let i = 0; i < lines.length; i++) {
      expect(Math.abs(nums[i].top - lines[i].top)).toBeLessThanOrEqual(1);
      expect(Math.abs(nums[i].height - lines[i].height)).toBeLessThanOrEqual(1);
    }
  });
}
