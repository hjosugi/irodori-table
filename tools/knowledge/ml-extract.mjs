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
// Config (in precedence order):
//   1. flags:              --base-url / --model / --api-key
//   2. env:                IRODORI_LLM_BASE_URL / IRODORI_LLM_MODEL / IRODORI_LLM_API_KEY
//   3. the desktop app's shared AI provider (ai-provider.json + OS keychain),
//      for the ollama / openaiCompat kinds — so one provider setup drives chat,
//      SQL generation, AND knowledge extraction. Disable with --no-app-provider.
//
// Quality gates:
//   - model output is validated against the expected JSON shape before writing;
//   - facts below --min-confidence (default: medium) are written to the
//     'cheatsheet-quarantine' area for human review instead of publishing
//     (cheatsheet.mjs only reads area='cheatsheet').
//
// Incremental: a product whose latest snapshot hash already has generated facts
// is skipped ("unchanged"); --force re-extracts, --replace rewrites same-snapshot
// facts. Requests retry on 429/5xx with backoff and honor --timeout-ms.
//
// Usage:
//   node tools/knowledge/ml-extract.mjs --product Neo4j           # extract for one product
//   node tools/knowledge/ml-extract.mjs --product Neo4j --dry-run  # build prompt, don't call
//   node tools/knowledge/ml-extract.mjs --all --limit 3            # a few products
//   node tools/knowledge/ml-extract.mjs --product Neo4j --replace  # replace prior ML facts
//   node tools/knowledge/ml-extract.mjs --all --strict             # CI: non-zero exit on failures
//
// Provenance recorded per knowledge-base.md: source id, snapshot id + hash, model,
// endpoint host, prompt id, and confidence — so every generated fact is auditable.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const GENERATOR = "knowledge-ml-extract-v1";
const PROMPT_ID = "cheatsheet-extract-v1";
const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const DB = resolve(ROOT, "knowledge/irodori-knowledge.sqlite");
const SCHEMA = resolve(ROOT, "knowledge/schema.sql");
const MAX_CONTEXT_CHARS = 24_000;
const APP_IDENTIFIER = "dev.irodori.table";
const KEYCHAIN_SERVICE = "irodori-table";
const KEYCHAIN_ACCOUNT = "connections/ai-provider/token";
const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 };
const RETRY_DELAYS_MS = [2_000, 8_000];

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
  const minConfidence = normalizeConfidence(args["min-confidence"]) ?? "medium";
  const timeoutMs = Number.parseInt(args["timeout-ms"] ?? "", 10) || 120_000;

  if (!config.baseUrl && !dryRun) {
    console.log("ml-extract: no LLM endpoint configured — skipping (offline no-op).");
    console.log("  Set IRODORI_LLM_BASE_URL / IRODORI_LLM_MODEL (and IRODORI_LLM_API_KEY),");
    console.log("  configure an Ollama/OpenAI-compatible provider in the desktop app,");
    console.log("  or pass --dry-run to preview prompts without calling a model.");
    process.exit(0);
  }
  if (config.source && !dryRun) {
    console.log(`ml-extract: provider from ${config.source} (${config.model} @ ${safeHost(config.baseUrl)})`);
  }

  const db = new DatabaseSync(DB);
  db.exec(readFileSync(SCHEMA, "utf8"));

  const snapshots = selectSnapshots(db, args);
  if (!snapshots.length) {
    console.log("ml-extract: no matching snapshots. Run refresh.mjs for the product first.");
    process.exit(0);
  }

  const summary = { extracted: [], unchanged: [], quarantined: [], failed: [] };
  let writtenFacts = 0;
  for (const snapshot of snapshots) {
    // Incremental guard: the latest snapshot's content hash already has facts
    // from this generator -> nothing new to extract for the product.
    if (!dryRun && !args.force && !args.replace && hasFactsForHash(db, snapshot)) {
      summary.unchanged.push(snapshot.product);
      continue;
    }
    const prompt = buildPrompt(snapshot);
    if (dryRun) {
      console.log(`\n--- ${snapshot.product} / ${snapshot.source_id} (snapshot #${snapshot.id}) ---`);
      console.log(`endpoint: ${config.baseUrl ?? "(none)"} model: ${config.model ?? "(none)"}`);
      console.log(prompt.user.slice(0, 1200) + (prompt.user.length > 1200 ? "\n... [truncated]" : ""));
      continue;
    }
    const result = await callModel(config, prompt, timeoutMs);
    if (!result.ok) {
      summary.failed.push({ product: snapshot.product, reason: result.error });
      continue;
    }
    const validation = validateSections(result.sections);
    if (!validation.ok) {
      summary.failed.push({
        product: snapshot.product,
        reason: `model output failed validation: ${validation.errors.join("; ")}`,
      });
      continue;
    }
    const confidence = normalizeConfidence(result.sections.confidence) ?? "medium";
    const quarantine = CONFIDENCE_ORDER[confidence] < CONFIDENCE_ORDER[minConfidence];
    writtenFacts += writeFacts(db, snapshot, result.sections, config, Boolean(args.replace), quarantine);
    (quarantine ? summary.quarantined : summary.extracted).push(`${snapshot.product} (${confidence})`);
  }

  if (dryRun) {
    console.log(`\nml-extract: dry-run over ${snapshots.length} snapshot(s).`);
    return;
  }
  printSummary(summary, writtenFacts, minConfidence);
  if (args.strict && summary.failed.length) process.exit(1);
}

