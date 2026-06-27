// Keybinding model: VS Code-flavored defaults that are fully remappable.
//
// A key sequence is one or more chords: "Mod+Enter" or "Mod+K Mod+F". "Mod" is
// the platform primary modifier — Cmd on macOS, Ctrl everywhere else — so one
// default map feels native on both. User overrides are stored per command id in
// localStorage and merged over the defaults.

export type Keymap = Record<string, string>;
export type KeybindingScope = "global" | "editor" | "grid";

export const keybindingScopes: readonly KeybindingScope[] = [
  "global",
  "editor",
  "grid",
];

export const KEY_SEQUENCE_TIMEOUT_MS = 1200;

const STORAGE_KEY = "irodori.keymap.overrides";

export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/** Command ids the app knows how to run, paired with a human label + category. */
export interface CommandMeta {
  id: string;
  title: string;
  category: string;
  scope: KeybindingScope;
}

export const commandCatalog: CommandMeta[] = [
  {
    id: "palette.open",
    title: "Show All Commands",
    category: "General",
    scope: "global",
  },
  {
    id: "diagram.show",
    title: "Show ER diagram",
    category: "General",
    scope: "global",
  },
  {
    id: "schema.indexBuild",
    title: "Build schema search index",
    category: "General",
    scope: "global",
  },
  {
    id: "migration.studio",
    title: "Open Migration Studio",
    category: "General",
    scope: "global",
  },
  {
    id: "tab.new",
    title: "New SQL tab",
    category: "Workspace",
    scope: "global",
  },
  {
    id: "tab.close",
    title: "Close active SQL tab",
    category: "Workspace",
    scope: "global",
  },
  {
    id: "query.run",
    title: "Run selection or current statement",
    category: "Query",
    scope: "editor",
  },
  {
    id: "query.runCurrent",
    title: "Run current statement",
    category: "Query",
    scope: "editor",
  },
  {
    id: "query.runFromStart",
    title: "Run from top to cursor",
    category: "Query",
    scope: "editor",
  },
  {
    id: "query.runAll",
    title: "Run all statements",
    category: "Query",
    scope: "editor",
  },
  {
    id: "query.cancel",
    title: "Cancel running query",
    category: "Query",
    scope: "global",
  },
  {
    id: "editor.focus",
    title: "Focus SQL editor",
    category: "Editor",
    scope: "global",
  },
  {
    id: "editor.format",
    title: "Format SQL",
    category: "Editor",
    scope: "editor",
  },
  {
    id: "editor.quickDefinition",
    title: "Quick Definition",
    category: "Editor",
    scope: "editor",
  },
  {
    id: "editor.quickFix",
    title: "Show Problems and Quick Fixes",
    category: "Editor",
    scope: "editor",
  },
  {
    id: "editor.cleanup",
    title: "Code Cleanup",
    category: "Editor",
    scope: "editor",
  },
  {
    id: "editor.comment.toggle",
    title: "Toggle SQL comment",
    category: "Editor",
    scope: "editor",
  },
  {
    id: "editor.transform.uppercase",
    title: "Uppercase selection or current line",
    category: "Editor",
    scope: "editor",
  },
  {
    id: "editor.transform.lowercase",
    title: "Lowercase selection or current line",
    category: "Editor",
    scope: "editor",
  },
  {
    id: "editor.transform.addCommas",
    title: "Add commas to selected lines",
    category: "Editor",
    scope: "editor",
  },
  {
    id: "editor.transform.doubleToSingleQuotes",
    title: "Convert double quotes to single quotes",
    category: "Editor",
    scope: "editor",
  },
  {
    id: "result.export",
    title: "Export result as CSV",
    category: "Result",
    scope: "grid",
  },
  {
    id: "result.copySqlInserts",
    title: "Copy result as INSERT SQL",
    category: "Result",
    scope: "grid",
  },
  {
    id: "result.exportSqlInserts",
    title: "Download result as INSERT SQL",
    category: "Result",
    scope: "grid",
  },
  {
    id: "edit.toggle",
    title: "Toggle Edit Data mode",
    category: "Edit",
    scope: "grid",
  },
  {
    id: "edit.undo",
    title: "Undo staged edit",
    category: "Edit",
    scope: "grid",
  },
  { id: "edit.addRow", title: "Add row", category: "Edit", scope: "grid" },
  {
    id: "edit.commit",
    title: "Commit staged edits",
    category: "Edit",
    scope: "grid",
  },
];

/** VS Code-flavored default keymap. */
export const defaultKeymap: Keymap = {
  "palette.open": "Mod+Shift+P",
  "settings.open": "Mod+,",
  "tab.new": "Mod+T",
  "tab.close": "Mod+W",
  "view.zoomIn": "Mod+=",
  "view.zoomOut": "Mod+-",
  "view.zoomReset": "Mod+0",
  "diagram.show": "Mod+Shift+D",
  "query.run": "Mod+Enter",
  "query.runCurrent": "Mod+Shift+Enter",
  "query.runFromStart": "Mod+Alt+Shift+Enter",
  "query.runAll": "",
  "query.cancel": "Mod+Shift+Backspace",
  "editor.focus": "Mod+1",
  "editor.format": "Alt+Shift+F",
  "editor.quickDefinition": "Alt+F12",
  "editor.quickFix": "Alt+Enter",
  "editor.cleanup": "",
  "editor.comment.toggle": "Mod+/",
  "result.export": "Mod+Shift+S",
  "edit.toggle": "Mod+E",
  "edit.undo": "Mod+Z",
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

function canonicalChord(parsed: Parsed): string {
  const parts: string[] = [];
  if (parsed.mod) parts.push("Mod");
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.meta) parts.push("Meta");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  if (parsed.key) parts.push(parsed.key);
  return parts.join("+");
}

