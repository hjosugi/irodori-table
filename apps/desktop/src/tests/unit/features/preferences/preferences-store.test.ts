import { beforeAll, describe, expect, it } from "vitest";

let UI_ZOOM_DEFAULT = 1;
let UI_ZOOM_MAX = 1.5;
let UI_ZOOM_MIN = 0.75;
let normalizeUiZoom: (value: unknown) => number;

beforeAll(async () => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  });

  const preferences = await import("@/features/preferences");
  UI_ZOOM_DEFAULT = preferences.UI_ZOOM_DEFAULT;
  UI_ZOOM_MAX = preferences.UI_ZOOM_MAX;
  UI_ZOOM_MIN = preferences.UI_ZOOM_MIN;
  normalizeUiZoom = preferences.normalizeUiZoom;
});

describe("normalizeUiZoom", () => {
  it("defaults missing and invalid values", () => {
    expect(normalizeUiZoom(null)).toBe(UI_ZOOM_DEFAULT);
    expect(normalizeUiZoom(undefined)).toBe(UI_ZOOM_DEFAULT);
    expect(normalizeUiZoom("")).toBe(UI_ZOOM_DEFAULT);
    expect(normalizeUiZoom("oops")).toBe(UI_ZOOM_DEFAULT);
  });

  it("clamps and rounds valid zoom values", () => {
    expect(normalizeUiZoom("0")).toBe(UI_ZOOM_MIN);
    expect(normalizeUiZoom("2")).toBe(UI_ZOOM_MAX);
    expect(normalizeUiZoom(1.234)).toBe(1.23);
  });
});
