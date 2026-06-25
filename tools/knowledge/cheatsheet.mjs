#!/usr/bin/env node
// Generates and validates the per-engine cheatsheets under docs/cheatsheets/.
//
// Two kinds of pages:
//   - Seed pages (hand-authored, contain "<!-- seed"): NOT overwritten. The tool
//     validates their structure and that their Sources footer ids exist in
//     knowledge/sources.json. docs/cheatsheets/neo4j.md is the flagship seed.
//   - Generated pages: rendered from area='cheatsheet' facts in the knowledge DB
//     when present, otherwise from a curated fixture in knowledge/cheatsheets/<id>.json.
//
// Engine -> official docs mapping comes from knowledge/engines.json (label) matched
// against knowledge/sources.json (product), so the Sources footer ties each page
// back to the registry that the refresh job keeps fresh.
//
//   node tools/knowledge/cheatsheet.mjs            # render generated pages, validate seeds (writes)
//   node tools/knowledge/cheatsheet.mjs --check     # validate + fail if a generated page is stale
//   node tools/knowledge/cheatsheet.mjs --list      # show what would be produced and from where
//
// Exit code is non-zero on validation failure or (in --check) on drift.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const PAGES_DIR = resolve(ROOT, "docs/cheatsheets");
const FIXTURES_DIR = resolve(ROOT, "knowledge/cheatsheets");
const ENGINES = resolve(ROOT, "knowledge/engines.json");
const SOURCES = resolve(ROOT, "knowledge/sources.json");
const DB = resolve(ROOT, "knowledge/irodori-knowledge.sqlite");

// The 8 sections every cheatsheet must have, in template order (docs/cheatsheets/README.md).
const SECTIONS = [
  { key: "atGlance", heading: "At a glance" },
  { key: "connect", heading: "Connect" },
  { key: "queryModel", heading: "Query model" },
  { key: "statements", heading: "Essential statements" },
  { key: "introspection", heading: "Introspection" },
  { key: "irodori", heading: "Irodori-specific behavior" },
  { key: "gotchas", heading: "Gotchas" },
  { key: "sources", heading: "Sources" },
];

main(parseArgs(process.argv.slice(2)));

function main(args) {
  const engines = JSON.parse(readFileSync(ENGINES, "utf8")).engines ?? [];
  const sources = JSON.parse(readFileSync(SOURCES, "utf8"));
  const facts = loadFacts();

  const targets = discoverTargets(engines, facts);
  if (args.list) {
    for (const t of targets) console.log(`${t.id.padEnd(12)} ${t.kind.padEnd(10)} sources=${t.sourceIds.join(",") || "-"}`);
    return;
  }

  const failures = [];
  let written = 0;
  let stale = 0;

  for (const target of targets) {
    if (target.kind === "seed") {
      failures.push(...validateSeed(target, sources));
      continue;
    }
    const rendered = renderPage(target, sources);
    const current = existsSync(target.path) ? readFileSync(target.path, "utf8") : null;
    if (current === rendered) continue;
    if (args.check) {
      stale += 1;
      failures.push(`${rel(target.path)} is stale — run \`node tools/knowledge/cheatsheet.mjs\` and commit`);
    } else {
      writeFileSync(target.path, rendered);
      written += 1;
      console.log(`wrote ${rel(target.path)} (from ${target.kind})`);
    }
  }

  if (failures.length) {
    console.error(`cheatsheet: ${failures.length} issue(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    args.check
      ? `cheatsheet: ok (${targets.length} pages, ${stale} stale)`
      : `cheatsheet: ok (${targets.length} pages, ${written} written)`,
  );
}

// --- target discovery --------------------------------------------------------

function discoverTargets(engines, facts) {
  const byId = new Map(engines.map((e) => [e.id, e]));
  const ids = new Set();

  // seed pages already on disk
  if (existsSync(PAGES_DIR)) {
    for (const file of readdirSync(PAGES_DIR)) {
      if (file.endsWith(".md") && file !== "README.md") ids.add(file.replace(/\.md$/, ""));
    }
  }
  // fixtures
  if (existsSync(FIXTURES_DIR)) {
    for (const file of readdirSync(FIXTURES_DIR)) {
      if (file.endsWith(".json")) ids.add(file.replace(/\.json$/, ""));
    }
  }
  // engines that have cheatsheet facts
  for (const product of Object.keys(facts)) {
    const engine = engines.find((e) => sameProduct(e.label, product));
    if (engine) ids.add(engine.id);
  }

  return [...ids].sort().map((id) => {
    const engine = byId.get(id);
    const path = resolve(PAGES_DIR, `${id}.md`);
    const sourceIds = sourceIdsFor(engine, facts);
    const isSeed = existsSync(path) && /<!--\s*seed/.test(readFileSync(path, "utf8"));
    const fixturePath = resolve(FIXTURES_DIR, `${id}.json`);
    const factSections = engine ? facts[productKey(engine.label)] : undefined;
    let kind = "missing";
    if (isSeed) kind = "seed";
    else if (factSections) kind = "facts";
    else if (existsSync(fixturePath)) kind = "fixture";
    return { id, engine, path, fixturePath, kind, sourceIds, factSections };
  });
}

function sourceIdsFor(engine, facts) {
  if (!engine) return [];
  const fromFacts = facts[productKey(engine.label)]?.sourceIds;
  if (fromFacts?.length) return fromFacts;
  const fixturePath = resolve(FIXTURES_DIR, `${engine.id}.json`);
  if (existsSync(fixturePath)) return JSON.parse(readFileSync(fixturePath, "utf8")).sourceIds ?? [];
  return [];
}

// --- seed validation ---------------------------------------------------------

function validateSeed(target, sources) {
  const text = readFileSync(target.path, "utf8");
  const issues = [];
  for (const section of SECTIONS) {
    if (!new RegExp(`^##\\s+${escapeRe(section.heading)}\\b`, "m").test(text)) {
      issues.push(`${rel(target.path)} (seed) is missing the "## ${section.heading}" section`);
    }
  }
  const known = new Set(sources.map((s) => s.id));
  for (const id of footerSourceIds(text)) {
    if (!known.has(id)) issues.push(`${rel(target.path)} (seed) cites unknown source id '${id}' (add it to knowledge/sources.json)`);
  }
  return issues;
}

