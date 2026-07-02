// Windowed, LRU-bounded row source for disk-offloaded results (EXEC-010).
//
// A spilled result can be far larger than RAM, so the desktop grid must not hold
// every row in JS memory the way it does for a capped page. Instead the backend
// retains the full result behind a temp-SQLite store (`db_run_query_spill`) and
// the grid pages rows back through `db_result_window`. This module is the pure
// client-side half: it tracks which fixed-size pages are resident, evicts the
// least-recently-used pages so the JS heap stays flat regardless of total size,
// and exposes an array-like `Proxy` the existing result-grid view model can index
// transparently — resident rows return real cells, off-screen rows return a cheap
// placeholder until their page is fetched.

export const DEFAULT_WINDOW_PAGE_SIZE = 1_000;
export const DEFAULT_MAX_RESIDENT_PAGES = 24;
/** Rendered in cells whose page has not been fetched yet. */
export const WINDOW_PLACEHOLDER = "…";

export type WindowRow = readonly unknown[];

export interface WindowedRowsOptions {
  /** Total rows in the result (resident + spilled). */
  total: number;
  columnCount: number;
  /** Rows per fetched page. Defaults to {@link DEFAULT_WINDOW_PAGE_SIZE}. */
  pageSize?: number;
  /**
   * Maximum pages kept resident before the least-recently-used is dropped. This
   * is the flat-memory guarantee: resident rows never exceed
   * `maxResidentPages * pageSize` no matter how large the result is.
   */
  maxResidentPages?: number;
}

/** A page the grid needs fetched from the backend. */
export interface PageRequest {
  pageIndex: number;
  offset: number;
  limit: number;
}

export class WindowedRows {
  readonly total: number;
  readonly columnCount: number;
  readonly pageSize: number;
  readonly maxResidentPages: number;
  readonly pageCount: number;
  private readonly pages = new Map<number, Array<WindowRow | undefined>>();
  /** Page indices ordered oldest-first for LRU eviction. */
  private readonly lru: number[] = [];

  constructor(options: WindowedRowsOptions) {
    this.total = Math.max(0, Math.floor(options.total));
    this.columnCount = Math.max(0, Math.floor(options.columnCount));
    this.pageSize = Math.max(
      1,
      Math.floor(options.pageSize ?? DEFAULT_WINDOW_PAGE_SIZE),
    );
    this.maxResidentPages = Math.max(
      1,
      Math.floor(options.maxResidentPages ?? DEFAULT_MAX_RESIDENT_PAGES),
    );
    this.pageCount = Math.ceil(this.total / this.pageSize);
  }

  pageIndexOf(rowIndex: number): number {
    return Math.floor(rowIndex / this.pageSize);
  }

  /** The backend fetch arguments for a page. */
  pageRequest(pageIndex: number): PageRequest {
    const offset = pageIndex * this.pageSize;
    const limit = Math.max(0, Math.min(this.pageSize, this.total - offset));
    return { pageIndex, offset, limit };
  }

  hasPage(pageIndex: number): boolean {
    return this.pages.has(pageIndex);
  }

  /** The resident row at an absolute index, or `undefined` if its page is not loaded. */
  getRow(rowIndex: number): WindowRow | undefined {
    if (rowIndex < 0 || rowIndex >= this.total) {
      return undefined;
    }
    const pageIndex = this.pageIndexOf(rowIndex);
    const page = this.pages.get(pageIndex);
    if (!page) {
      return undefined;
    }
    this.touch(pageIndex);
    return page[rowIndex - pageIndex * this.pageSize];
  }

