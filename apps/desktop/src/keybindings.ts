// Keybinding model: VS Code-flavored defaults that are fully remappable.
//
// A chord is a string like "Mod+Enter" or "Mod+Shift+P". "Mod" is the platform
// primary modifier — Cmd on macOS, Ctrl everywhere else — so one default map
// feels native on both. User overrides are stored per command id in localStorage
// and merged over the defaults.

export type Keymap = Record<string, string>;

const STORAGE_KEY = "irodori.keymap.overrides";

export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/** Command ids the app knows how to run, paired with a human label + category. */
export interface CommandMeta {
  id: string;
  title: string;
  category: string;
}

export const commandCatalog: CommandMeta[] = [
  { id: "palette.open", title: "Show All Commands", category: "General" },
  { id: "query.run", title: "Run current statement", category: "Query" },
  { id: "query.cancel", title: "Cancel running query", category: "Query" },
  { id: "editor.focus", title: "Focus SQL editor", category: "Editor" },
  { id: "result.export", title: "Export result as CSV", category: "Result" },
  { id: "edit.toggle", title: "Toggle Edit Data mode", category: "Edit" },
  { id: "edit.addRow", title: "Add row", category: "Edit" },
  { id: "edit.commit", title: "Commit staged edits", category: "Edit" },
];

/** VS Code-flavored default keymap. */
export const defaultKeymap: Keymap = {
  "palette.open": "Mod+Shift+P",
  "query.run": "Mod+Enter",
  "query.cancel": "Mod+Shift+Backspace",
  "editor.focus": "Mod+1",
  "result.export": "Mod+Shift+S",
  "edit.toggle": "Mod+E",
  "edit.addRow": "Mod+Shift+Enter",
  "edit.commit": "Mod+S",
};

interface Parsed {
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function normalizeKey(key: string): string {
  if (key === " " || key === "Spacebar") {
    return "Space";
  }
  return key.length === 1 ? key.toUpperCase() : key;
}

function parse(chord: string): Parsed {
  const parsed: Parsed = {
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: "",
  };
  for (const raw of chord.split("+")) {
    const part = raw.trim();
    if (!part) {
      continue;
    }
    switch (part.toLowerCase()) {
      case "mod":
        parsed.mod = true;
        break;
      case "ctrl":
      case "control":
        parsed.ctrl = true;
        break;
      case "cmd":
      case "meta":
      case "super":
      case "win":
        parsed.meta = true;
        break;
      case "alt":
      case "option":
        parsed.alt = true;
        break;
      case "shift":
        parsed.shift = true;
        break;
      default:
        parsed.key = normalizeKey(part);
    }
  }
  return parsed;
}

function canonical(parsed: Parsed): string {
  const parts: string[] = [];
  if (parsed.mod) parts.push("Mod");
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.meta) parts.push("Meta");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(parsed.key);
  return parts.join("+");
}

function eventToParsed(event: KeyboardEvent): Parsed {
  const parsed: Parsed = {
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: normalizeKey(event.key),
  };
  if (isMac) {
    parsed.mod = event.metaKey;
    parsed.ctrl = event.ctrlKey;
  } else {
    parsed.mod = event.ctrlKey;
    parsed.meta = event.metaKey;
  }
  parsed.alt = event.altKey;
  parsed.shift = event.shiftKey;
  return parsed;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "Os"]);

/** Canonical chord for a key event, or null for a bare modifier press. */
export function eventToChord(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }
  return canonical(eventToParsed(event));
}

/** Does the event match this bound chord (platform Mod handled)? */
export function matchesChord(event: KeyboardEvent, chord: string): boolean {
  const eventChord = eventToChord(event);
  return eventChord !== null && eventChord === canonical(parse(chord));
}

/** Whether the chord has no platform modifier (so it must not hijack typing). */
export function isBareChord(chord: string): boolean {
  const parsed = parse(chord);
  return !parsed.mod && !parsed.ctrl && !parsed.meta && !parsed.alt;
}

/** Pretty, platform-aware label for a chord (e.g. "⌘⏎" on macOS, "Ctrl+Enter"). */
export function formatChord(chord: string): string {
  const parsed = parse(chord);
  const parts: string[] = [];
  if (parsed.mod) parts.push(isMac ? "⌘" : "Ctrl");
  if (parsed.ctrl) parts.push(isMac ? "⌃" : "Ctrl");
  if (parsed.meta) parts.push(isMac ? "⌘" : "Win");
  if (parsed.alt) parts.push(isMac ? "⌥" : "Alt");
  if (parsed.shift) parts.push(isMac ? "⇧" : "Shift");
  const key = parsed.key === "Enter" && isMac ? "⏎" : parsed.key;
  parts.push(key);
  return parts.join(isMac ? "" : "+");
}

/** Command ids that share a chord, keyed by the canonical chord. */
export function findConflicts(keymap: Keymap): Record<string, string[]> {
  const byChord: Record<string, string[]> = {};
  for (const [id, chord] of Object.entries(keymap)) {
    if (!chord) {
      continue;
    }
    const key = canonical(parse(chord));
    (byChord[key] ??= []).push(id);
  }
  return Object.fromEntries(
    Object.entries(byChord).filter(([, ids]) => ids.length > 1),
  );
}

export function loadOverrides(): Keymap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Keymap) : {};
  } catch {
    return {};
  }
}

export function saveOverrides(overrides: Keymap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Ignore storage failures (private mode, quota); bindings stay in-session.
  }
}

export function effectiveKeymap(overrides: Keymap): Keymap {
  return { ...defaultKeymap, ...overrides };
}
