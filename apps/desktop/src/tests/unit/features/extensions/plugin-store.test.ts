import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertSupportedInstallKind,
  bundledPluginStoreCatalog,
  compareExtensionVersions,
  defaultPluginStoreCatalogUrl,
  fetchPluginStoreCatalog,
  resolvePluginStoreInstallAsset,
  UnsupportedInstallKindError,
  type PluginStoreCatalog,
  type PluginStoreInstallSource,
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
        /^https:\/\/github\.com\/hjosugi\/irodori-extension-.+\/releases\/tag\/v/,
      );
      expect(extension.install?.tag, extension.id).toBe(
        `v${extension.version}`,
      );
      const asset = resolvePluginStoreInstallAsset(extension, "x86_64-linux");
      expect(asset?.name, extension.id).toMatch(
        /^irodori-extension-.+\.tar\.gz$/,
      );
      expect(asset?.sha256, extension.id).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(extension.install?.manifestPath, extension.id).toBe(
        "irodori.extension.json",
      );
    }
  });

  it("bundles platform-independent declarative feature releases", () => {
    for (const id of ["irodori.knowledge", "irodori.datalake"]) {
      const extension = bundledPluginStoreCatalog.extensions.find(
        (candidate) => candidate.id === id,
      );
      expect(extension?.runtime, id).toBe("declarative");
      expect(extension?.permissions, id).toEqual(["hostFeatures"]);
      expect(extension?.engines, id).toEqual([]);

      const assets = extension?.install?.assets ?? {};
      expect(Object.keys(assets), id).toEqual([
        "aarch64-linux",
        "aarch64-macos",
        "aarch64-windows",
        "x86_64-linux",
        "x86_64-macos",
        "x86_64-windows",
      ]);
      expect(
        new Set(Object.values(assets).map((asset) => asset.name)).size,
      ).toBe(1);
      expect(
        new Set(Object.values(assets).map((asset) => asset.sha256)).size,
      ).toBe(1);
    }
  });

  it("bundles source-type contracts for vector and lakehouse extensions", () => {
    const qdrant = bundledPluginStoreCatalog.extensions.find(
      (extension) => extension.id === "irodori.qdrant",
    );
    const iceberg = bundledPluginStoreCatalog.extensions.find(
      (extension) => extension.id === "irodori.iceberg",
    );

    expect(qdrant?.contributes?.sourceTypes[0]).toMatchObject({
      engine: "qdrant",
      kind: "vector",
      workflows: expect.arrayContaining([
        "collectionBrowsing",
        "similaritySearch",
        "filteredSearch",
        "hybridSearch",
      ]),
      resultViews: expect.arrayContaining(["vectorNeighbors"]),
      queryTemplates: expect.arrayContaining([
        "vector-similarity",
        "vector-filtered",
      ]),
    });
    expect(iceberg?.contributes?.sourceTypes[0]).toMatchObject({
      engine: "iceberg",
      kind: "lakehouse",
      workflows: expect.arrayContaining([
        "catalogBrowsing",
        "tableFormatMetadata",
        "executionBackendSelection",
      ]),
      executionBackends: expect.arrayContaining(["duckdb", "athena"]),
      tableFormats: ["iceberg"],
    });
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
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    expect(loaded.extensions[0].install).toEqual(catalog.extensions[0].install);
    expect(loaded.extensions[0].topics).toEqual(catalog.extensions[0].topics);
    expect(loaded.extensions[0].contributes).toEqual(
      catalog.extensions[0].contributes,
    );
  });

  it("compares release versions for update decisions", () => {
    expect(compareExtensionVersions("0.1.3", "0.1.2")).toBeGreaterThan(0);
    expect(compareExtensionVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareExtensionVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareExtensionVersions("1.0.0", "1.0.0-rc.2")).toBeGreaterThan(0);
  });
});

describe("assertSupportedInstallKind (#160)", () => {
  const install: PluginStoreInstallSource = {
    kind: "githubRelease",
    url: "https://github.com/hjosugi/irodori-extension-demo/releases",
    tag: "v1.0.0",
    manifestPath: "irodori.extension.json",
    assets: {
      "x86_64-linux": {
        name: "irodori-extension-demo.tar.gz",
        sha256: `sha256:${"a".repeat(64)}`,
      },
    },
  };

  it("accepts a githubRelease source", () => {
    expect(() => assertSupportedInstallKind(install)).not.toThrow();
  });

  it("rejects any other kind with a typed, self-explanatory error", () => {
    let thrown: unknown;
    try {
      assertSupportedInstallKind({ ...install, kind: "git" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnsupportedInstallKindError);
    const error = thrown as UnsupportedInstallKindError;
    expect(error.kind).toBe("git");
    expect(error.message).toContain("`git`");
    expect(error.message).toContain("githubRelease");
  });
});