function printSummary(summary, writtenFacts, minConfidence) {
  console.log(`\nml-extract: ${writtenFacts} fact(s) written.`);
  if (summary.extracted.length) console.log(`  extracted:   ${summary.extracted.join(", ")}`);
  if (summary.unchanged.length) console.log(`  unchanged:   ${summary.unchanged.join(", ")} (snapshot hash already extracted; --force to redo)`);
  if (summary.quarantined.length) {
    console.log(`  quarantined: ${summary.quarantined.join(", ")} (below --min-confidence ${minConfidence}; area='cheatsheet-quarantine', review with tools/knowledge/query.mjs)`);
  }
  for (const failure of summary.failed) console.error(`  FAILED:      ${failure.product}: ${failure.reason}`);
}

// ---- provider resolution -------------------------------------------------------

function resolveConfig(args) {
  const explicit = {
    baseUrl: (args["base-url"] ?? process.env.IRODORI_LLM_BASE_URL ?? "").replace(/\/+$/, ""),
    apiKey: args["api-key"] ?? process.env.IRODORI_LLM_API_KEY ?? "",
    model: args.model ?? process.env.IRODORI_LLM_MODEL ?? "",
    source: "",
  };
  if (explicit.baseUrl || args["no-app-provider"]) return explicit;
  const app = readAppProvider();
  return app ?? explicit;
}

// Reuse the desktop app's shared AI provider (Settings -> AI). Non-secret fields
// live in ai-provider.json under the app data dir; the API key lives in the OS
// keychain under the same slot the app uses. Only HTTP-speaking kinds apply.
function readAppProvider() {
  const path = appProviderPath();
  if (!path) return null;
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (!["ollama", "openaiCompat"].includes(config.kind) || !config.model) return null;
  const endpoint = String(config.endpoint ?? "").replace(/\/+$/, "");
  if (!endpoint) return null;
  // ml-extract appends /chat/completions; both Ollama and hosted providers serve
  // the OpenAI-compatible surface under /v1.
  const baseUrl = /\/v\d+([a-z]*)?$/.test(endpoint) ? endpoint : `${endpoint}/v1`;
  return {
    baseUrl,
    model: config.model,
    apiKey: config.kind === "openaiCompat" ? keychainApiKey() : "",
    source: `app provider (${config.kind})`,
  };
}

function appProviderPath() {
  const candidates = [
    process.env.IRODORI_APP_DATA_DIR && resolve(process.env.IRODORI_APP_DATA_DIR, "ai-provider.json"),
    resolve(homedir(), ".local/share", APP_IDENTIFIER, "ai-provider.json"),
    resolve(homedir(), "Library/Application Support", APP_IDENTIFIER, "ai-provider.json"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function keychainApiKey() {
  try {
    return execFileSync("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    console.error("ml-extract: app provider needs an API key but the keychain lookup failed; continuing without one.");
    return "";
  }
}

// ---- snapshot selection --------------------------------------------------------

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

// Refreshes create new snapshot rows even when the fetched content is identical,
// so dedupe on the recorded content hash rather than the snapshot id.
function hasFactsForHash(db, snapshot) {
  return Boolean(
    db
      .prepare(
        `select id from facts
         where source_id = ?
           and metadata_json like ?
           and metadata_json like ?
         limit 1`,
      )
      .get(snapshot.source_id, `%"generator":"${GENERATOR}"%`, `%"snapshotHash":"${snapshot.content_hash}"%`),
  );
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

// ---- model call with retry/timeout ---------------------------------------------

async function callModel(config, prompt, timeoutMs) {
  const url = `${config.baseUrl}/chat/completions`;
  let lastError = "unknown error";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      console.error(`ml-extract: retrying in ${delay / 1000}s (${lastError})`);
      await new Promise((r) => setTimeout(r, delay));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
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
      lastError = controller.signal.aborted ? `timed out after ${timeoutMs}ms` : `request failed: ${error.message}`;
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 429 || response.status >= 500) {
      lastError = `endpoint returned ${response.status}`;
      continue;
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `endpoint returned ${response.status} ${body.slice(0, 200)}` };
    }
    const payload = await response.json().catch(() => null);
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: "empty model response" };
    try {
      return { ok: true, sections: JSON.parse(stripCodeFence(content)) };
    } catch {
      return { ok: false, error: "model did not return valid JSON" };
    }
  }
  return { ok: false, error: lastError };
}

// Strip a fence only when it wraps the WHOLE response. An unanchored match
// would grab the ```sql block the prompt asks for inside the JSON itself.
function stripCodeFence(text) {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1].trim() : trimmed;
}