  /**
   * Store rows fetched starting at absolute `offset`, splitting across page
   * boundaries, then evict least-recently-used pages beyond the budget.
   */
  ingest(offset: number, rows: readonly WindowRow[]): void {
    let cursor = Math.max(0, Math.floor(offset));
    let index = 0;
    while (index < rows.length && cursor < this.total) {
      const pageIndex = this.pageIndexOf(cursor);
      const pageStart = pageIndex * this.pageSize;
      const pageEnd = Math.min(pageStart + this.pageSize, this.total);
      let page = this.pages.get(pageIndex);
      if (!page) {
        page = Array.from({ length: pageEnd - pageStart });
        this.pages.set(pageIndex, page);
      }
      while (cursor < pageEnd && index < rows.length) {
        page[cursor - pageStart] = rows[index];
        cursor += 1;
        index += 1;
      }
      this.touch(pageIndex);
    }
    this.evict();
  }

  /**
   * Page fetch requests covering rows `[firstRow, lastRow)` that are not yet
   * resident — what the grid asks the backend for when a range scrolls into view.
   */
  missingPages(firstRow: number, lastRow: number): PageRequest[] {
    const first = clamp(firstRow, 0, this.total);
    const last = clamp(lastRow, first, this.total);
    if (last <= first) {
      return [];
    }
    const firstPage = this.pageIndexOf(first);
    const lastPage = this.pageIndexOf(last - 1);
    const requests: PageRequest[] = [];
    for (let pageIndex = firstPage; pageIndex <= lastPage; pageIndex += 1) {
      if (!this.pages.has(pageIndex)) {
        requests.push(this.pageRequest(pageIndex));
      }
    }
    return requests;
  }

  residentPageCount(): number {
    return this.pages.size;
  }

  residentRowCount(): number {
    let count = 0;
    for (const page of this.pages.values()) {
      count += page.length;
    }
    return count;
  }

  private touch(pageIndex: number): void {
    const at = this.lru.indexOf(pageIndex);
    if (at !== -1) {
      this.lru.splice(at, 1);
    }
    this.lru.push(pageIndex);
  }

  private evict(): void {
    while (this.lru.length > this.maxResidentPages) {
      const victim = this.lru.shift();
      if (victim !== undefined) {
        this.pages.delete(victim);
      }
    }
  }
}

/**
 * A cheap logical row for an unloaded position: it answers `.length` and `.map`
 * (all the result-grid view model needs to paint a row) without allocating a real
 * per-column array, so scrolling a 10M-row result never materializes off-screen
 * cells.
 */
export function makePlaceholderRow(
  columnCount: number,
  placeholder: unknown = WINDOW_PLACEHOLDER,
): WindowRow {
  return {
    length: columnCount,
    map<T>(callback: (value: unknown, index: number, row: unknown) => T): T[] {
      const cells: T[] = [];
      for (let index = 0; index < columnCount; index += 1) {
        cells.push(callback(placeholder, index, this));
      }
      return cells;
    },
  } as unknown as WindowRow;
}

const ARRAY_LIKE_TARGET: readonly unknown[] = [];

/**
 * An array-like `Proxy` over a {@link WindowedRows} the result-grid view model can
 * index by absolute row number: `length` is the total, a resident row returns its
 * real cells, and an unloaded row returns a shared placeholder. Reads are pure —
 * fetching missing pages is the caller's job (it watches the visible range and
 * calls {@link WindowedRows.missingPages} + {@link WindowedRows.ingest}).
 */
export function createWindowedRowsProxy(
  source: WindowedRows,
  placeholder: unknown = WINDOW_PLACEHOLDER,
): readonly WindowRow[] {
  const placeholderRow = makePlaceholderRow(source.columnCount, placeholder);
  return new Proxy(ARRAY_LIKE_TARGET, {
    get(_target, prop) {
      if (prop === "length") {
        return source.total;
      }
      if (typeof prop === "string") {
        const index = Number(prop);
        if (Number.isInteger(index) && index >= 0 && index < source.total) {
          return source.getRow(index) ?? placeholderRow;
        }
      }
      return undefined;
    },
    has(_target, prop) {
      if (prop === "length") {
        return true;
      }
      if (typeof prop === "string") {
        const index = Number(prop);
        return Number.isInteger(index) && index >= 0 && index < source.total;
      }
      return false;
    },
  }) as unknown as readonly WindowRow[];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}
