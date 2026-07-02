import { expect, type Page, test } from "@playwright/test";

// SQL-editor text-editing accuracy + performance scenarios.
//
// This drives the Vite frontend only: Tauri IPC is absent, `invoke` rejects,
// and the app falls back to its mock snapshot. The CodeMirror 6 editor itself
// is fully live (basicSetup: history, line numbers, close-brackets,
// autocompletion with Enter/Tab acceptance, and lang-sql continuedIndent).

// Errors the app raises on purpose in a plain browser.
const ignorable = (message: string) => /tauri|invoke|__TAURI/i.test(message);

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

// The performance scenarios measure wall-clock latency; run this file's tests
// sequentially in a single worker so sibling tests on the same machine do not
// skew the numbers (typing100 measured 3.1s isolated vs 6.7s when racing
// three other workers).
test.describe.configure({ mode: "default" });

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    console.error("BROWSER PAGE ERROR:", error);
    errors.push(String(error));
  });
  return errors;
}

function expectNoRealPageErrors(errors: string[]) {
  expect(errors.filter((message) => !ignorable(message))).toEqual([]);
}

async function openEditor(page: Page) {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await expect(page.locator(".cm-editor")).toBeVisible();
}

async function editorText(page: Page) {
  return (await page.locator(".cm-line").allTextContents()).join("\n");
}

async function clearEditor(page: Page) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect.poll(() => editorText(page)).toBe("");
}

// Bulk text entry through a single input event (IME-like commit path).
async function setEditorText(page: Page, text: string) {
  await clearEditor(page);
  await page.keyboard.insertText(text);
  await expect
    .poll(async () => (await editorText(page)).length)
    .toBeGreaterThan(0);
}

// Types lines with the physical keyboard, exactly. Two traps are defused:
// - basicSetup's completionKeymap binds Enter to acceptCompletion when a
//   completion is active, so Escape closes any popup before each Enter.
// - insertNewlineAndIndent auto-indents (lang-sql ships continuedIndent), so
//   Shift+Home selects any auto-inserted indentation and the first typed
//   character of the next line replaces it.
async function typeLines(page: Page, lines: readonly string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Shift+Home");
    }
    await page.keyboard.type(lines[index]);
  }
  await page.keyboard.press("Escape");
}

async function clickLine(page: Page, index: number) {
  await page.locator(".cm-line").nth(index).click();
}

// Counts rendered lines vs rendered gutter line numbers (height > 0 filters
// the measuring spacer element CodeMirror keeps in the gutter).
async function lineAndGutterCounts(page: Page) {
  return page.evaluate(() => {
    const editor = document.querySelector(".cm-editor");
    if (!editor) {
      return { lines: -1, gutters: -2 };
    }
    const lines = editor.querySelectorAll(".cm-line").length;
    const gutters = Array.from(
      editor.querySelectorAll(".cm-lineNumbers .cm-gutterElement"),
    ).filter(
      (el) =>
        /^\d+$/.test(el.textContent?.trim() ?? "") &&
        el.getBoundingClientRect().height > 0,
    ).length;
    return { lines, gutters };
  });
}

async function expectLineAndGutterCounts(page: Page, expected: number) {
  await expect
    .poll(() => lineAndGutterCounts(page), {
      message: `rendered .cm-line count and gutter number count should both be ${expected}`,
    })
    .toEqual({ lines: expected, gutters: expected });
}

// Center of the first occurrence of `word` in the rendered document, so a
// positional double-click can select exactly that word.
async function wordCenter(page: Page, word: string) {
  return page.evaluate((needle) => {
    const content = document.querySelector(".cm-content");
    if (!content) {
      return null;
    }
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node as Text;
      const index = text.data.indexOf(needle);
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + needle.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      node = walker.nextNode();
    }
    return null;
  }, word);
}

async function activeGutterNumber(page: Page) {
  const text = await page
    .locator(".cm-lineNumbers .cm-gutterElement.cm-activeLineGutter")
    .first()
    .textContent();
  return Number.parseInt(text?.trim() ?? "-1", 10);
}

// ---------------------------------------------------------------------------
// Accuracy scenarios
// ---------------------------------------------------------------------------

