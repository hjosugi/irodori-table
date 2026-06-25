#!/usr/bin/env node
// Optional ML extraction layer: turn stored official-doc snapshots into structured
// cheatsheet facts (area='cheatsheet') using any OpenAI-compatible chat endpoint
// (local Ollama / LM Studio / vLLM, or a hosted gateway). This is the "quality"
// upgrade over the deterministic rule-based analyze.mjs.
//
// It is OPTIONAL infrastructure. With no endpoint configured it is a safe no-op, so
// offline/CI runs never depend on a model (matches the "AI optional, never
// required" non-negotiable). The deterministic rule-based path stays the default.
//
// Config (env or flags):
//   IRODORI_LLM_BASE_URL   e.g. http://localhost:11434/v1  |  https://api.openai.com/v1
//   IRODORI_LLM_API_KEY    bearer token (optional for local servers)
//   IRODORI_LLM_MODEL      e.g. llama3.1  |  gpt-4o-mini
//
// Usage:
//   node tools/knowledge/ml-extract.mjs --product Neo4j           # extract for one product
//   node tools/knowledge/ml-extract.mjs --product Neo4j --dry-run  # build prompt, don't call
//   node tools/knowledge/ml-extract.mjs --all --limit 3            # a few products
//   node tools/knowledge/ml-extract.mjs --product Neo4j --replace  # replace prior ML facts
//
// Provenance recorded per knowledge-base.md: source id, snapshot id + hash, model,
// endpoint host, prompt id, and confidence — so every generated fact is auditable.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const GENERATOR = "knowledge-ml-extract-v1";
const PROMPT_ID = "cheatsheet-extract-v1";
const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const DB = resolve(ROOT, "knowledge/irodori-knowledge.sqlite");
const SCHEMA = resolve(ROOT, "knowledge/schema.sql");
const MAX_CONTEXT_CHARS = 24_000;

// Sections the model extracts from upstream docs. "Irodori-specific behavior" is
// intentionally NOT extracted — that is Irodori-internal and stays curated/seed.
const SECTION_HEADINGS = ["At a glance", "Connect", "Query model", "Essential statements", "Introspection", "Gotchas"];

await main(parseArgs(process.argv.slice(2)));

async function main(args) {
  if (args.help) return printUsage();
  if (!existsSync(DB)) {
    console.error(`knowledge db not found: ${DB}`);
    console.error("Run: node tools/knowledge/refresh.mjs --limit 5");
    process.exit(1);
  }

  const config = resolveConfig(args);
  const dryRun = Boolean(args["dry-run"] || args.offline);

  if (!config.baseUrl && !dryRun) {
    console.log("ml-extract: no IRODORI_LLM_BASE_URL configured — skipping (offline no-op).");
    console.log("  Set IRODORI_LLM_BASE_URL / IRODORI_LLM_MODEL (and IRODORI_LLM_API_KEY) to enable,");
    console.log("  or pass --dry-run to preview prompts without calling a model.");
    process.exit(0);
  }

  const db = new DatabaseSync(DB);
  db.exec(readFileSync(SCHEMA, "utf8"));

  const snapshots = selectSnapshots(db, args);
  if (!snapshots.length) {
    console.log("ml-extract: no matching snapshots. Run refresh.mjs for the product first.");
    process.exit(0);
  }

  let extracted = 0;
  let writtenFacts = 0;
  for (const snapshot of snapshots) {
    const prompt = buildPrompt(snapshot);
    if (dryRun) {
      console.log(`\n--- ${snapshot.product} / ${snapshot.source_id} (snapshot #${snapshot.id}) ---`);
      console.log(`endpoint: ${config.baseUrl ?? "(none)"} model: ${config.model ?? "(none)"}`);
      console.log(prompt.user.slice(0, 1200) + (prompt.user.length > 1200 ? "\n... [truncated]" : ""));
      continue;
    }
    const sections = await callModel(config, prompt);
    if (!sections) continue;
    extracted += 1;
    writtenFacts += writeFacts(db, snapshot, sections, config, Boolean(args.replace));
  }

  if (dryRun) console.log(`\nml-extract: dry-run over ${snapshots.length} snapshot(s).`);
  else console.log(`ml-extract: ${extracted} snapshot(s) extracted, ${writtenFacts} cheatsheet fact(s) written.`);
}

function resolveConfig(args) {
  return {
    baseUrl: (args["base-url"] ?? process.env.IRODORI_LLM_BASE_URL ?? "").replace(/\/+$/, ""),
    apiKey: args["api-key"] ?? process.env.IRODORI_LLM_API_KEY ?? "",
    model: args.model ?? process.env.IRODORI_LLM_MODEL ?? "",
  };
}

// Pick the latest snapshot per relevant source. Prefer spec/product_docs for the
// target product(s); cap with --limit.
function selectSnapshots(db, args) {
  const filters = [];
  const params = [];
  if (args.product) {
    filters.push("lower(s.product) = lower(?)");
    params.push(args.product);
  }
  if (args.source) {
    filters.push("s.id = ?");
    params.push(args.source);
  }
  if (!args.all && !args.product && !args.source) {
    // default: only database specs/docs
    filters.push("s.category = 'database'");
  }
  const where = filters.length ? `where ${filters.join(" and ")}` : "";
  const limit = Number.parseInt(args.limit ?? "", 10);
  const limitClause = Number.isFinite(limit) && limit > 0 ? `limit ${limit}` : "";
  return db
    .prepare(
      `select ss.id, ss.source_id, ss.content_hash, ss.url, ss.raw_text, s.product, s.source_type
       from sources s
       join source_snapshots ss on ss.id = (
         select latest.id from source_snapshots latest
         where latest.source_id = s.id
         order by latest.fetched_at desc, latest.id desc limit 1
       )
       ${where}
       order by (s.source_type = 'spec') desc, (s.source_type = 'product_docs') desc, s.product
       ${limitClause}`,
    )
    .all(...params);
}

