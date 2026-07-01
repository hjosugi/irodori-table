import { describe, expect, it } from "vitest";
import {
  CUSTOM_PALETTE_MAX,
  addCustomPaletteColor,
  hexToHsv,
  hsvToHex,
  isHexColor,
  normalizeCustomPalette,
  normalizeHexColor,
  rgbToHsv,
} from "@/lib/color";

describe("normalizeHexColor", () => {
  it("canonicalizes casing, missing hash, and shorthand", () => {
    expect(normalizeHexColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeHexColor("aabbcc")).toBe("#aabbcc");
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
    expect(normalizeHexColor(" #Abc ")).toBe("#aabbcc");
  });

  it("rejects non-colors", () => {
    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor("#12g")).toBeNull();
    expect(normalizeHexColor("rgb(0,0,0)")).toBeNull();
    expect(normalizeHexColor(42)).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
  });
});

describe("isHexColor", () => {
  it("only accepts full six-digit hex", () => {
    expect(isHexColor("#aabbcc")).toBe(true);
    expect(isHexColor("#abc")).toBe(false);
    expect(isHexColor("aabbcc")).toBe(false);
  });
});

describe("hsv round trips", () => {
  it("preserves primary colors through hex/hsv conversion", () => {
    for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#123456", "#abcdef"]) {
      const hsv = hexToHsv(hex);
      expect(hsv).not.toBeNull();
      expect(hsvToHex(hsv!)).toBe(hex);
    }
  });

  it("maps pure red to hue 0 and full saturation/value", () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
  });

  it("maps black to zero value regardless of hue", () => {
    const hsv = rgbToHsv({ r: 0, g: 0, b: 0 });
    expect(hsv.v).toBe(0);
    expect(hsv.s).toBe(0);
  });
});

describe("normalizeCustomPalette", () => {
  it("drops invalid entries and de-duplicates case-insensitively", () => {
    expect(
      normalizeCustomPalette(["#AABBCC", "#aabbcc", "nope", 5, "#123"]),
    ).toEqual(["#aabbcc", "#112233"]);
  });

  it("keeps only the newest colors when over the cap", () => {
    const many = Array.from(
      { length: CUSTOM_PALETTE_MAX + 4 },
      (_, index) => `#0000${index.toString(16).padStart(2, "0")}`,
    );
    const result = normalizeCustomPalette(many);
    expect(result).toHaveLength(CUSTOM_PALETTE_MAX);
    expect(result[result.length - 1]).toBe(many[many.length - 1]);
  });

  it("returns an empty array for non-arrays", () => {
    expect(normalizeCustomPalette("nope")).toEqual([]);
    expect(normalizeCustomPalette(undefined)).toEqual([]);
  });
});

describe("addCustomPaletteColor", () => {
  it("appends a new color", () => {
    expect(addCustomPaletteColor(["#111111"], "#222222")).toEqual([
      "#111111",
      "#222222",
    ]);
  });

  it("moves an existing color to the end instead of duplicating", () => {
    expect(addCustomPaletteColor(["#111111", "#222222"], "#111111")).toEqual([
      "#222222",
      "#111111",
    ]);
  });

  it("caps the palette by dropping the oldest color", () => {
    const full = Array.from(
      { length: CUSTOM_PALETTE_MAX },
      (_, index) => `#0000${index.toString(16).padStart(2, "0")}`,
    );
    const result = addCustomPaletteColor(full, "#ffffff");
    expect(result).toHaveLength(CUSTOM_PALETTE_MAX);
    expect(result).not.toContain(full[0]);
    expect(result[result.length - 1]).toBe("#ffffff");
  });

  it("ignores invalid input", () => {
    expect(addCustomPaletteColor(["#111111"], "bogus")).toEqual(["#111111"]);
  });
});