test("scenario 1: typed 10-line SQL plus mid-document insertions stay exact", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = collectPageErrors(page);
  await openEditor(page);

  const lines = [
    "select",
    "  u.id,",
    "  u.email,",
    "  u.created_at,",
    "  count(o.id) as orders",
    "from users u",
    "left join orders o on o.user_id = u.id",
    "where u.created_at >= '2024-01-01'",
    "group by 1, 2, 3",
    "order by orders desc;",
  ];
  await clearEditor(page);
  await typeLines(page, lines);
  await expect.poll(() => editorText(page)).toBe(lines.join("\n"));

  // Insert at end of the middle line (line 5, index 4).
  await clickLine(page, 4);
  await page.keyboard.press("End");
  await page.keyboard.type(" -- agg");
  await page.keyboard.press("Escape");
  const afterEndInsert = [...lines];
  afterEndInsert[4] = "  count(o.id) as orders -- agg";
  await expect.poll(() => editorText(page)).toBe(afterEndInsert.join("\n"));

  // Insert at the start of line 6 (Home positioning).
  await clickLine(page, 5);
  await page.keyboard.press("Home");
  await page.keyboard.type("-- ");
  await page.keyboard.press("Escape");
  const afterHomeInsert = [...afterEndInsert];
  afterHomeInsert[5] = "-- from users u";
  await expect.poll(() => editorText(page)).toBe(afterHomeInsert.join("\n"));

  // Insert at an exact mid-line column: line 2 "  u.id," -> after "  u.".
  // Position from End (deterministic); Home is "smart home" here and lands on
  // the first non-whitespace character of an indented line.
  await clickLine(page, 1);
  await page.keyboard.press("End");
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("ArrowLeft");
  }
  await page.keyboard.type("x");
  await page.keyboard.press("Escape");
  const afterMidInsert = [...afterHomeInsert];
  afterMidInsert[1] = "  u.xid,";
  await expect.poll(() => editorText(page)).toBe(afterMidInsert.join("\n"));

  expectNoRealPageErrors(errors);
});

test("scenario 2: double-click word selection is replaced exactly by typing", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = collectPageErrors(page);
  await openEditor(page);

  await setEditorText(page, "select alpha from words;");
  await expect.poll(() => editorText(page)).toBe("select alpha from words;");

  const center = await wordCenter(page, "alpha");
  expect(center, "the word 'alpha' should be rendered").not.toBeNull();
  await page.mouse.dblclick(center!.x, center!.y);
  await page.keyboard.type("beta_totals");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => editorText(page))
    .toBe("select beta_totals from words;");

  expectNoRealPageErrors(errors);
});

test("scenario 3: undo x5 restores the original and redo x5 restores the final text", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectPageErrors(page);
  await openEditor(page);

  const original = [
    "select id from users;",
    "select name from users;",
    "select email from users;",
  ];
  await setEditorText(page, original.join("\n"));
  await expect.poll(() => editorText(page)).toBe(original.join("\n"));

  // CodeMirror's history joins adjacent quick edits into one event; each edit
  // below is a single burst of word characters (punctuation/space bursts were
  // observed to split into multiple history events) at a distinct position,
  // after > newGroupDelay (500ms), so the five edits become exactly five
  // undoable events.
  const settleHistoryGroup = () => page.waitForTimeout(600);

  await settleHistoryGroup();
  await clickLine(page, 0);
  await page.keyboard.press("End");
  await page.keyboard.type("_one");
  await page.keyboard.press("Escape");

  await settleHistoryGroup();
  await clickLine(page, 1);
  await page.keyboard.press("Home");
  await page.keyboard.type("xx");
  await page.keyboard.press("Escape");

  await settleHistoryGroup();
  await clickLine(page, 2);
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");

  await settleHistoryGroup();
  await clickLine(page, 0);
  await page.keyboard.press("Home");
  await page.keyboard.type("yy");
  await page.keyboard.press("Escape");

  await settleHistoryGroup();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("_five");
  await page.keyboard.press("Escape");

  const final = [
    "yyselect id from users;_one",
    "xxselect name from users;",
    "select email from users_five",
  ];
  await expect.poll(() => editorText(page)).toBe(final.join("\n"));

  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("ControlOrMeta+z");
  }
  await expect.poll(() => editorText(page)).toBe(original.join("\n"));

  // Redo is Mod-y in CodeMirror's historyKeymap on non-mac platforms.
  // (Ctrl+Shift+Z reaches Chromium's native contenteditable redo instead and
  // was observed to corrupt the CodeMirror document — do not use it here.)
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("ControlOrMeta+y");
  }
  await expect.poll(() => editorText(page)).toBe(final.join("\n"));

  expectNoRealPageErrors(errors);
});

