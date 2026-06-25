import { expect, test } from "@playwright/test";

test.describe("Result Grid Virtualization and Sticky Gutter", () => {
  test.beforeEach(async ({ page }) => {
    // Inject mock Tauri IPC to handle workspace configuration and query streaming
    await page.addInitScript(() => {
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: any) => {
          if (cmd === "db_get_workspace_snapshot") {
            return {
              activeConnectionId: "local-pg",
              connections: [
                {
                  id: "local-pg",
                  name: "Mock Database",
                  engine: "postgres",
                  status: "connected",
                  latencyMs: 5,
                  proxy: "direct",
                  objects: [
                    { name: "huge_table", kind: "table", rows: "1.0M" }
                  ],
                }
              ]
            };
          }
          if (cmd === "db_query_parameters") {
            return { prompts: [], signature: "mock-sig" };
          }
          if (cmd === "db_run_query_stream") {
            const columns = ["id", "val_a", "val_b", "val_c", "val_d"];
            args.onEvent.onmessage({ type: "columns", resultSetIndex: 0, columns });

            // Stream 1,000,000 rows in fast chunks to avoid test timeouts
            const totalRows = 1000000;
            const chunkSize = 50000;
            for (let i = 0; i < totalRows; i += chunkSize) {
              const rows: any[][] = [];
              for (let j = 0; j < chunkSize && (i + j) < totalRows; j++) {
                const idx = i + j;
                rows.push([
                  `row_${idx}`,
                  `val_a_${idx}`,
                  `val_b_${idx}`,
                  `val_c_${idx}`,
                  `val_d_${idx}`
                ]);
              }
              args.onEvent.onmessage({ type: "rows", resultSetIndex: 0, rows });
              // Yield control
              await new Promise(resolve => setTimeout(resolve, 0));
            }

            args.onEvent.onmessage({
              type: "done",
              rowCount: totalRows,
              truncated: false,
              elapsedMs: 250,
              resultSets: [{
                resultSetIndex: 0,
                rowCount: totalRows,
                elapsedMs: 250,
                truncated: false
              }]
            });
            return;
          }
          return null;
        }
      };
    });
  });

  test("virtualization limits DOM nodes and handles huge scrolling", async ({ page }) => {
    await page.goto("/");

    // Click "Run SQL" to run the default mock query and stream 1M rows
    await page.getByRole("button", { name: "Run" }).click();

    // Verify row count in the status bar or table loading is done
    const grid = page.locator(".result-grid");
    await expect(grid).toBeVisible();

    // Wait until loading message is gone and rows are rendered
    await page.waitForTimeout(500);

    // 1. Assert DOM node budget: row count in DOM should be bounded (viewport + overscan)
    // Even though there are 1,000,000 rows, the number of rendered .grid-row elements should be small.
    const rowElements = grid.locator(".grid-row:not(.header)");
    const rowCount = await rowElements.count();
    expect(rowCount).toBeGreaterThan(0);
    expect(rowCount).toBeLessThan(100); // Strict limit on rendered rows

    // 2. Perform deep scroll to middle and verify DOM count remains small
    await grid.evaluate(el => el.scrollTop = 500000);
    await page.waitForTimeout(100);
    const scrollRowCount = await rowElements.count();
    expect(scrollRowCount).toBeLessThan(100);

    // Verify cell content is updated based on scroll position
    const firstVisibleRowText = await rowElements.first().textContent();
    expect(firstVisibleRowText).toContain("row_");

    // 3. Scroll horizontally and verify sticky gutter remains at left:0
    await grid.evaluate(el => el.scrollLeft = 200);
    await page.waitForTimeout(100);

    // Ensure the sticky gutter element is present and has sticky positioning
    const gutter = page.locator(".grid-gutter").first();
    await expect(gutter).toBeVisible();
    const isSticky = await gutter.evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.position === "sticky" && style.left === "0px";
    });
    expect(isSticky).toBe(true);

    // 4. Test Scroll Reset: run another query and verify scroll positions reset to 0
    await page.getByRole("button", { name: "Run" }).click();
    await page.waitForTimeout(200);

    const scrollState = await grid.evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }));
    expect(scrollState.top).toBe(0);
    expect(scrollState.left).toBe(0);
  });
});