// ---- output validation ----------------------------------------------------------

// Shape-check the model output before anything reaches the database: a schema
// drift or a chatty model must fail loudly, not publish garbage facts.
function validateSections(sections) {
  const errors = [];
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
    return { ok: false, errors: ["response is not a JSON object"] };
  }
  if (sections.atGlance != null) {
    if (!Array.isArray(sections.atGlance)) errors.push("atGlance is not an array");
    else if (
      !sections.atGlance.every(
        (pair) => Array.isArray(pair) && pair.length === 2 && pair.every((part) => typeof part === "string"),
      )
    ) {
      errors.push("atGlance entries must be [label, value] string pairs");
    }
  }
  for (const key of ["connect", "queryModel", "statements", "introspection", "gotchas"]) {
    if (sections[key] != null && typeof sections[key] !== "string") errors.push(`${key} is not a string`);
  }
  if (normalizeConfidence(sections.confidence) == null) {
    errors.push(`confidence must be high|medium|low (got ${JSON.stringify(sections.confidence)})`);
  }
  const hasContent =
    (Array.isArray(sections.atGlance) && sections.atGlance.length > 0) ||
    ["connect", "queryModel", "statements", "introspection", "gotchas"].some(
      (key) => typeof sections[key] === "string" && sections[key].trim(),
    );
  if (!hasContent) errors.push("all sections are empty");
  return { ok: errors.length === 0, errors };
}

function normalizeConfidence(value) {
  return ["high", "medium", "low"].includes(value) ? value : null;
}

// ---- persistence ----------------------------------------------------------------

function writeFacts(db, snapshot, sections, config, replace, quarantine) {
  const confidence = normalizeConfidence(sections.confidence) ?? "medium";
  const area = quarantine ? "cheatsheet-quarantine" : "cheatsheet";
  const endpointHost = safeHost(config.baseUrl);
  const findFact = db.prepare("select id from facts where source_id = ? and metadata_json like ? limit 1");
  const deleteNotes = db.prepare("delete from implementation_notes where fact_id = ?");
  const deleteFact = db.prepare("delete from facts where id = ?");
  const insertFact = db.prepare(
    `insert into facts (source_id, snapshot_id, product, db_family, version, area, title, summary, impact, priority, confidence, url, metadata_json)
     values (?, ?, ?, ?, '', ?, ?, ?, '', 'normal', ?, ?, ?)`,
  );

  let written = 0;
  db.exec("begin");
  try {
    for (const heading of SECTION_HEADINGS) {
      const body = sectionBody(sections, heading);
      if (!body) continue;
      const factKey = hash(`${snapshot.product}\n${heading}\n${config.model}`).slice(0, 20);
      // Match per source (not per snapshot id): refreshed snapshots of identical
      // content must update the same logical fact instead of accumulating copies.
      const existing = findFact.get(snapshot.source_id, `%"factKey":"${factKey}"%`);
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
      insertFact.run(
        snapshot.source_id,
        snapshot.id,
        snapshot.product,
        snapshot.product,
        area,
        heading,
        body,
        confidence,
        snapshot.url,
        metadata,
      );
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
  if (heading === "At a glance") return Array.isArray(value) && value.length ? JSON.stringify(value) : "";
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
  const flags = new Set(["all", "dry-run", "offline", "replace", "force", "strict", "no-app-provider", "help"]);
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
  --product <name>        Extract for one product (e.g. Neo4j)
  --source <id>           Extract for one source id
  --all                   Consider all sources (default: database category only)
  --limit <n>             Max snapshots to process
  --replace               Replace previously generated ML facts for the source
  --force                 Re-extract even when the snapshot hash is unchanged
  --min-confidence <c>    Quarantine facts below this confidence (default: medium)
  --timeout-ms <n>        Per-request timeout (default: 120000)
  --strict                Exit non-zero when any product fails (for CI)
  --dry-run               Build and print prompts without calling a model (offline-safe)
  --base-url <url>        Override IRODORI_LLM_BASE_URL
  --model <name>          Override IRODORI_LLM_MODEL
  --api-key <key>         Override IRODORI_LLM_API_KEY
  --no-app-provider       Ignore the desktop app's shared AI provider config
  --help                  Show this help

Provider resolution: flags > IRODORI_LLM_* env > the desktop app's AI provider
(ollama / OpenAI-compatible kinds; API key read from the OS keychain).
With no endpoint configured and no --dry-run, this is a no-op (exit 0).`);
}