function buildPrompt(snapshot) {
  const context = snapshot.raw_text.slice(0, MAX_CONTEXT_CHARS);
  const system = [
    "You extract concise, accurate database cheatsheet content from official documentation.",
    "Return ONLY a JSON object. Use GitHub-flavored markdown inside string values.",
    "Be faithful to the provided text; do not invent flags, ports, or syntax.",
    "If the text does not cover a section, set that field to an empty string.",
  ].join(" ");
  const user = [
    `Product: ${snapshot.product}`,
    `Source URL: ${snapshot.url}`,
    "",
    "From the documentation excerpt below, produce a JSON object with these keys:",
    '- "atGlance": array of [label, value] pairs (wire/driver, default port, query language, one-line "what is different").',
    '- "connect": how to connect (markdown).',
    '- "queryModel": what you type and what comes back (markdown).',
    '- "statements": the 80%-case runnable statements in a fenced code block (markdown).',
    '- "introspection": how to list objects/schema (markdown).',
    '- "gotchas": the few things that actually bite people (markdown).',
    '- "confidence": one of "high" | "medium" | "low".',
    "",
    "Documentation excerpt:",
    "<<<",
    context,
    ">>>",
  ].join("\n");
  return { system, user };
}

async function callModel(config, prompt) {
  const url = `${config.baseUrl}/chat/completions`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch (error) {
    console.error(`ml-extract: request failed: ${error.message}`);
    return null;
  }
  if (!response.ok) {
    console.error(`ml-extract: endpoint returned ${response.status} ${await response.text().catch(() => "")}`);
    return null;
  }
  const payload = await response.json().catch(() => null);
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    console.error("ml-extract: empty model response");
    return null;
  }
  try {
    return JSON.parse(stripCodeFence(content));
  } catch {
    console.error("ml-extract: model did not return valid JSON; skipping");
    return null;
  }
}

function stripCodeFence(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fence ? fence[1] : text).trim();
}

function writeFacts(db, snapshot, sections, config, replace) {
  const confidence = ["high", "medium", "low"].includes(sections.confidence) ? sections.confidence : "medium";
  const endpointHost = safeHost(config.baseUrl);
  const findFact = db.prepare("select id from facts where snapshot_id = ? and metadata_json like ? limit 1");
  const deleteNotes = db.prepare("delete from implementation_notes where fact_id = ?");
  const deleteFact = db.prepare("delete from facts where id = ?");
  const insertFact = db.prepare(
    `insert into facts (source_id, snapshot_id, product, db_family, version, area, title, summary, impact, priority, confidence, url, metadata_json)
     values (?, ?, ?, ?, '', 'cheatsheet', ?, ?, '', 'normal', ?, ?, ?)`,
  );

  let written = 0;
  db.exec("begin");
  try {
    for (const heading of SECTION_HEADINGS) {
      const body = sectionBody(sections, heading);
      if (!body) continue;
      const factKey = hash(`${snapshot.product}\n${heading}\n${config.model}`).slice(0, 20);
      const existing = findFact.get(snapshot.id, `%"factKey":"${factKey}"%`);
      if (existing) {
        if (!replace) continue;
        deleteNotes.run(existing.id);
        deleteFact.run(existing.id);
      }
      const metadata = JSON.stringify({
        generator: GENERATOR,
        promptId: PROMPT_ID,
        factKey,
        model: config.model,
        endpointHost,
        snapshotHash: snapshot.content_hash,
        sourceType: snapshot.source_type,
        extractedFrom: heading,
      });
      insertFact.run(snapshot.source_id, snapshot.id, snapshot.product, snapshot.product, heading, body, confidence, snapshot.url, metadata);
      written += 1;
    }
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
  return written;
}

function sectionBody(sections, heading) {
  const key = { "At a glance": "atGlance", Connect: "connect", "Query model": "queryModel", "Essential statements": "statements", Introspection: "introspection", Gotchas: "gotchas" }[heading];
  const value = sections[key];
  if (value == null) return "";
  if (heading === "At a glance") return Array.isArray(value) ? JSON.stringify(value) : "";
  return typeof value === "string" ? value.trim() : "";
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function hash(input) {
  return createHash("sha256").update(input).digest("hex");
}

function parseArgs(argv) {
  const flags = new Set(["all", "dry-run", "offline", "replace", "help"]);
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (!v.startsWith("--")) continue;
    const key = v.slice(2);
    if (flags.has(key)) parsed[key] = true;
    else {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) parsed[key] = true;
      else {
        parsed[key] = next;
        i += 1;
      }
    }
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage: node tools/knowledge/ml-extract.mjs [options]

Extract cheatsheet sections from stored snapshots via an OpenAI-compatible endpoint.

Options:
  --product <name>   Extract for one product (e.g. Neo4j)
  --source <id>      Extract for one source id
  --all              Consider all sources (default: database category only)
  --limit <n>        Max snapshots to process
  --replace          Replace previously generated ML facts for the snapshot
  --dry-run          Build and print prompts without calling a model (offline-safe)
  --base-url <url>   Override IRODORI_LLM_BASE_URL
  --model <name>     Override IRODORI_LLM_MODEL
  --api-key <key>    Override IRODORI_LLM_API_KEY
  --help             Show this help

With no endpoint configured and no --dry-run, this is a no-op (exit 0).`);
}
