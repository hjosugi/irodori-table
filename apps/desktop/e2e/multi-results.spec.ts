import { expect, type Locator, test } from "@playwright/test";
import {
  connectMockDatabase,
  installMultiResultMock,
  runFixtureQuery,
} from "./support/multi-result-mock";

const GRID_ROW_HEIGHT_PX = 27;
const GRID_COLUMN_WIDTH_PX = 148;

// Errors the app raises on purpose in a plain browser when IPC is absent. This
// spec installs a Tauri mock, so anything outside this pattern is unexpected.
const ignorable = (message: string) => /tauri|invoke|__TAURI/i.test(message);

async function scrollGridTo(
  grid: Locator,
  position: { top?: number; left?: number },
) {
  await grid.evaluate((element, nextPosition) => {
    if (nextPosition.top !== undefined) {
      element.scrollTop = nextPosition.top;
    }
    if (nextPosition.left !== undefined) {
      element.scrollLeft = nextPosition.left;
    }
  }, position);
  await grid.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function expectGridScrollPosition(
  grid: Locator,
  expected: { top: number; left: number },
) {
  await expect
    .poll(() =>
      grid.evaluate((element) => ({
        top: element.scrollTop,
        left: element.scrollLeft,
      })),
    )
    .toEqual(expected);
}

test("streamed multi-statement results expose tabs, summaries, switching, and reset grid state", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    console.error("BROWSER PAGE ERROR:", error);
    pageErrors.push(String(error));
  });

  await installMultiResultMock(page);
  await page.goto("/");

  await connectMockDatabase(page);
  await runFixtureQuery(page);

  const grid = page.locator(".result-grid");
  const resultTabs = page.getByRole("tablist", { name: "Result sets" });
  const resultOneTab = page.getByRole("tab", { name: "Result set 1" });
  const resultTwoTab = page.getByRole("tab", { name: "Result set 2" });

  await expect(resultTabs).toBeVisible();
  await expect(resultOneTab).toHaveAttribute("aria-selected", "true");
  await expect(resultTwoTab).toHaveAttribute("aria-selected", "false");
  await expect(page.locator(".results-title")).toContainText(
    "120 rows in 37 ms",
  );
  await expect(
    grid.getByRole("columnheader", { name: "account_id" }),
  ).toBeVisible();
  await expect(grid.getByRole("cell", { name: "account_0" })).toBeVisible();

  const selectedCell = grid.getByRole("cell", { name: "metric_1_0" });
  await selectedCell.click();
  await expect(selectedCell).toHaveAttribute("aria-selected", "true");
  await expect(grid.locator(".grid-row.row-selected")).toHaveCount(1);

  await scrollGridTo(grid, {
    top: 35 * GRID_ROW_HEIGHT_PX,
    left: 6 * GRID_COLUMN_WIDTH_PX,
  });
  const scrolledPosition = await grid.evaluate((element) => ({
    top: element.scrollTop,
    left: element.scrollLeft,
  }));
  expect(
    scrolledPosition.top,
    "test setup should leave the first result vertically scrolled",
  ).toBeGreaterThan(0);
  expect(
    scrolledPosition.left,
    "test setup should leave the first result horizontally scrolled",
  ).toBeGreaterThan(0);

  await resultTwoTab.click();
  await expect(resultOneTab).toHaveAttribute("aria-selected", "false");
  await expect(resultTwoTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".results-title")).toContainText("3 rows in 9 ms");
  await expectGridScrollPosition(grid, { top: 0, left: 0 });
  await expect(grid.locator(".grid-row.row-selected")).toHaveCount(0);
  await expect(grid.locator("[role='cell'][aria-selected='true']")).toHaveCount(
    0,
  );
  await expect(
    grid.getByRole("columnheader", { name: "region" }),
  ).toBeVisible();
  await expect(grid.getByRole("cell", { name: "apac" })).toBeVisible();
  await expect(grid.getByRole("cell", { name: "account_0" })).toHaveCount(0);

  await resultOneTab.click();
  await expect(resultOneTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".results-title")).toContainText(
    "120 rows in 37 ms",
  );
  await expectGridScrollPosition(grid, { top: 0, left: 0 });
  await expect(grid.locator(".grid-row.row-selected")).toHaveCount(0);
  await expect(grid.getByRole("cell", { name: "account_0" })).toBeVisible();

  expect(pageErrors.filter((message) => !ignorable(message))).toEqual([]);
});

test("selecting a result row opens Row Detail as a full-height right sidebar", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    console.error("BROWSER PAGE ERROR:", error);
    pageErrors.push(String(error));
  });

  await installMultiResultMock(page);
  await page.goto("/");

  await connectMockDatabase(page);
  await runFixtureQuery(page);

  // Nothing selected yet, so no detail panel anywhere.
  await expect(page.locator(".row-detail")).toHaveCount(0);

  await page.locator(".grid-row [role='cell']").first().click();

  // The detail opens in the right sidebar, not inside the results pane.
  const rightSidebar = page.locator(".sidebar.sidebar-right");
  const detail = rightSidebar.locator(".row-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("Row Detail");
  await expect(page.locator(".results-pane .row-detail")).toHaveCount(0);

  // VS Code-style: it spans the same vertical extent as the left sidebar.
  const leftBox = await page.locator(".sidebar.sidebar-left").boundingBox();
  const rightBox = await rightSidebar.boundingBox();
  expect(leftBox).toBeTruthy();
  expect(rightBox).toBeTruthy();
  expect(Math.abs(rightBox!.y - leftBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(rightBox!.height - leftBox!.height)).toBeLessThanOrEqual(1);

  // A fresh layout honors the configured sidebar widths (defaults 200/300)
  // instead of stretching them proportionally to the window.
  expect(Math.abs(leftBox!.width - 200)).toBeLessThanOrEqual(2);
  expect(Math.abs(rightBox!.width - 300)).toBeLessThanOrEqual(2);

  // A true split, not an overlay: every results-header control stays fully
  // inside the (narrower) results pane instead of being sliced at the
  // sidebar boundary.
  const clipped = await page.evaluate(() => {
    const pane = document.querySelector(".results-pane");
    if (!pane) {
      return ["missing .results-pane"];
    }
    const paneRight = pane.getBoundingClientRect().right;
    return Array.from(
      pane.querySelectorAll(".results-header button, .results-header input"),
    )
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.right > paneRight + 1;
      })
      .map((el) => el.textContent || el.getAttribute("aria-label") || "?");
  });
  expect(clipped).toEqual([]);

  // Closing the panel clears the selection and the sidebar. The control was
  // renamed in #149, where it also stopped being disabled with no row selected
  // — its handler always closed the view, so disabling it left the panel stuck
  // open.
  await detail.getByRole("button", { name: "Close row detail" }).click();
  await expect(page.locator(".row-detail")).toHaveCount(0);
  await expect(page.locator(".grid-row.row-selected")).toHaveCount(0);

  expect(pageErrors.filter((message) => !ignorable(message))).toEqual([]);
});
