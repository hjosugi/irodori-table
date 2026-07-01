import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let UI_ZOOM_DEFAULT = 1;
let UI_ZOOM_MAX = 1.5;
let UI_ZOOM_MIN = 0.75;
let normalizeUiZoom: (value: unknown) => number;

const themeStorageKey = "irodori.theme.v1";
const customPaletteStorageKey = "irodori.ui.customPalette.v1";

function installLocalStorage(initialValues = new Map<string, string>()) {
  const values = new Map(initialValues);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => {
        values.clear();
      },
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => Array.from(values.keys())[index] ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  });
  return values;
}

function installMatchMedia(matches: boolean) {
  let currentMatches = matches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media: MediaQueryList = {
    media: "(prefers-color-scheme: dark)",
    get matches() {
      return currentMatches;
    },
    onchange: null,
    addEventListener: (
      _event: "change",
      listener: EventListenerOrEventListenerObject,
    ) => {
      listeners.add(listener as (event: MediaQueryListEvent) => void);
    },
    removeEventListener: (
      _event: "change",
      listener: EventListenerOrEventListenerObject,
    ) => {
      listeners.delete(listener as (event: MediaQueryListEvent) => void);
    },
    addListener: (listener) => {
      listeners.add(listener as (event: MediaQueryListEvent) => void);
    },
    removeListener: (listener) => {
      listeners.delete(listener as (event: MediaQueryListEvent) => void);
    },
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => media),
  });

  return {
    setMatches(nextMatches: boolean) {
      currentMatches = nextMatches;
      for (const listener of listeners) {
        listener({
          matches: nextMatches,
          media: media.media,
        } as MediaQueryListEvent);
      }
    },
  };
}

async function loadPreferencesStore() {
  vi.resetModules();
  const preferences = await import("@/features/preferences");
  return preferences.usePreferencesStore;
}

beforeAll(async () => {
  installLocalStorage();
  installMatchMedia(false);

  const preferences = await import("@/features/preferences");
  UI_ZOOM_DEFAULT = preferences.UI_ZOOM_DEFAULT;
  UI_ZOOM_MAX = preferences.UI_ZOOM_MAX;
  UI_ZOOM_MIN = preferences.UI_ZOOM_MIN;
  normalizeUiZoom = preferences.normalizeUiZoom;
});

beforeEach(() => {
  installLocalStorage();
  installMatchMedia(false);
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

describe("theme preferences", () => {
  it("defaults to the system theme and follows OS changes", async () => {
    const media = installMatchMedia(true);
    const store = await loadPreferencesStore();

    expect(store.getState().themePreference).toBe("system");
    expect(store.getState().themeKind).toBe("dark");

    media.setMatches(false);

    expect(store.getState().themePreference).toBe("system");
    expect(store.getState().themeKind).toBe("light");
  });

  it("stores a fixed dark or light choice instead of following OS changes", async () => {
    const media = installMatchMedia(false);
    const store = await loadPreferencesStore();

    store.getState().setThemeKind("dark");

    expect(store.getState().themePreference).toBe("dark");
    expect(store.getState().themeKind).toBe("dark");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("dark");

    media.setMatches(false);

    expect(store.getState().themePreference).toBe("dark");
    expect(store.getState().themeKind).toBe("dark");
  });

  it("loads a saved system preference against the current OS theme", async () => {
    installLocalStorage(new Map([[themeStorageKey, "system"]]));
    installMatchMedia(true);

    const store = await loadPreferencesStore();

    expect(store.getState().themePreference).toBe("system");
    expect(store.getState().themeKind).toBe("dark");
  });

  it("loads a saved fixed preference without using the current OS theme", async () => {
    installLocalStorage(new Map([[themeStorageKey, "light"]]));
    installMatchMedia(true);

    const store = await loadPreferencesStore();

    expect(store.getState().themePreference).toBe("light");
    expect(store.getState().themeKind).toBe("light");
  });
});

describe("custom palette", () => {
  it("starts empty and persists added colors", async () => {
    const values = installLocalStorage();
    const store = await loadPreferencesStore();

    expect(store.getState().customPalette).toEqual([]);

    store.getState().addCustomPaletteColor("#AABBCC");

    expect(store.getState().customPalette).toEqual(["#aabbcc"]);
    expect(values.get(customPaletteStorageKey)).toBe(
      JSON.stringify(["#aabbcc"]),
    );
  });

  it("de-duplicates and removes colors", async () => {
    installLocalStorage();
    const store = await loadPreferencesStore();

    store.getState().addCustomPaletteColor("#111111");
    store.getState().addCustomPaletteColor("#222222");
    store.getState().addCustomPaletteColor("#111111");
    expect(store.getState().customPalette).toEqual(["#222222", "#111111"]);

    store.getState().removeCustomPaletteColor("#222222");
    expect(store.getState().customPalette).toEqual(["#111111"]);
  });

  it("normalizes an invalid stored palette on load", async () => {
    installLocalStorage(
      new Map([
        [customPaletteStorageKey, JSON.stringify(["#ABC", "nope", "#abc"])],
      ]),
    );
    const store = await loadPreferencesStore();

    expect(store.getState().customPalette).toEqual(["#aabbcc"]);
  });
});
