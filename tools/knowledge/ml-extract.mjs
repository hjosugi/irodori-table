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
//      The Node bridge reads ai-provider.json directly and mirrors the app's OS
//      keychain lookup where practical; set IRODORI_LLM_API_KEY to supply the key
//      when the platform keychain is not readable from this script.
//
// Quality gates:
//   - model output is validated against the expected JSON shape before writing;
//   - facts below --min-confidence (default: medium) are written to the
//     'cheatsheet-quarantine' area for human review instead of publishing
//     (cheatsheet.mjs only reads area='cheatsheet').
//
// Incremental: a product whose latest snapshot hash + prompt/model provenance
// already has generated facts is skipped ("unchanged"); --force re-extracts,
// --replace rewrites same-snapshot facts. Requests retry on 429/5xx with backoff,
// honor Retry-After, and keep each product inside --timeout-ms.
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
const DEFAULT_TIMEOUT_MS = 120_000;
const RETRY_DELAYS_MS = [2_000, 8_000];
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429]);
const MAX_SECTION_CHARS = 12_000;
const MAX_AT_A_GLANCE_PAIRS = 12;
const SECTION_KEY_BY_HEADING = {
  "At a glance": "atGlance",
  Connect: "connect",
  "Query model": "queryModel",
  "Essential statements": "statements",
  Introspection: "introspection",
  Gotchas: "gotchas",
};
const RESPONSE_SCHEMA_KEYS = [...Object.values(SECTION_KEY_BY_HEADING), "confidence"];

// Sections the model extracts from upstream docs. "Irodori-specific behavior" is
// intentionally NOT extracted — that is Irodori-internal and stays curated/seed.
const SECTION_HEADINGS = ["At a glance", "Connect", "Query model", "Essential statements", "Introspection", "Gotchas"];

