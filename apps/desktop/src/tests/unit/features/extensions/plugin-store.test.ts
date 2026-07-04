import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bundledPluginStoreCatalog,
  defaultPluginStoreCatalogUrl,
  fetchPluginStoreCatalog,
  type PluginStoreCatalog,
} from "@/features/extensions/plugin-store";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("plugin store catalog", () => {
  it("uses the installable marketplace index as the default remote source", () => {
    expect(defaultPluginStoreCatalogUrl).toBe(
      "https://raw.githubusercontent.com/hjosugi/irodori-table/main/registry/catalog/index.json",
    );
  });

  it("bundles install sources for every extension", () => {
    expect(bundledPluginStoreCatalog.extensions.length).toBeGreaterThan(0);

    for (const extension of bundledPluginStoreCatalog.extensions) {
      expect(extension.topics.length, extension.id).toBeGreaterThan(0);
      expect(extension.install, extension.id).toBeDefined();
      expect(extension.install?.kind, extension.id).toBe("githubRelease");
      expect(extension.install?.url, extension.id).toMatch(
        /^https:\/\/github\.com\/hjosugi\/irodori-extension-/,
      );
      expect(extension.install?.assetName, extension.id).toMatch(
        /^irodori-extension-.+\.tar\.gz$/,
      );
      expect(extension.install?.manifestPath, extension.id).toBe(
        "irodori.extension.json",
      );
    }
  });

  it("keeps install sources when fetching the default remote catalog shape", async () => {
    const catalog: PluginStoreCatalog = {
      schemaVersion: 1,
      updatedAt: "2026-07-03T00:00:00Z",
      source: "test",
      extensions: [bundledPluginStoreCatalog.extensions[0]],
    };
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => catalog,
    });
    vi.stubGlobal("fetch", fetch);

    const loaded = await fetchPluginStoreCatalog();

    expect(fetch).toHaveBeenCalledWith(defaultPluginStoreCatalogUrl, {
      headers: { accept: "application/json" },
    });
    expect(loaded.extensions[0].install).toEqual(catalog.extensions[0].install);
    expect(loaded.extensions[0].topics).toEqual(catalog.extensions[0].topics);
  });
});