test("scenario 4: Tab indents and Shift+Tab outdents a 3-line selection exactly", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = collectPageErrors(page);
  await openEditor(page);

  const lines = ["select 1;", "select 2;", "select 3;"];
  await setEditorText(page, lines.join("\n"));

  await clickLine(page, 0);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+End");

  await page.keyboard.press("Tab");
  await expect
    .poll(() => editorText(page))
    .toBe(["  select 1;", "  select 2;", "  select 3;"].join("\n"));

  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => editorText(page)).toBe(lines.join("\n"));

  expectNoRealPageErrors(errors);
});

test("scenario 5: copy of 3 lines pastes back with exact fidelity", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = collectPageErrors(page);
  await openEditor(page);

  const lines = [
    "select a from t1;",
    "select b from t2;",
    "select c from t3;",
    "select d from t4;",
    "select e from t5;",
  ];
  await setEditorText(page, lines.join("\n"));
  await expect.poll(() => editorText(page)).toBe(lines.join("\n"));

  // Select lines 1-3 (without the trailing newline) and copy.
  await clickLine(page, 0);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("ControlOrMeta+c");

  // New line at the end; Shift+Home makes the paste replace any auto-indent.
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("ControlOrMeta+v");

  const expected = [...lines, lines[0], lines[1], lines[2]];
  await expect.poll(() => editorText(page)).toBe(expected.join("\n"));
  await expectLineAndGutterCounts(page, expected.length);

  expectNoRealPageErrors(errors);
});

test("scenario 6: line delete and join keep text, line count, and gutter exact", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = collectPageErrors(page);
  await openEditor(page);

  const lines = [
    "select a from t1;",
    "select b from t2;",
    "select c from t3;",
    "select d from t4;",
    "select e from t5;",
  ];
  await setEditorText(page, lines.join("\n"));
  await expect.poll(() => editorText(page)).toBe(lines.join("\n"));
  await expectLineAndGutterCounts(page, 5);

  // Delete line 3 entirely (select from its start to line 4's start).
  await clickLine(page, 2);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Backspace");
  const afterDelete = [lines[0], lines[1], lines[3], lines[4]];
  await expect.poll(() => editorText(page)).toBe(afterDelete.join("\n"));
  await expectLineAndGutterCounts(page, 4);

  // Join line 1 and line 2 with forward-delete at end of line 1.
  await clickLine(page, 0);
  await page.keyboard.press("End");
  await page.keyboard.press("Delete");
  const afterJoin = [lines[0] + lines[1], lines[3], lines[4]];
  await expect.poll(() => editorText(page)).toBe(afterJoin.join("\n"));
  await expectLineAndGutterCounts(page, 3);

  expectNoRealPageErrors(errors);
});

test("scenario 11: clicking a line number selects exactly that line; shift-click extends", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = collectPageErrors(page);
  await openEditor(page);

  const lines = [
    "select a from t1;",
    "select b from t2;",
    "select c from t3;",
    "select d from t4;",
    "select e from t5;",
  ];
  const gutterNumber = (value: string) =>
    page
      .locator(".cm-lineNumbers .cm-gutterElement")
      .filter({ hasText: new RegExp(`^${value}$`) });

  await setEditorText(page, lines.join("\n"));
  await expect.poll(() => editorText(page)).toBe(lines.join("\n"));

  // Click the line-number gutter for line 2: the selection must span exactly
  // that line plus its trailing newline. Typing over the selection proves the
  // exact span: line 2 disappears and the replacement joins line 3.
  await gutterNumber("2").click();
  await page.keyboard.type("Z");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => editorText(page))
    .toBe([lines[0], `Z${lines[2]}`, lines[3], lines[4]].join("\n"));
  await expectLineAndGutterCounts(page, 4);

  // Shift+click extends the selection from the anchored line 2 to line 4
  // (inclusive, plus the trailing newline); deleting it must leave lines 1
  // and 5 only.
  await setEditorText(page, lines.join("\n"));
  await expect.poll(() => editorText(page)).toBe(lines.join("\n"));
  await gutterNumber("2").click();
  await gutterNumber("4").click({ modifiers: ["Shift"] });
  await page.keyboard.press("Backspace");
  await expect
    .poll(() => editorText(page))
    .toBe([lines[0], lines[4]].join("\n"));
  await expectLineAndGutterCounts(page, 2);

  expectNoRealPageErrors(errors);
});

// ---------------------------------------------------------------------------
// Performance scenarios (5,000-line document; ceilings are deliberately
// generous so CI does not flake — the real numbers are logged as PERF lines).
// ---------------------------------------------------------------------------

