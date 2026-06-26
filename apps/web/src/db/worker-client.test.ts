import { describe, expect, it } from "vitest";
import { LocalWorkerPool, resolveMaxWorkerCount } from "./worker-client";

describe("resolveMaxWorkerCount", () => {
  it("uses the reported hardware concurrency", () => {
    expect(resolveMaxWorkerCount(16)).toBe(16);
  });

  it("floors fractional values and never returns less than one", () => {
    expect(resolveMaxWorkerCount(7.8)).toBe(7);
    expect(resolveMaxWorkerCount(0)).toBe(1);
    expect(resolveMaxWorkerCount(-4)).toBe(1);
  });

  it("falls back when the browser does not report concurrency", () => {
    expect(resolveMaxWorkerCount(Number.NaN)).toBe(4);
  });

  it("uses the current runtime when no explicit value is passed", () => {
    expect(resolveMaxWorkerCount()).toBeGreaterThanOrEqual(1);
  });
});

describe("LocalWorkerPool", () => {
  it("reports the configured maximum worker count", () => {
    const pool = new LocalWorkerPool(12);
    expect(pool.status()).toMatchObject({
      maxWorkers: 12,
      workers: [],
    });
  });
});
