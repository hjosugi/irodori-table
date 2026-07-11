import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bundledKnowledgePack,
  defaultKnowledgePackUrl,
  fetchKnowledgePack,
  knowledgeForEngine,
  knowledgeForProduct,
  searchKnowledgeFacts,
  type KnowledgePack,
} from "@/features/knowledge/knowledge-pack";

afterEach(() => {
  vi.unstubAllGlobals();
});

const samplePack: KnowledgePack = {
  schemaVersion: 1,
  updatedAt: "2026-07-11T00:00:00Z",
  source: "test-knowledge-pack",
  products: [
    {
      product: "PostgreSQL",
      engineId: "postgres",
      facts: [
        {
          area: "sql_dialect",
          title: "PostgreSQL: MERGE improvements",
          summary: "MERGE gained RETURNING support in the current release.",
          priority: "high",
          confidence: "medium",
          observedAt: "2026-07-01T00:00:00Z",
          url: "https://www.postgresql.org/docs/current/",
        },
        {
          area: "auth",
          title: "PostgreSQL: SCRAM notes",
          summary: "Authentication docs describe SCRAM channel binding.",
          priority: "normal",
          confidence: "high",
          observedAt: "2026-07-01T00:00:00Z",
        },
      ],
    },
    {
      product: "DBeaver",
      facts: [
        {
          area: "client_market",
          title: "DBeaver: release cadence",
          summary: "Client release notes track monthly feature drops.",
          priority: "low",
          confidence: "medium",
          observedAt: "2026-07-01T00:00:00Z",
        },
      ],
    },
  ],
};

describe("knowledge pack", () => {
  it("uses the published registry pack as the default remote source", () => {
    expect(defaultKnowledgePackUrl).toBe(
      "https://raw.githubusercontent.com/hjosugi/irodori-table/main/registry/knowledge-pack.json",
    );
  });

  it("bundles a normalized pack", () => {
    expect(bundledKnowledgePack.schemaVersion).toBe(1);
    expect(bundledKnowledgePack.source).toBe("bundled-knowledge-pack");
    expect(Array.isArray(bundledKnowledgePack.products)).toBe(true);

    for (const product of bundledKnowledgePack.products) {
      expect(product.product, product.product).toBeTruthy();
      expect(product.facts.length, product.product).toBeGreaterThan(0);
      for (const fact of product.facts) {
        expect(fact.area, product.product).toBeTruthy();
        expect(fact.title, product.product).toBeTruthy();
        expect(fact.summary, product.product).toBeTruthy();
      }
    }
  });

  it("keys engine-linked products by the canonical engine id vocabulary", () => {
    const engineIds = new Set(
      bundledKnowledgePack.products
        .map((product) => product.engineId)
        .filter((engineId): engineId is string => Boolean(engineId)),
    );
    expect(engineIds.size).toBeGreaterThan(0);
    for (const engineId of engineIds) {
      expect(engineId).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
  });

  it("looks up products by engine id and product name", () => {
    expect(knowledgeForEngine(samplePack, "postgres")).toHaveLength(1);
    expect(knowledgeForEngine(samplePack, "mysql")).toHaveLength(0);
    expect(knowledgeForProduct(samplePack, "postgresql")?.engineId).toBe(
      "postgres",
    );
    expect(
      knowledgeForProduct(samplePack, "DBeaver")?.engineId,
    ).toBeUndefined();
  });

  it("searches facts case-insensitively across product, area, title, and summary", () => {
    const matches = searchKnowledgeFacts(samplePack, "scram");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.product).toBe("PostgreSQL");
    expect(matches[0]?.fact.area).toBe("auth");

    expect(searchKnowledgeFacts(samplePack, "client_market")).toHaveLength(1);
    expect(searchKnowledgeFacts(samplePack, "")).toHaveLength(0);
    expect(searchKnowledgeFacts(samplePack, "postgresql", 1)).toHaveLength(1);
  });

  it("fetches and normalizes a remote pack", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => samplePack,
    });
    vi.stubGlobal("fetch", fetchMock);

    const pack = await fetchKnowledgePack();
    expect(fetchMock).toHaveBeenCalledWith(defaultKnowledgePackUrl, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    expect(pack.products).toHaveLength(2);
  });

  it("rejects unsupported schemas", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schemaVersion: 2, products: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchKnowledgePack()).rejects.toThrow(
      "knowledge pack has an unsupported schema",
    );
  });

  it("surfaces HTTP failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchKnowledgePack()).rejects.toThrow(
      "knowledge pack request failed: HTTP 503",
    );
  });
});