const BIG_LINE_COUNT = 5_000;
const bigLines = Array.from(
  { length: BIG_LINE_COUNT },
  (_, i) => `select ${i + 1} as v${i + 1}; -- line ${i + 1}`,
);

test("scenarios 7-10: 5k-line load, end-of-document typing, scrolling, gutter alignment", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectPageErrors(page);
  await openEditor(page);
  await clearEditor(page);

  // Scenario 7: bulk load through one paste event (keyboard.insertText was
  // measured at ~155s for this document through the CDP IME path, so the
  // task-sanctioned synthetic paste is used instead; CodeMirror handles the
  // ClipboardEvent natively as a single transaction). Then wait for the
  // rendered viewport text to stabilize and for the real end of the document
  // to be reachable (CodeMirror virtualizes: .cm-line only covers the
  // viewport).
  const loadStart = Date.now();
  await page.locator(".cm-content").evaluate((content, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    content.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, bigLines.join("\n"));
  let previousLength = -1;
  await expect
    .poll(
      async () => {
        const length = (await editorText(page)).length;
        const stable = length > 0 && length === previousLength;
        previousLength = length;
        return stable;
      },
      { message: "rendered editor text length should stabilize" },
    )
    .toBe(true);
  await page.keyboard.press("ControlOrMeta+End");
  await expect.poll(() => activeGutterNumber(page)).toBe(BIG_LINE_COUNT);
  await expect
    .poll(() => page.locator(".cm-line").last().textContent())
    .toBe(bigLines[BIG_LINE_COUNT - 1]);
  const loadMs = Date.now() - loadStart;
  expect(loadMs, `5k-line load took ${loadMs}ms`).toBeLessThan(10_000);

  // Scenario 8: type 100 characters at the very end of the 5k-line document.
  const suffix = ` -- tail_${"x".repeat(91)}`;
  expect(suffix).toHaveLength(100);
  const typingStart = Date.now();
  await page.keyboard.type(suffix);
  await expect
    .poll(() => page.locator(".cm-line").last().textContent())
    .toBe(bigLines[BIG_LINE_COUNT - 1] + suffix);
  const typingMs = Date.now() - typingStart;
  await page.keyboard.press("Escape");
  expect(typingMs, `typing 100 chars took ${typingMs}ms`).toBeLessThan(5_000);

  // Scenario 9: PageDown x20 from the top; the cursor must land on a line
  // whose gutter number matches that line's own "-- line N" marker.
  await page.keyboard.press("ControlOrMeta+Home");
  await expect.poll(() => activeGutterNumber(page)).toBe(1);
  const scrollStart = Date.now();
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press("PageDown");
  }
  const cursorLine = await activeGutterNumber(page);
  await expect
    .poll(() => page.locator(".cm-activeLine").first().textContent())
    .toBe(bigLines[cursorLine - 1]);
  const scrollMs = Date.now() - scrollStart;
  expect(
    cursorLine,
    "PageDown x20 should move the cursor down",
  ).toBeGreaterThan(20);
  expect(cursorLine).toBeLessThanOrEqual(BIG_LINE_COUNT);

  console.log(
    `PERF: load5k=${loadMs}ms typing100=${typingMs}ms pagedown20=${scrollMs}ms cursorLineAfterScroll=${cursorLine}`,
  );

  // Scenario 10: gutter numbers must still align with text lines to <= 1px in
  // the current (deeply scrolled, heavily edited) viewport.
  const alignment = await page.evaluate(() => {
    const editor = document.querySelector(".cm-editor");
    if (!editor) {
      return null;
    }
    const box = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, height: rect.height, text: el.textContent ?? "" };
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
  expect(alignment).not.toBeNull();
  expect(alignment!.nums.length).toBe(alignment!.lines.length);
  expect(alignment!.lines.length).toBeGreaterThan(0);
  let maxTopDelta = 0;
  for (let i = 0; i < alignment!.lines.length; i += 1) {
    const delta = Math.abs(alignment!.nums[i].top - alignment!.lines[i].top);
    maxTopDelta = Math.max(maxTopDelta, delta);
    expect(
      delta,
      `gutter/text top delta at viewport row ${i}`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(alignment!.nums[i].height - alignment!.lines[i].height),
      `gutter/text height delta at viewport row ${i}`,
    ).toBeLessThanOrEqual(1);
  }
  console.log(
    `PERF: gutterAlignRows=${alignment!.lines.length} maxTopDelta=${maxTopDelta.toFixed(3)}px`,
  );

  expectNoRealPageErrors(errors);
});