// Source ids referenced in the Sources footer as `- \`source-id\` — ...`.
function footerSourceIds(text) {
  const idx = text.lastIndexOf("## Sources");
  const tail = idx === -1 ? text : text.slice(idx);
  return [...tail.matchAll(/^-\s+`([a-z0-9-]+)`/gim)].map((m) => m[1]);
}

// --- rendering ---------------------------------------------------------------

function renderPage(target, sources) {
  const data = target.kind === "facts"
    ? sectionsFromFacts(target.factSections)
    : JSON.parse(readFileSync(target.fixturePath, "utf8"));
  const engine = target.engine ?? {};
  const title = data.title ?? `${engine.label ?? cap(target.id)} Cheatsheet`;
  const provenance = target.kind === "facts" ? "facts" : "fixture";

  const lines = [];
  lines.push(`<!-- generated by tools/knowledge/cheatsheet.mjs from ${provenance}; edit knowledge/cheatsheets/${target.id}.json or the knowledge DB, not this file -->`);
  lines.push("");
  lines.push(`# ${title}`);
  lines.push("");
  lines.push("## At a glance");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  for (const [k, v] of data.atGlance ?? []) lines.push(`| ${k} | ${v} |`);
  lines.push("");
  pushSection(lines, "Connect", data.connect);
  pushSection(lines, "Query model", data.queryModel);
  pushSection(lines, "Essential statements", data.statements);
  pushSection(lines, "Introspection", data.introspection);
  pushSection(lines, "Irodori-specific behavior", data.irodori);
  pushSection(lines, "Gotchas", data.gotchas);

  lines.push("## Sources");
  lines.push("");
  lines.push("Generated from `knowledge/sources.json`:");
  lines.push("");
  const byId = new Map(sources.map((s) => [s.id, s]));
  const ids = data.sourceIds?.length ? data.sourceIds : target.sourceIds;
  if (ids.length) {
    for (const id of ids) {
      const src = byId.get(id);
      lines.push(src ? `- \`${id}\` — ${src.url}` : `- \`${id}\``);
    }
  } else {
    lines.push("- (no registered sources yet)");
  }
  lines.push("");
  return lines.join("\n");
}

function pushSection(lines, heading, body) {
  lines.push(`## ${heading}`);
  lines.push("");
  lines.push((body ?? "_TODO_").trim());
  lines.push("");
}

// Assemble fixture-shaped data from area='cheatsheet' facts (title = section key).
function sectionsFromFacts(factSections) {
  const data = { sourceIds: factSections.sourceIds ?? [] };
  if (factSections.title) data.title = factSections.title;
  for (const section of SECTIONS) {
    if (section.key === "sources") continue;
    const fact = factSections[section.key];
    if (!fact) continue;
    if (section.key === "atGlance") {
      try { data.atGlance = JSON.parse(fact); } catch { data.atGlance = [["note", fact]]; }
    } else {
      data[section.key] = fact;
    }
  }
  return data;
}

// --- knowledge DB (optional) -------------------------------------------------

// Returns { [productKey]: { connect, queryModel, ..., sourceIds, title } } from
// the latest area='cheatsheet' facts. Empty when the DB is absent.
function loadFacts() {
  if (!existsSync(DB)) return {};
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const hasFacts = db
      .prepare("select name from sqlite_master where type='table' and name='facts'")
      .get();
    if (!hasFacts) return {};
    const rows = db
      .prepare(
        `select f.product, f.title, f.summary, f.source_id, f.metadata_json
         from facts f
         where f.area = 'cheatsheet'
         order by f.observed_at asc, f.id asc`,
      )
      .all();
    const out = {};
    const keyByTitle = new Map(SECTIONS.map((s) => [s.heading.toLowerCase(), s.key]));
    for (const row of rows) {
      const key = productKey(row.product);
      const bucket = (out[key] ??= { sourceIds: [] });
      const sectionKey = keyByTitle.get(String(row.title).toLowerCase()) ?? normalizeSectionKey(row.title);
      if (sectionKey) bucket[sectionKey] = row.summary; // later rows win (newest)
      if (row.source_id && !bucket.sourceIds.includes(row.source_id)) bucket.sourceIds.push(row.source_id);
    }
    return out;
  } finally {
    db.close();
  }
}

// --- helpers -----------------------------------------------------------------

function normalizeSectionKey(title) {
  const t = String(title).toLowerCase().replace(/[^a-z]+/g, "");
  const map = { connect: "connect", querymodel: "queryModel", statements: "statements", essentialstatements: "statements", introspection: "introspection", irodori: "irodori", gotchas: "gotchas", ataglance: "atGlance" };
  return map[t] ?? null;
}

function productKey(label) {
  return String(label).toLowerCase().replace(/\s+/g, "");
}
function sameProduct(label, product) {
  return productKey(label) === productKey(product);
}
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function escapeRe(v) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function rel(p) {
  return p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p;
}
function parseArgs(argv) {
  const flags = new Set(["check", "list", "help"]);
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (!v.startsWith("--")) continue;
    const key = v.slice(2);
    if (flags.has(key)) parsed[key] = true;
    else {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) parsed[key] = true;
      else { parsed[key] = next; i += 1; }
    }
  }
  return parsed;
}