try {
  await main(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(`ml-extract: ${error.message}`);
  process.exit(1);
}

async function main(args) {
  if (args.help) return printUsage();
  if (!existsSync(DB)) {
    console.error(`knowledge db not found: ${DB}`);
    console.error("Run: node tools/knowledge/refresh.mjs --limit 5");
    process.exit(1);
  }

  const config = resolveConfig(args);
  const dryRun = Boolean(args["dry-run"] || args.offline);
  const minConfidence = parseConfidenceOption(args["min-confidence"], "medium");
  const timeoutMs = parsePositiveIntegerOption(args["timeout-ms"], DEFAULT_TIMEOUT_MS, "timeout-ms");

  if (!config.baseUrl && !dryRun) {
    console.log("ml-extract: no LLM endpoint configured — skipping (offline no-op).");
    console.log("  Set IRODORI_LLM_BASE_URL / IRODORI_LLM_MODEL (and IRODORI_LLM_API_KEY),");
    console.log("  configure an Ollama/OpenAI-compatible provider in the desktop app,");
    console.log("  or pass --dry-run to preview prompts without calling a model.");
    process.exit(0);
  }
  if (config.baseUrl && !config.model && !dryRun) {
    console.error("ml-extract: no model configured for the LLM endpoint.");
    console.error("  Set IRODORI_LLM_MODEL, configure the desktop app provider model, or pass --model.");
    process.exit(1);
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

  const summary = { extracted: [], unchanged: [], quarantined: [], failed: [], skippedFacts: 0 };
  let writtenFacts = 0;
  for (const snapshot of snapshots) {
    // Incremental guard: the latest snapshot's content hash already has facts
    // from this generator/prompt/model -> nothing new to extract for the product.
    if (!dryRun && !args.force && !args.replace && hasFactsForSnapshot(db, snapshot, config)) {
      summary.unchanged.push(formatSnapshotLabel(snapshot));
      continue;
    }
    const prompt = buildPrompt(snapshot);
    if (dryRun) {
      console.log(`\n--- ${snapshot.product} / ${snapshot.source_id} (snapshot #${snapshot.id}) ---`);
      console.log(`endpoint: ${config.baseUrl ?? "(none)"} model: ${config.model ?? "(none)"}`);
      console.log(prompt.user.slice(0, 1200) + (prompt.user.length > 1200 ? "\n... [truncated]" : ""));
      continue;
    }
    const result = await callModel(config, prompt, { timeoutMs });
    if (!result.ok) {
      summary.failed.push(failureForSnapshot(snapshot, result.stage ?? "request", result.error, result));
      continue;
    }
    const validation = validateSections(result.sections);
    if (!validation.ok) {
      summary.failed.push(
        failureForSnapshot(snapshot, "schema", `model output failed validation: ${validation.errors.join("; ")}`),
      );
      continue;
    }
    const confidence = normalizeConfidence(result.sections.confidence) ?? "medium";
    const quarantine = CONFIDENCE_ORDER[confidence] < CONFIDENCE_ORDER[minConfidence];
    try {
      const writeResult = writeFacts(db, snapshot, result.sections, config, {
        replace: Boolean(args.replace),
        quarantine,
        minConfidence,
      });
      writtenFacts += writeResult.written;
      summary.skippedFacts += writeResult.skipped;
      const label = `${formatSnapshotLabel(snapshot)} (${confidence}, ${writeResult.written} written${
        writeResult.skipped ? `, ${writeResult.skipped} existing` : ""
      })`;
      (quarantine ? summary.quarantined : summary.extracted).push(label);
    } catch (error) {
      summary.failed.push(failureForSnapshot(snapshot, "persist", error.message));
    }
  }

  if (dryRun) {
    console.log(`\nml-extract: dry-run over ${snapshots.length} snapshot(s).`);
    return;
  }
  printSummary(summary, writtenFacts, minConfidence, { all: Boolean(args.all) });
  if (args.strict && summary.failed.length) process.exit(1);
}

function printSummary(summary, writtenFacts, minConfidence, options) {
  console.log(`\nml-extract: ${writtenFacts} fact(s) written.`);
  if (summary.extracted.length) console.log(`  extracted:   ${summary.extracted.join(", ")}`);
  if (summary.unchanged.length) console.log(`  unchanged:   ${summary.unchanged.join(", ")} (snapshot hash already extracted; --force to redo)`);
  if (summary.skippedFacts) console.log(`  existing:    ${summary.skippedFacts} fact(s) left unchanged; use --replace to rewrite same-snapshot facts`);
  if (summary.quarantined.length) {
    console.log(`  quarantined: ${summary.quarantined.join(", ")} (below --min-confidence ${minConfidence}; area='cheatsheet-quarantine', review with tools/knowledge/query.mjs)`);
  }
  for (const failure of summary.failed) console.error(`  FAILED:      ${failure.product}: ${failure.reason}`);
  if (options.all && summary.failed.length) {
    console.error("  failureSummaryJson:");
    console.error(indent(JSON.stringify({ failures: summary.failed }, null, 2), "    "));
  }
}

// ---- provider resolution -------------------------------------------------------

function resolveConfig(args) {
  const baseUrl = (args["base-url"] ?? process.env.IRODORI_LLM_BASE_URL ?? "").replace(/\/+$/, "");
  const apiKey = args["api-key"] ?? process.env.IRODORI_LLM_API_KEY ?? "";
  const model = args.model ?? process.env.IRODORI_LLM_MODEL ?? "";
  const explicit = {
    baseUrl,
    apiKey,
    model,
    source: baseUrl ? "flags/env" : "",
  };
  if (baseUrl || args["no-app-provider"]) return explicit;
  const app = readAppProvider({ apiKeyFallback: apiKey, modelOverride: model });
  return app ?? explicit;
}

// Reuse the desktop app's shared AI provider (Settings -> AI). Non-secret fields
// live in ai-provider.json under the app data dir; the API key lives in the OS
// keychain under the same slot the app uses. Only HTTP-speaking kinds apply.
function readAppProvider({ apiKeyFallback = "", modelOverride = "" } = {}) {
  const path = appProviderPath();
  if (!path) return null;
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const model = modelOverride || config.model;
  if (!["ollama", "openaiCompat"].includes(config.kind) || !model) return null;
  const endpoint = String(config.endpoint ?? "").replace(/\/+$/, "");
  if (!endpoint) return null;
  // ml-extract appends /chat/completions; both Ollama and hosted providers serve
  // the OpenAI-compatible surface under /v1.
  const baseUrl = /\/v\d+([a-z]*)?$/.test(endpoint) ? endpoint : `${endpoint}/v1`;
  return {
    baseUrl,
    model,
    apiKey: config.kind === "openaiCompat" ? keychainApiKey({ fallback: apiKeyFallback }) : "",
    source: `app provider (${config.kind}${modelOverride ? " + model override" : ""})`,
  };
}

function appProviderPath() {
  const candidates = [
    process.env.IRODORI_APP_DATA_DIR && resolve(process.env.IRODORI_APP_DATA_DIR, "ai-provider.json"),
    process.env.XDG_DATA_HOME && resolve(process.env.XDG_DATA_HOME, APP_IDENTIFIER, "ai-provider.json"),
    resolve(homedir(), ".local/share", APP_IDENTIFIER, "ai-provider.json"),
    resolve(homedir(), "Library/Application Support", APP_IDENTIFIER, "ai-provider.json"),
    process.env.APPDATA && resolve(process.env.APPDATA, APP_IDENTIFIER, "ai-provider.json"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function keychainApiKey({ fallback = "" } = {}) {
  const platformCommand = keychainReadCommand();
  if (!platformCommand) {
    if (!fallback) {
      console.error("ml-extract: app provider API key lookup is not implemented for this platform; set IRODORI_LLM_API_KEY.");
    }
    return fallback;
  }
  try {
    return execFileSync(platformCommand.command, platformCommand.args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || fallback;
  } catch {
    if (!fallback) {
      console.error("ml-extract: app provider needs an API key but the keychain lookup failed; continuing without one.");
    }
    return fallback;
  }
}

function keychainReadCommand() {
  if (process.platform === "linux") {
    return {
      command: "secret-tool",
      args: ["lookup", "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT],
    };
  }
  if (process.platform === "darwin") {
    return {
      command: "security",
      args: ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
    };
  }
  // Windows Credential Manager can be used by the Rust app, but Node has no
  // dependency-free standard reader for generic credentials. Keep this bridge
  // explicit and let IRODORI_LLM_API_KEY provide the secret in automation.
  return null;
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
// so dedupe on the recorded content hash plus extraction provenance rather than
// the snapshot id alone.
function hasFactsForSnapshot(db, snapshot, config) {
  const patterns = [
    metadataLike("generator", GENERATOR),
    metadataLike("promptId", PROMPT_ID),
    metadataLike("snapshotHash", snapshot.content_hash),
    metadataLike("model", config.model),
  ];
  const where = patterns.map(() => "metadata_json like ?").join(" and ");
  return Boolean(
    db
      .prepare(
        `select id from facts
         where source_id = ?
           and ${where}
         limit 1`,
      )
      .get(snapshot.source_id, ...patterns),
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

async function callModel(config, prompt, { timeoutMs }) {
  const url = `${config.baseUrl}/chat/completions`;
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown error";
  const maxAttempts = RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { ok: false, stage: "request", error: `timed out after ${timeoutMs}ms`, attempts: attempt - 1 };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
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
      if (attempt >= maxAttempts || controller.signal.aborted) {
        return { ok: false, stage: "request", error: lastError, attempts: attempt };
      }
      const slept = await sleepForRetry(RETRY_DELAYS_MS[attempt - 1], deadline, lastError);
      if (!slept) return { ok: false, stage: "request", error: `${lastError}; retry would exceed ${timeoutMs}ms timeout`, attempts: attempt };
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (isRetryableStatus(response.status)) {
      lastError = `endpoint returned ${response.status}`;
      if (attempt >= maxAttempts) break;
      const delay = retryDelayMs(response, attempt);
      const slept = await sleepForRetry(delay, deadline, lastError);
      if (!slept) return { ok: false, stage: "request", error: `${lastError}; retry would exceed ${timeoutMs}ms timeout`, attempts: attempt, status: response.status };
      continue;
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, stage: "request", error: `endpoint returned ${response.status} ${body.slice(0, 200)}`, attempts: attempt, status: response.status };
    }
    const payload = await response.json().catch(() => null);
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) return { ok: false, stage: "model", error: "empty model response", attempts: attempt };
    try {
      return { ok: true, sections: JSON.parse(stripCodeFence(content)) };
    } catch {
      return { ok: false, stage: "model", error: "model did not return valid JSON", attempts: attempt };
    }
  }
  return { ok: false, stage: "request", error: lastError, attempts: maxAttempts };
}

function isRetryableStatus(status) {
  return RETRYABLE_STATUSES.has(status) || status >= 500;
}

function retryDelayMs(response, attempt) {
  return parseRetryAfterMs(response.headers.get("retry-after")) ?? RETRY_DELAYS_MS[attempt - 1] ?? 0;
}

function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

async function sleepForRetry(delayMs, deadline, reason) {
  const remaining = deadline - Date.now();
  if (remaining <= 0 || delayMs >= remaining) return false;
  console.error(`ml-extract: retrying in ${formatDuration(delayMs)} (${reason})`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  return true;
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

  const unknownKeys = Object.keys(sections).filter((key) => !RESPONSE_SCHEMA_KEYS.includes(key));
  if (unknownKeys.length) errors.push(`unexpected key(s): ${unknownKeys.join(", ")}`);
  for (const key of RESPONSE_SCHEMA_KEYS) {
    if (!(key in sections)) errors.push(`missing required key: ${key}`);
  }

  if (!Array.isArray(sections.atGlance)) {
    errors.push("atGlance is not an array");
  } else {
    if (sections.atGlance.length > MAX_AT_A_GLANCE_PAIRS) {
      errors.push(`atGlance has too many entries (${sections.atGlance.length}; max ${MAX_AT_A_GLANCE_PAIRS})`);
    }
    for (const [index, pair] of sections.atGlance.entries()) {
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((part) => typeof part === "string")) {
        errors.push(`atGlance[${index}] must be a [label, value] string pair`);
        continue;
      }
      if (!pair[0].trim() || !pair[1].trim()) errors.push(`atGlance[${index}] label and value must be non-empty`);
    }
  }
  for (const key of ["connect", "queryModel", "statements", "introspection", "gotchas"]) {
    if (typeof sections[key] !== "string") {
      errors.push(`${key} is not a string`);
    } else if (sections[key].length > MAX_SECTION_CHARS) {
      errors.push(`${key} is too long (${sections[key].length}; max ${MAX_SECTION_CHARS})`);
    } else if (sections[key].includes("\u0000")) {
      errors.push(`${key} contains a NUL byte`);
    }
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

function writeFacts(db, snapshot, sections, config, options) {
  const facts = buildFactRows(snapshot, sections, config, options);
  const validation = validateFactRows(facts);
  if (!validation.ok) throw new Error(`fact schema validation failed: ${validation.errors.join("; ")}`);

  const findFacts = db.prepare(
    `select id from facts
     where source_id = ?
       and (
         metadata_json like ?
         or (
           metadata_json like ?
           and metadata_json like ?
           and metadata_json like ?
           and metadata_json like ?
           and metadata_json like ?
         )
       )`,
  );
  const deleteNotes = db.prepare("delete from implementation_notes where fact_id = ?");
  const deleteFact = db.prepare("delete from facts where id = ?");
  const insertFact = db.prepare(
    `insert into facts (source_id, snapshot_id, product, db_family, version, area, title, summary, impact, priority, confidence, url, metadata_json)
     values (?, ?, ?, ?, '', ?, ?, ?, '', 'normal', ?, ?, ?)`,
  );

  let written = 0;
  let skipped = 0;
  db.exec("begin");
  try {
    for (const fact of facts) {
      const existingFacts = findFacts.all(
        fact.sourceId,
        metadataLike("factKey", fact.metadata.factKey),
        metadataLike("generator", GENERATOR),
        metadataLike("promptId", PROMPT_ID),
        metadataLike("snapshotHash", fact.metadata.snapshotHash),
        metadataLike("model", fact.metadata.model),
        metadataLike("extractedFrom", fact.metadata.extractedFrom),
      );
      if (existingFacts.length) {
        if (!options.replace) {
          skipped += 1;
          continue;
        }
        for (const existing of existingFacts) {
          deleteNotes.run(existing.id);
          deleteFact.run(existing.id);
        }
      }
      insertFact.run(
        fact.sourceId,
        fact.snapshotId,
        fact.product,
        fact.dbFamily,
        fact.area,
        fact.title,
        fact.summary,
        fact.confidence,
        fact.url,
        fact.metadataJson,
      );
      written += 1;
    }
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
  return { written, skipped };
}

function buildFactRows(snapshot, sections, config, options) {
  const confidence = normalizeConfidence(sections.confidence) ?? "medium";
  const area = options.quarantine ? "cheatsheet-quarantine" : "cheatsheet";
  const endpointHost = safeHost(config.baseUrl);
  return SECTION_HEADINGS.flatMap((heading) => {
    const body = sectionBody(sections, heading);
    if (!body) return [];
    const factKey = hash([GENERATOR, PROMPT_ID, snapshot.source_id, snapshot.content_hash, heading, config.model].join("\n")).slice(0, 24);
    const metadata = {
      generator: GENERATOR,
      promptId: PROMPT_ID,
      factKey,
      model: config.model,
      endpointHost,
      snapshotId: snapshot.id,
      snapshotHash: snapshot.content_hash,
      sourceId: snapshot.source_id,
      sourceType: snapshot.source_type,
      extractedFrom: heading,
      minConfidence: options.minConfidence,
      quarantined: Boolean(options.quarantine),
    };
    return [
      {
        sourceId: snapshot.source_id,
        snapshotId: snapshot.id,
        product: snapshot.product,
        dbFamily: snapshot.product,
        area,
        title: heading,
        summary: body,
        confidence,
        url: snapshot.url,
        metadata,
        metadataJson: JSON.stringify(metadata),
      },
    ];
  });
}

function validateFactRows(facts) {
  const errors = [];
  if (!Array.isArray(facts) || facts.length === 0) {
    return { ok: false, errors: ["no non-empty facts to write"] };
  }
  for (const [index, fact] of facts.entries()) {
    for (const key of ["sourceId", "product", "dbFamily", "area", "title", "summary", "confidence", "url", "metadataJson"]) {
      if (typeof fact[key] !== "string" || !fact[key].trim()) errors.push(`fact[${index}].${key} must be a non-empty string`);
    }
    if (!Number.isInteger(fact.snapshotId) || fact.snapshotId <= 0) errors.push(`fact[${index}].snapshotId must be a positive integer`);
    if (!["cheatsheet", "cheatsheet-quarantine"].includes(fact.area)) errors.push(`fact[${index}].area is invalid`);
    if (normalizeConfidence(fact.confidence) == null) errors.push(`fact[${index}].confidence is invalid`);
    let metadata;
    try {
      metadata = JSON.parse(fact.metadataJson);
    } catch {
      errors.push(`fact[${index}].metadataJson is not valid JSON`);
      continue;
    }
    for (const [key, expected] of [
      ["generator", GENERATOR],
      ["promptId", PROMPT_ID],
      ["snapshotId", fact.snapshotId],
      ["snapshotHash", fact.metadata?.snapshotHash],
      ["sourceId", fact.sourceId],
      ["model", fact.metadata?.model],
      ["factKey", fact.metadata?.factKey],
    ]) {
      if (metadata?.[key] !== expected) errors.push(`fact[${index}].metadata.${key} is invalid`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function sectionBody(sections, heading) {
  const key = SECTION_KEY_BY_HEADING[heading];
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

function metadataLike(key, value) {
  return `%${JSON.stringify(key)}:${JSON.stringify(value)}%`;
}

function formatSnapshotLabel(snapshot) {
  return `${snapshot.product}/${snapshot.source_id}#${snapshot.id}`;
}

function failureForSnapshot(snapshot, stage, reason, extra = {}) {
  const failure = {
    product: snapshot.product,
    sourceId: snapshot.source_id,
    snapshotId: snapshot.id,
    snapshotHash: snapshot.content_hash,
    stage,
    reason,
  };
  if (Number.isInteger(extra.attempts)) failure.attempts = extra.attempts;
  if (Number.isInteger(extra.status)) failure.status = extra.status;
  return failure;
}

function parseConfidenceOption(value, fallback) {
  if (value == null) return fallback;
  const normalized = normalizeConfidence(value);
  if (normalized) return normalized;
  throw new Error(`--min-confidence must be one of high, medium, low (got ${JSON.stringify(value)})`);
}

function parsePositiveIntegerOption(value, fallback, label) {
  if (value == null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  throw new Error(`--${label} must be a positive integer (got ${JSON.stringify(value)})`);
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

function indent(text, prefix) {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
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
  --replace               Replace previously generated ML facts for the same snapshot provenance
  --force                 Re-extract even when the snapshot hash/model provenance is unchanged
  --min-confidence <c>    Quarantine facts below this confidence (default: medium)
  --timeout-ms <n>        Per-product timeout across retries (default: ${DEFAULT_TIMEOUT_MS})
  --strict                Exit non-zero when any product fails (for CI)
  --dry-run               Build and print prompts without calling a model (offline-safe)
  --base-url <url>        Override IRODORI_LLM_BASE_URL
  --model <name>          Override IRODORI_LLM_MODEL
  --api-key <key>         Override IRODORI_LLM_API_KEY
  --no-app-provider       Ignore the desktop app's shared AI provider config
  --help                  Show this help

Provider resolution: flags > IRODORI_LLM_* env > the desktop app's AI provider
(ollama / OpenAI-compatible kinds; API key read from the OS keychain where
available, or IRODORI_LLM_API_KEY as a compatibility bridge).
With no endpoint configured and no --dry-run, this is a no-op (exit 0).`);
}
