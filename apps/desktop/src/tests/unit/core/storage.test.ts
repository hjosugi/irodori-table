// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseStoredNumber } from "@/core/storage";

describe("parseStoredNumber", () => {
  it("treats absent, empty and non-numeric input as nothing stored", () => {
    expect(parseStoredNumber(null)).toBeNull();
    expect(parseStoredNumber(undefined)).toBeNull();
    expect(parseStoredNumber("")).toBeNull();
    expect(parseStoredNumber("abc")).toBeNull();
    expect(parseStoredNumber("NaN")).toBeNull();
  });

  it("still accepts a genuinely stored zero", () => {
    // The whole point: distinguish "nothing stored" (null) from "0 stored".
    expect(parseStoredNumber("0")).toBe(0);
    expect(parseStoredNumber("2500")).toBe(2500);
    expect(parseStoredNumber("-3")).toBe(-3);
  });
});

// Number(null) is 0, so the bare-Number guard in loadResultMemoryBudget turned
// an absent key into a stored zero and clamped it to the 1,000 minimum — every
// fresh profile started at a tenth of the intended 10,000 default (#166). The
// same conversion already shipped the query-history bug (#114); this pins the
// store that was still carrying it.
describe("results store defaults on a fresh profile", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it("uses the 10,000 default when nothing is stored, not the clamp minimum", async () => {
    const mod = await import("@/features/results/store/results-store");

    expect(mod.useResultsStore.getState().resultMemoryBudget).toBe(10_000);
  });

  it("still honours a stored value, including one at the minimum", async () => {
    window.localStorage.setItem("irodori.results.memoryBudget.v1", "1000");
    const mod = await import("@/features/results/store/results-store");

    expect(mod.useResultsStore.getState().resultMemoryBudget).toBe(1000);
  });
});
