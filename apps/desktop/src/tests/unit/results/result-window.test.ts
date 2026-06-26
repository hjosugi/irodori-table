import { describe, expect, it } from "vitest";
import {
  WINDOW_PLACEHOLDER,
  WindowedRows,
  createWindowedRowsProxy,
  makePlaceholderRow,
} from "@/features/results/result-window";

function row(n: number): readonly unknown[] {
  return [n, `row_${n}`];
}

function fetchInto(source: WindowedRows, request: { offset: number; limit: number }) {
  const rows = Array.from({ length: request.limit }, (_, i) => row(request.offset + i));
  source.ingest(request.offset, rows);
}

describe("WindowedRows", () => {
  it("computes page geometry and fetch requests", () => {
    const source = new WindowedRows({ total: 2_500, columnCount: 2, pageSize: 1_000 });
    expect(source.pageCount).toBe(3);
    expect(source.pageIndexOf(0)).toBe(0);
    expect(source.pageIndexOf(1_500)).toBe(1);
    // The last page is short and the request limit is clamped to the total.
    expect(source.pageRequest(2)).toEqual({ pageIndex: 2, offset: 2_000, limit: 500 });
  });

  it("ingests rows across page boundaries and reads them back by absolute index", () => {
    const source = new WindowedRows({ total: 2_500, columnCount: 2, pageSize: 1_000 });
    // A fetch that straddles the page-0/page-1 boundary.
    source.ingest(900, Array.from({ length: 200 }, (_, i) => row(900 + i)));
    expect(source.getRow(950)).toEqual(row(950));
    expect(source.getRow(1_050)).toEqual(row(1_050));
    expect(source.hasPage(0)).toBe(true);
    expect(source.hasPage(1)).toBe(true);
    // A page never touched stays unloaded.
    expect(source.getRow(2_100)).toBeUndefined();
    expect(source.hasPage(2)).toBe(false);
  });

  it("reports only the missing pages for a visible range", () => {
    const source = new WindowedRows({ total: 5_000, columnCount: 2, pageSize: 1_000 });
    fetchInto(source, source.pageRequest(2));
    const missing = source.missingPages(1_500, 3_200);
    // Range spans pages 1,2,3; page 2 is resident, so only 1 and 3 are requested.
    expect(missing.map((request) => request.pageIndex)).toEqual([1, 3]);
    expect(missing[0]).toEqual({ pageIndex: 1, offset: 1_000, limit: 1_000 });
  });

  it("keeps memory flat by evicting least-recently-used pages", () => {
    // The anti-TablePlus guarantee on the client: a 10M-row result paged at 1k/page
    // with a 4-page budget never holds more than 4k rows in JS, regardless of how
    // many pages are visited.
    const source = new WindowedRows({
      total: 10_000_000,
      columnCount: 2,
      pageSize: 1_000,
      maxResidentPages: 4,
    });
    for (let pageIndex = 0; pageIndex < 50; pageIndex += 1) {
      fetchInto(source, source.pageRequest(pageIndex));
    }
    expect(source.residentPageCount()).toBe(4);
    expect(source.residentRowCount()).toBe(4_000);
    // The four most-recent pages survive; older ones were evicted.
    expect(source.hasPage(49)).toBe(true);
    expect(source.hasPage(46)).toBe(true);
    expect(source.hasPage(45)).toBe(false);
    expect(source.getRow(0)).toBeUndefined();
  });

  it("treats a freshly read page as recently used", () => {
    const source = new WindowedRows({
      total: 10_000,
      columnCount: 2,
      pageSize: 1_000,
      maxResidentPages: 2,
    });
    fetchInto(source, source.pageRequest(0));
    fetchInto(source, source.pageRequest(1));
    // Reading page 0 makes it the most-recent, so loading page 2 evicts page 1.
    expect(source.getRow(10)).toEqual(row(10));
    fetchInto(source, source.pageRequest(2));
    expect(source.hasPage(0)).toBe(true);
    expect(source.hasPage(1)).toBe(false);
    expect(source.hasPage(2)).toBe(true);
  });
});

describe("makePlaceholderRow", () => {
  it("maps to placeholder cells without allocating a real array", () => {
    const placeholder = makePlaceholderRow(3);
    expect(placeholder.length).toBe(3);
    expect(placeholder.map((cell) => cell)).toEqual([
      WINDOW_PLACEHOLDER,
      WINDOW_PLACEHOLDER,
      WINDOW_PLACEHOLDER,
    ]);
  });
});

describe("createWindowedRowsProxy", () => {
  it("indexes resident rows and falls back to a placeholder", () => {
    const source = new WindowedRows({ total: 1_000, columnCount: 2, pageSize: 500 });
    const proxy = createWindowedRowsProxy(source);
    expect(proxy.length).toBe(1_000);

    // Before any fetch every row is a placeholder logical row.
    const before = proxy[5];
    expect(before.length).toBe(2);
    expect(before.map((cell) => cell)).toEqual([WINDOW_PLACEHOLDER, WINDOW_PLACEHOLDER]);

    fetchInto(source, source.pageRequest(0));
    expect(proxy[5]).toEqual(row(5));
    // Out of range stays undefined so the view model clamps correctly.
    expect(proxy[1_000]).toBeUndefined();
  });
});
