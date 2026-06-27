import { beforeEach, describe, expect, it } from "vitest";
import {
  appCommandCatalog,
  appMenuCommandCatalog,
  fallbackSnapshot,
  initialQuery,
  loadSavedQuery,
  resultCopyDefaultKeymap,
  savedQueryStorageKey,
  workspaceMenuSections,
} from "@/app/app-config";
import { defaultKeymap } from "@/core/keybindings";

const legacySeedQuery = `select
  c.id,
  c.name,
  sum(o.total) as lifetime_value,
  max(o.created_at) as last_order_at
from customers c
join orders o on o.customer_id = c.id
where o.created_at >= now() - interval '90 days'
group by c.id, c.name
order by lifetime_value desc
limit 200;`;

function installLocalStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });
}

beforeEach(() => {
  installLocalStorage();
});

describe("app command config", () => {
  it("keeps command ids unique", () => {
    const ids = appCommandCatalog.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("catalogs every default keybinding target", () => {
    const catalogIds = new Set(appCommandCatalog.map((command) => command.id));
    const keymapIds = [
      ...Object.keys(defaultKeymap),
      ...Object.keys(resultCopyDefaultKeymap),
    ];

    for (const commandId of keymapIds) {
      expect(catalogIds.has(commandId), commandId).toBe(true);
    }
  });

  it("only references known commands from the workspace menu", () => {
    const catalogIds = new Set(
      appMenuCommandCatalog.map((command) => command.id),
    );

    for (const section of workspaceMenuSections) {
      expect(section.items.length, section.label).toBeGreaterThan(0);
      for (const item of section.items) {
        expect(catalogIds.has(item.commandId), item.commandId).toBe(true);
      }
    }
  });
});

describe("debug startup defaults", () => {
  it("uses a clean fallback snapshot without demo objects", () => {
    expect(fallbackSnapshot.activeConnectionId).toBe("local-pg");
    expect(fallbackSnapshot.connections).toHaveLength(1);
    expect(fallbackSnapshot.connections[0]?.objects).toEqual([]);
  });

  it("starts with an empty editor when no query was saved", () => {
    window.localStorage.removeItem(savedQueryStorageKey);

    expect(initialQuery).toBe("");
    expect(loadSavedQuery()).toBe("");
  });

  it("treats the old demo seed query as an empty default", () => {
    window.localStorage.setItem(savedQueryStorageKey, legacySeedQuery);

    expect(loadSavedQuery()).toBe("");
  });

  it("starts clean in dev even when a real query was saved", () => {
    window.localStorage.setItem(savedQueryStorageKey, "select 1;");

    expect(loadSavedQuery()).toBe("");
  });

  it("can restore a real user-saved query when requested", () => {
    window.localStorage.setItem(savedQueryStorageKey, "select 1;");

    expect(loadSavedQuery({ restoreSaved: true })).toBe("select 1;");
  });
});
