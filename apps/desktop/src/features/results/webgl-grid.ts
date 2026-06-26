export type WebGlResultGridHit =
  | { kind: "header"; columnIndex: number }
  | { kind: "cell"; rowIndex: number; columnIndex: number };

export type WebGlResultGridHitInput = {
  x: number;
  y: number;
  scrollLeft: number;
  scrollTop: number;
  headerHeight: number;
  rowHeight: number;
  columnWidth: number;
  rowCount: number;
  columnCount: number;
};

export type WebGlRgba = readonly [number, number, number, number];

export const fallbackWebGlColor: WebGlRgba = [0, 0, 0, 1];

export function hitTestWebGlResultGrid({
  x,
  y,
  scrollLeft,
  scrollTop,
  headerHeight,
  rowHeight,
  columnWidth,
  rowCount,
  columnCount,
}: WebGlResultGridHitInput): WebGlResultGridHit | null {
  if (
    !isFiniteNonNegative(x) ||
    !isFiniteNonNegative(y) ||
    !isPositiveFinite(headerHeight) ||
    !isPositiveFinite(rowHeight) ||
    !isPositiveFinite(columnWidth)
  ) {
    return null;
  }

  const columnIndex = Math.floor((Math.max(0, scrollLeft) + x) / columnWidth);
  if (columnIndex < 0 || columnIndex >= Math.max(0, columnCount)) {
    return null;
  }

  if (y < headerHeight) {
    return { kind: "header", columnIndex };
  }

  const rowIndex = Math.floor(
    (Math.max(0, scrollTop) + y - headerHeight) / rowHeight,
  );
  if (rowIndex < 0 || rowIndex >= Math.max(0, rowCount)) {
    return null;
  }
  return { kind: "cell", rowIndex, columnIndex };
}

export function webGlResultGridScrollSize({
  columnCount,
  columnWidth,
  headerHeight,
  rowCount,
  rowHeight,
}: {
  columnCount: number;
  columnWidth: number;
  headerHeight: number;
  rowCount: number;
  rowHeight: number;
}) {
  return {
    width: Math.max(1, Math.max(0, columnCount) * columnWidth),
    height: Math.max(1, headerHeight + Math.max(0, rowCount) * rowHeight),
  };
}

export function parseWebGlColor(
  value: string | null | undefined,
  fallback: WebGlRgba = fallbackWebGlColor,
): WebGlRgba {
  const input = value?.trim();
  if (!input) {
    return fallback;
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input);
  if (hex) {
    const raw = hex[1];
    if (raw.length === 3) {
      return [
        parseInt(raw[0] + raw[0], 16) / 255,
        parseInt(raw[1] + raw[1], 16) / 255,
        parseInt(raw[2] + raw[2], 16) / 255,
        1,
      ];
    }
    return [
      parseInt(raw.slice(0, 2), 16) / 255,
      parseInt(raw.slice(2, 4), 16) / 255,
      parseInt(raw.slice(4, 6), 16) / 255,
      raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1,
    ];
  }

  const rgb =
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(
      input,
    );
  if (rgb) {
    return [
      clampColorChannel(Number(rgb[1])) / 255,
      clampColorChannel(Number(rgb[2])) / 255,
      clampColorChannel(Number(rgb[3])) / 255,
      rgb[4] === undefined ? 1 : clampAlpha(Number(rgb[4])),
    ];
  }

  return fallback;
}

function isFiniteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

function clampColorChannel(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : 0;
}

function clampAlpha(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}
