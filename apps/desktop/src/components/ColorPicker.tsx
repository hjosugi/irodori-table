import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Plus, X } from "lucide-react";
import { usePreferencesStore } from "@/features/preferences";
import {
  CUSTOM_PALETTE_MAX,
  clamp01,
  hexToHsv,
  hsvToHex,
  normalizeHexColor,
  type Hsv,
} from "@/lib/color";

/** Theme accent CSS variables surfaced as the "Theme" swatch row. */
const themeColorVars = [
  "--red",
  "--amber",
  "--green",
  "--teal",
  "--blue",
  "--purple",
];

/** Fixed presets shown under "Default" (12 colors, two rows of six). */
const defaultSwatches = [
  "#111827",
  "#6b7280",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#22c55e",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

const fallbackHsv: Hsv = { h: 210, s: 0.72, v: 0.9 };

function readThemeSwatches(): string[] {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle !== "function"
  ) {
    return [];
  }
  const host = document.querySelector(".app-shell") ?? document.documentElement;
  const styles = getComputedStyle(host as Element);
  const colors: string[] = [];
  for (const name of themeColorVars) {
    const value = styles.getPropertyValue(name).trim();
    const hex = normalizeHexColor(value);
    if (hex && !colors.includes(hex)) {
      colors.push(hex);
    }
  }
  return colors;
}

export type ColorPickerProps = {
  /** Currently selected color as `#rrggbb`, or `null` when using a fallback. */
  value: string | null;
  onChange: (color: string) => void;
  /** Color the picker opens on when `value` is null (e.g. a theme default). */
  fallbackColor?: string;
};

/**
 * Solid color picker with an HSV area, hue slider, hex input, and three swatch
 * rows: theme accents, fixed defaults, and the user's persisted custom palette
 * (capped at {@link CUSTOM_PALETTE_MAX}). Custom colors are stored in
 * preferences so the palette follows the user across the app.
 */
