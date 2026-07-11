import bundledKnowledgePackJson from "./bundled-knowledge-pack.json";

export const defaultKnowledgePackUrl =
  "https://raw.githubusercontent.com/hjosugi/irodori-table/main/registry/knowledge-pack.json";

export type KnowledgeFact = {
  area: string;
  title: string;
  summary: string;
  priority: string;
  confidence: string;
  observedAt: string;
  version?: string;
  impact?: string;
  url?: string;
  sourceId?: string;
};

export type KnowledgePackProduct = {
  product: string;
  engineId?: string;
  facts: KnowledgeFact[];
};

export type KnowledgePack = {
  schemaVersion: 1;
  updatedAt: string;
  source: string;
  products: KnowledgePackProduct[];
};

export type KnowledgeFactMatch = {
  product: string;
  engineId?: string;
  fact: KnowledgeFact;
};

export const bundledKnowledgePack: KnowledgePack = normalizeKnowledgePack(
  bundledKnowledgePackJson,
  "bundled-knowledge-pack",
);

export async function fetchKnowledgePack(
  url = defaultKnowledgePackUrl,
): Promise<KnowledgePack> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`knowledge pack request failed: HTTP ${response.status}`);
  }
  const parsed = (await response.json()) as unknown;
  return normalizeKnowledgePack(parsed, url);
}

export function knowledgeForEngine(
  pack: KnowledgePack,
  engineId: string,
): KnowledgePackProduct[] {
  return pack.products.filter((product) => product.engineId === engineId);
}

export function knowledgeForProduct(
  pack: KnowledgePack,
  product: string,
): KnowledgePackProduct | undefined {
  const key = productKey(product);
  return pack.products.find((entry) => productKey(entry.product) === key);
}

export function searchKnowledgeFacts(
  pack: KnowledgePack,
  query: string,
  limit = 20,
): KnowledgeFactMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  const matches: KnowledgeFactMatch[] = [];
  for (const product of pack.products) {
    for (const fact of product.facts) {
      if (matches.length >= limit) {
        return matches;
      }
      const haystack =
        `${product.product} ${fact.area} ${fact.title} ${fact.summary}`.toLowerCase();
      if (haystack.includes(needle)) {
        matches.push({
          product: product.product,
          engineId: product.engineId,
          fact,
        });
      }
    }
  }
  return matches;
}

function normalizeKnowledgePack(value: unknown, source: string): KnowledgePack {
  if (!value || typeof value !== "object") {
    throw new Error("knowledge pack must be an object");
  }
  const raw = value as Partial<KnowledgePack>;
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.products)) {
    throw new Error("knowledge pack has an unsupported schema");
  }
  return {
    schemaVersion: 1,
    updatedAt: stringOr(raw.updatedAt, ""),
    source: stringOr(raw.source, source),
    products: raw.products.map(normalizeKnowledgePackProduct),
  };
}

function normalizeKnowledgePackProduct(value: unknown): KnowledgePackProduct {
  if (!value || typeof value !== "object") {
    throw new Error("knowledge pack product entry must be an object");
  }
  const raw = value as Partial<KnowledgePackProduct>;
  return {
    product: requiredString(raw.product, "knowledge pack product"),
    engineId: optionalString(raw.engineId),
    facts: Array.isArray(raw.facts)
      ? raw.facts.map(normalizeKnowledgeFact)
      : [],
  };
}

function normalizeKnowledgeFact(value: unknown): KnowledgeFact {
  if (!value || typeof value !== "object") {
    throw new Error("knowledge fact entry must be an object");
  }
  const raw = value as Partial<KnowledgeFact>;
  return {
    area: requiredString(raw.area, "knowledge fact area"),
    title: requiredString(raw.title, "knowledge fact title"),
    summary: requiredString(raw.summary, "knowledge fact summary"),
    priority: stringOr(raw.priority, "normal"),
    confidence: stringOr(raw.confidence, "medium"),
    observedAt: stringOr(raw.observedAt, ""),
    version: optionalString(raw.version),
    impact: optionalString(raw.impact),
    url: optionalString(raw.url),
    sourceId: optionalString(raw.sourceId),
  };
}

function productKey(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "");
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
