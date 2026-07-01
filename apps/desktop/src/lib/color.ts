// Pure color helpers shared by the reusable ColorPicker and the preferences
// store. Kept free of DOM and React so both sides (and unit tests) can rely on
// the same normalization and HSV/RGB math.

export type Rgb = { r: number; g: number; b: number };
/** Hue in degrees (0-360), saturation and value in the 0-1 range. */
export type Hsv = { h: number; s: number; v: number };

/** Largest custom palette the user can keep ("最大10色"). */
export const CUSTOM_PALETTE_MAX = 10;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

/**
 * Coerce user input (`#abc`, `ABCDEF`, `#AbCdEf`) into a canonical lowercase
 * `#rrggbb` string, or `null` when it is not a color.
 */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    const expanded = raw
      .split("")
      .map((char) => char + char)
      .join("");
    return `#${expanded.toLowerCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) {
    return `#${raw.toLowerCase()}`;
  }
  return null;
}

export function hexToRgb(hex: string): Rgb | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) {
    return null;
  }
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (value: number) =>
    clampByte(value).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      h = (bn - rn) / delta + 2;
    } else {
      h = (rn - gn) / delta + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = v - c;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function hexToHsv(hex: string): Hsv | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(rgb) : null;
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}

/**
 * Validate, de-duplicate (case-insensitively), and cap a stored custom palette.
 * Order is preserved; when the list is over the cap the oldest entries at the
 * front are dropped so the newest colors survive.
 */
export function normalizeCustomPalette(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const colors: string[] = [];
  for (const entry of value) {
    const hex = normalizeHexColor(entry);
    if (!hex || seen.has(hex)) {
      continue;
    }
    seen.add(hex);
    colors.push(hex);
  }
  return colors.length > CUSTOM_PALETTE_MAX
    ? colors.slice(colors.length - CUSTOM_PALETTE_MAX)
    : colors;
}

/**
 * Append a color to a custom palette, moving an existing match to the end and
 * dropping the oldest entry once the cap is exceeded. Returns the same array
 * reference when the color is invalid so callers can skip no-op updates.
 */
export function addCustomPaletteColor(
  palette: readonly string[],
  color: unknown,
): string[] {
  const hex = normalizeHexColor(color);
  if (!hex) {
    return palette.slice();
  }
  const withoutColor = palette.filter((entry) => entry.toLowerCase() !== hex);
  const next = [...withoutColor, hex];
  return next.length > CUSTOM_PALETTE_MAX
    ? next.slice(next.length - CUSTOM_PALETTE_MAX)
    : next;
}