export function ColorPicker({
  value,
  onChange,
  fallbackColor,
}: ColorPickerProps) {
  const initialHex =
    normalizeHexColor(value) ?? normalizeHexColor(fallbackColor);
  const hsvRef = useRef<Hsv>(
    (initialHex && hexToHsv(initialHex)) || fallbackHsv,
  );
  const [hsv, setHsv] = useState<Hsv>(hsvRef.current);
  const [hexDraft, setHexDraft] = useState<string>(hsvToHex(hsvRef.current));
  const svDragging = useRef(false);
  const hueDragging = useRef(false);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const themeColors = useMemo(readThemeSwatches, []);
  const customPalette = usePreferencesStore((state) => state.customPalette);
  const addCustomColor = usePreferencesStore(
    (state) => state.addCustomPaletteColor,
  );
  const removeCustomColor = usePreferencesStore(
    (state) => state.removeCustomPaletteColor,
  );

  const currentHex = hsvToHex(hsv);

  // Resync when the color is changed from outside (e.g. a swatch in a peer
  // control) without clobbering hue while the user drags a gray/black value.
  useEffect(() => {
    const normalized = normalizeHexColor(value);
    if (!normalized || normalized === hsvToHex(hsvRef.current)) {
      return;
    }
    const nextHsv = hexToHsv(normalized);
    if (nextHsv) {
      hsvRef.current = nextHsv;
      setHsv(nextHsv);
      setHexDraft(normalized);
    }
  }, [value]);

  function applyHsv(next: Hsv) {
    hsvRef.current = next;
    setHsv(next);
    const hex = hsvToHex(next);
    setHexDraft(hex);
    onChange(hex);
  }

  function applyHex(hex: string) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) {
      return;
    }
    const nextHsv = hexToHsv(normalized);
    if (!nextHsv) {
      return;
    }
    hsvRef.current = nextHsv;
    setHsv(nextHsv);
    setHexDraft(normalized);
    onChange(normalized);
  }

  function updateFromSv(event: ReactPointerEvent) {
    const rect = svRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) {
      return;
    }
    const s = clamp01((event.clientX - rect.left) / rect.width);
    const v = 1 - clamp01((event.clientY - rect.top) / rect.height);
    applyHsv({ h: hsvRef.current.h, s, v });
  }

  function updateFromHue(event: ReactPointerEvent) {
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      return;
    }
    const h = clamp01((event.clientX - rect.left) / rect.width) * 360;
    applyHsv({ h, s: hsvRef.current.s, v: hsvRef.current.v });
  }

  const hueHex = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <div
      className="color-picker"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={svRef}
        className="color-picker-sv"
        style={{ background: hueHex }}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={currentHex}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          svDragging.current = true;
          updateFromSv(event);
        }}
        onPointerMove={(event) => {
          if (svDragging.current) {
            updateFromSv(event);
          }
        }}
        onPointerUp={(event) => {
          svDragging.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <div className="color-picker-sv-white" />
        <div className="color-picker-sv-black" />
        <div
          className="color-picker-thumb"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            background: currentHex,
          }}
        />
      </div>
      <div
        ref={hueRef}
        className="color-picker-hue"
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          hueDragging.current = true;
          updateFromHue(event);
        }}
        onPointerMove={(event) => {
          if (hueDragging.current) {
            updateFromHue(event);
          }
        }}
        onPointerUp={(event) => {
          hueDragging.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <div
          className="color-picker-hue-thumb"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>
      <div className="color-picker-hex">
        <span
          className="color-picker-hex-preview"
          style={{ background: currentHex }}
        />
        <span className="color-picker-hex-hash">#</span>
        <input
          className="color-picker-hex-input"
          value={hexDraft.replace(/^#/, "")}
          spellCheck={false}
          maxLength={7}
          aria-label="Hex color"
          onChange={(event) => setHexDraft(event.currentTarget.value)}
          onBlur={() => applyHex(hexDraft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              applyHex(hexDraft);
            }
          }}
        />
      </div>
      {themeColors.length > 0 ? (
        <SwatchRow
          label="Theme"
          colors={themeColors}
          activeColor={currentHex}
          onPick={applyHex}
        />
      ) : null}
      <SwatchRow
        label="Default"
        colors={defaultSwatches}
        activeColor={currentHex}
        onPick={applyHex}
      />
      <div className="color-picker-section">
        <div className="color-picker-section-head">
          <span>Custom</span>
          <span className="color-picker-count">
            {customPalette.length}/{CUSTOM_PALETTE_MAX}
          </span>
        </div>
        <div className="color-swatch-row">
          {customPalette.map((color) => (
            <span key={color} className="color-swatch-slot">
              <button
                type="button"
                className={
                  color.toLowerCase() === currentHex
                    ? "color-swatch is-active"
                    : "color-swatch"
                }
                style={{ background: color }}
                title={color}
                aria-label={`Use ${color}`}
                onClick={() => applyHex(color)}
              />
              <button
                type="button"
                className="color-swatch-remove"
                aria-label={`Remove ${color}`}
                title="Remove"
                onClick={() => removeCustomColor(color)}
              >
                <X size={9} />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="color-swatch-add"
            aria-label="Add current color to custom palette"
            title="Add current color"
            onClick={() => addCustomColor(currentHex)}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function SwatchRow({
  label,
  colors,
  activeColor,
  onPick,
}: {
  label: string;
  colors: string[];
  activeColor: string;
  onPick: (color: string) => void;
}) {
  return (
    <div className="color-picker-section">
      <div className="color-picker-section-head">
        <span>{label}</span>
      </div>
      <div className="color-swatch-row">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            className={
              color.toLowerCase() === activeColor
                ? "color-swatch is-active"
                : "color-swatch"
            }
            style={{ background: color }}
            title={color}
            aria-label={`Use ${color}`}
            onClick={() => onPick(color)}
          />
        ))}
      </div>
    </div>
  );
}

export type ColorPickerButtonProps = ColorPickerProps & {
  ariaLabel: string;
  title?: string;
};

/**
 * A swatch button that toggles a {@link ColorPicker} popover, closing on
 * outside click or Escape. The button preview reflects the active color, or the
 * fallback when none is set.
 */
export function ColorPickerButton({
  value,
  onChange,
  fallbackColor,
  ariaLabel,
  title,
}: ColorPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const preview = normalizeHexColor(value) ?? fallbackColor ?? "#3b82f6";

  return (
    <div className="color-picker-anchor" ref={rootRef}>
      <button
        type="button"
        className="color-swatch-button"
        style={{ background: preview }}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title ?? ariaLabel}
        onClick={() => setOpen((current) => !current)}
      />
      {open ? (
        <div
          className="color-picker-popover"
          role="dialog"
          aria-label={ariaLabel}
        >
          <ColorPicker
            value={value}
            onChange={onChange}
            fallbackColor={fallbackColor}
          />
        </div>
      ) : null}
    </div>
  );
}