function sequenceParts(sequence: string): string[] {
  return sequence
    .trim()
    .split(/\s+/)
    .map((chord) => canonicalChord(parse(chord)))
    .filter((chord) => chord.length > 0);
}

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function startsWithSequence(
  sequence: readonly string[],
  prefix: readonly string[],
): boolean {
  return (
    prefix.length < sequence.length &&
    prefix.every((part, index) => sequence[index] === part)
  );
}

export function canonicalKeySequence(sequence: string): string {
  return sequenceParts(sequence).join(" ");
}

function eventToParsed(event: KeyboardEvent): Parsed {
  const key = normalizeKey(event.key);
  const zoomPlusKey = key === "+";
  const parsed: Parsed = {
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: zoomPlusKey ? "=" : key,
  };
  if (isMac) {
    parsed.mod = event.metaKey;
    parsed.ctrl = event.ctrlKey;
  } else {
    parsed.mod = event.ctrlKey;
    parsed.meta = event.metaKey;
  }
  parsed.alt = event.altKey;
  parsed.shift = zoomPlusKey ? false : event.shiftKey;
  return parsed;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "Os"]);

/** Canonical chord for a key event, or null for a bare modifier press. */
export function eventToChord(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }
  return canonicalChord(eventToParsed(event));
}

/** Does the event match this single-chord binding (platform Mod handled)? */
export function matchesChord(event: KeyboardEvent, chord: string): boolean {
  const eventChord = eventToChord(event);
  const parts = sequenceParts(chord);
  return eventChord !== null && parts.length === 1 && eventChord === parts[0];
}

/** Whether the chord has no platform modifier (so it must not hijack typing). */
export function isBareChord(chord: string): boolean {
  const parsed = parse(chord);
  return !parsed.mod && !parsed.ctrl && !parsed.meta && !parsed.alt;
}

/** Whether every chord in a sequence has no platform modifier. */
export function isBareSequence(sequence: string): boolean {
  const parts = sequenceParts(sequence);
  return parts.length > 0 && parts.every(isBareChord);
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

export function formatKeySequence(sequence: string): string {
  return sequenceParts(sequence).map(formatChord).join(" ");
}

export function commandAppliesToScope(
  command: CommandMeta,
  scope: KeybindingScope,
): boolean {
  return command.scope === "global" || command.scope === scope;
}

function conflictScopes(command: CommandMeta): readonly KeybindingScope[] {
  return command.scope === "global" ? keybindingScopes : [command.scope];
}

export type KeymapConflicts = Record<KeybindingScope, Record<string, string[]>>;

/** Command ids that share a key sequence, keyed by scope and canonical sequence. */
export function findConflicts(
  keymap: Keymap,
  commands: readonly CommandMeta[] = commandCatalog,
): KeymapConflicts {
  const byScope = Object.fromEntries(
    keybindingScopes.map((scope) => [scope, {}]),
  ) as KeymapConflicts;

  for (const command of commands) {
    const sequence = canonicalKeySequence(keymap[command.id] ?? "");
    if (!sequence) {
      continue;
    }
    for (const scope of conflictScopes(command)) {
      (byScope[scope][sequence] ??= []).push(command.id);
    }
  }

  return Object.fromEntries(
    Object.entries(byScope).map(([scope, sequences]) => [
      scope,
      Object.fromEntries(
        Object.entries(sequences).filter(([, ids]) => ids.length > 1),
      ),
    ]),
  ) as KeymapConflicts;
}

export function commandHasConflict(
  conflicts: KeymapConflicts,
  commandId: string,
  scope?: KeybindingScope,
): boolean {
  const scopes = scope ? [scope] : keybindingScopes;
  return scopes.some((currentScope) =>
    Object.values(conflicts[currentScope]).some((ids) => ids.includes(commandId)),
  );
}

export type KeybindingResolution =
  | { kind: "none"; pending: [] }
  | { kind: "pending"; pending: string[]; sequence: string }
  | { kind: "command"; commandId: string; pending: []; sequence: string };

export function resolveKeybinding({
  keymap,
  scope,
  chord,
  pending = [],
  commands = commandCatalog,
  allowBare = true,
}: {
  keymap: Keymap;
  scope: KeybindingScope;
  chord: string;
  pending?: readonly string[];
  commands?: readonly CommandMeta[];
  allowBare?: boolean;
}): KeybindingResolution {
  const current = [...pending, ...sequenceParts(chord)];
  if (current.length === 0) {
    return { kind: "none", pending: [] };
  }

  const bindings = commands
    .filter((command) => commandAppliesToScope(command, scope))
    .map((command) => {
      const sequence = canonicalKeySequence(keymap[command.id] ?? "");
      return {
        command,
        sequence,
        parts: sequenceParts(sequence),
      };
    })
    .filter(
      ({ sequence, parts }) =>
        sequence.length > 0 && parts.length > 0 && (allowBare || !isBareSequence(sequence)),
    );

  const prefix = bindings.some(({ parts }) => startsWithSequence(parts, current));
  if (prefix) {
    return {
      kind: "pending",
      pending: current,
      sequence: current.join(" "),
    };
  }

  const exact = bindings.find(({ parts }) => sameSequence(parts, current));
  if (exact) {
    return {
      kind: "command",
      commandId: exact.command.id,
      pending: [],
      sequence: exact.sequence,
    };
  }

  return { kind: "none", pending: [] };
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
