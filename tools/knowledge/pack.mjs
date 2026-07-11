#!/usr/bin/env node
// Build the app-consumable knowledge pack.
//
// Two-stage pipeline, mirroring the extension catalog: the monthly refresh
// extracts curated facts from the (gitignored) knowledge DB into the committed
// input knowledge/pack-facts.json (--extract / --from-db), and the committed
// outputs registry/knowledge-pack.json + the app-bundled copy are derived
// deterministically from that input. --check therefore works in CI without a
// DB, exactly like build-extension-catalog.mjs --check.
//
// The app never fetches upstream docs: it reads the bundled pack, and may
// refresh from the published registry copy of this same generated file.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { serializeExtensionCatalog as serializeJson } from "../docs/extension-catalog.mjs";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);

const PACK_FACTS_PATH = "knowledge/pack-facts.json";
const REGISTRY_PACK_PATH = "registry/knowledge-pack.json";
const BUNDLED_PACK_PATH = "apps/desktop/src/features/knowledge/bundled-knowledge-pack.json";
const ENGINES_PATH = "knowledge/engines.json";

// Size budget: the bundled pack ships inside the desktop app. Keep the highest
// priority, most recent facts per product instead of everything ever observed.
const MAX_FACTS_PER_PRODUCT = 40;
const MAX_SUMMARY_LENGTH = 500;
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
const EXCLUDED_AREAS = new Set(["cheatsheet-quarantine"]);

main(process.argv.slice(2));

function main(argv) {
  const args = parseArgs(argv);
  const dbPath = resolve(ROOT, args.db ?? "knowledge/irodori-knowledge.sqlite");

  if (args.help) {
    console.log(
      "usage: node tools/knowledge/pack.mjs [--from-db|--extract] [--check] [--db <path>]"
    );
    return;
  }

  if (args["from-db"] || args.extract) {
    const packFacts = extractPackFacts(dbPath);
    writeFileSync(resolve(ROOT, PACK_FACTS_PATH), serializeJson(packFacts));
    console.log(`pack: extracted ${packFacts.facts.length} facts -> ${PACK_FACTS_PATH}`);
    if (args.extract && !args["from-db"]) return;
  }

  const packFacts = readJson(PACK_FACTS_PATH);
  const engines = readJson(ENGINES_PATH).engines ?? [];
  const outputs = [
    [REGISTRY_PACK_PATH, buildPack(packFacts, engines, "knowledge-pack")],
    [BUNDLED_PACK_PATH, buildPack(packFacts, engines, "bundled-knowledge-pack")]
  ];

  if (args.check) {
    const stale = [];
    for (const [path, pack] of outputs) {
      const target = resolve(ROOT, path);
      const current = existsSync(target) ? readFileSync(target, "utf8") : "";
      if (current !== serializeJson(pack)) stale.push(path);
    }
    if (stale.length > 0) {
      console.error(
        `pack: stale generated files: ${stale.join(", ")}; run node tools/knowledge/pack.mjs`
      );
      process.exit(1);
    }
    console.log(`pack: ok (${outputs.length} generated files up to date)`);
    return;
  }

  for (const [path, pack] of outputs) {
    writeFileSync(resolve(ROOT, path), serializeJson(pack));
    console.log(`pack: wrote ${path} (${pack.products.length} products)`);
  }
}

// --- extract (DB -> committed input) -----------------------------------------

function extractPackFacts(dbPath) {
  if (!existsSync(dbPath)) {
    throw new Error(`knowledge DB not found at ${dbPath}; run tools/knowledge/refresh.mjs first`);
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db
    .prepare(`
      select id, product, area, version, title, summary, impact,
             priority, confidence, url, source_id, observed_at, metadata_json
      from facts
      order by observed_at asc, id asc
    `)
    .all();

  // Newest row wins per rendered content: analyze.mjs emits one fact per rule
  // match per snapshot, so the same statement recurs across snapshots (and
  // across rules with distinct factKeys). Anything the app would render
  // identically is one pack fact.
  const byKey = new Map();
  for (const row of rows) {
    if (EXCLUDED_AREAS.has(row.area)) continue;
    byKey.set(dedupeKey(row), row);
  }

  const byProduct = new Map();
  for (const row of byKey.values()) {
    const list = byProduct.get(row.product) ?? [];
    list.push(row);
    byProduct.set(row.product, list);
  }

  const selected = [];
  for (const list of byProduct.values()) {
    list.sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        String(b.observed_at).localeCompare(String(a.observed_at)) ||
        b.id - a.id
    );
    selected.push(...list.slice(0, MAX_FACTS_PER_PRODUCT));
  }

  const facts = selected.map(toPackFact);
  facts.sort(
    (a, b) =>
      compare(a.product, b.product) ||
      compare(a.area, b.area) ||
      compare(a.title, b.title) ||
      compare(a.url ?? "", b.url ?? "")
  );

  let updatedAt = "";
  for (const fact of facts) {
    if (fact.observedAt > updatedAt) updatedAt = fact.observedAt;
  }

  return {
    _meta: {
      description:
        "Curated knowledge facts extracted from the gitignored knowledge DB by tools/knowledge/pack.mjs --extract. Committed so the derived packs can be regenerated and checked without the DB. Do not hand-edit.",
      generator: "knowledge-pack-v1"
    },
    updatedAt,
    facts
  };
}

function toPackFact(row) {
  const fact = {
    product: row.product,
    area: row.area,
    title: singleLine(row.title),
    summary: singleLine(row.summary).slice(0, MAX_SUMMARY_LENGTH),
    priority: row.priority,
    confidence: row.confidence,
    observedAt: toIsoUtc(String(row.observed_at))
  };
  if (row.version) fact.version = row.version;
  if (row.impact) fact.impact = singleLine(row.impact);
  if (row.url) fact.url = row.url;
  if (row.source_id) fact.sourceId = row.source_id;
  return fact;
}

function dedupeKey(row) {
  return [row.product, row.area, singleLine(row.title), singleLine(row.summary), row.url ?? ""]
    .join("\u0000");
}

// --- build (committed input -> generated packs) ------------------------------

function buildPack(packFacts, engines, source) {
  const engineIdByProduct = new Map();
  for (const engine of engines) {
    const candidates = [engine.id, engine.label, ...(engine.sourceProducts ?? [])];
    for (const candidate of candidates) {
      if (candidate) engineIdByProduct.set(productKey(candidate), engine.id);
    }
  }

  const byProduct = new Map();
  for (const fact of packFacts.facts ?? []) {
    const { product, ...rest } = fact;
    const entry = byProduct.get(product) ?? { product, facts: [] };
    entry.facts.push(rest);
    byProduct.set(product, entry);
  }

  const products = [...byProduct.values()]
    .map((entry) => {
      const engineId = engineIdByProduct.get(productKey(entry.product));
      return engineId ? { product: entry.product, engineId, facts: entry.facts } : entry;
    })
    .sort((a, b) => compare(a.product, b.product));

  return {
    schemaVersion: 1,
    updatedAt: packFacts.updatedAt ?? "",
    source,
    products
  };
}

// --- helpers ------------------------------------------------------------------

function readJson(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
}

function productKey(label) {
  return String(label).toLowerCase().replace(/\s+/g, "");
}

function priorityRank(priority) {
  return PRIORITY_RANK[priority] ?? 1;
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function singleLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function toIsoUtc(value) {
  if (value.includes("T")) return value;
  return `${value.replace(" ", "T")}Z`;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
