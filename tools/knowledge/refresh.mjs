#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const maxRedirects = 10;
const fetchAttempts = 3;
const retryDelaysMs = [1_000, 3_000];

// Lowercased fragments that identify anti-bot interstitials (Cloudflare and
// similar). Storing those pages would poison snapshots and derived facts, so
// the source is reported as failed instead (visible in the refresh digest).
const challengeMarkers = [
  "just a moment",
  "attention required",
  "checking your browser",
  "verify you are human",
  "verifying you are human",
  "enable javascript and cookies to continue",
  "cf-browser-verification",
  "cf-chl"
];

await main(process.argv.slice(2));

async function main(argv) {
  const args = parseArgs(argv);
  const paths = resolveKnowledgePaths(args);
  const startedAt = new Date().toISOString();

  mkdirSync(dirname(paths.dbPath), { recursive: true });

  const db = new DatabaseSync(paths.dbPath);
  db.exec(readFileSync(paths.schemaPath, "utf8"));

  const sources = JSON.parse(readFileSync(paths.sourcesPath, "utf8"));
  upsertSources(db, sources);

  if (args["no-fetch"]) {
    printSummary(db, paths.dbPath);
    process.exit(0);
  }

  const results = await refreshSources(db, selectSourcesForRefresh(sources, args), {
    concurrency: parseIntegerOption(args.concurrency, 6),
    force: Boolean(args.force),
    timeoutMs: parseIntegerOption(args["timeout-ms"], 20_000)
  });

  if (args["report-json"]) {
    writeFileSync(
      resolve(args["report-json"]),
      JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), results }, null, 2)
    );
  }

  printSummary(db, paths.dbPath);
}

function resolveKnowledgePaths(args) {
  const root = resolve(new URL("../..", import.meta.url).pathname);
  return {
    dbPath: resolve(root, args.db ?? "knowledge/irodori-knowledge.sqlite"),
    schemaPath: resolve(root, "knowledge/schema.sql"),
    sourcesPath: resolve(root, args.sources ?? "knowledge/sources.json")
  };
}

function selectSourcesForRefresh(sources, args) {
  const selectedSources = sources.filter((source) => {
    if (source.enabled === false) return false;
    if (args.source && source.id !== args.source) return false;
    return true;
  });
  const limit = parseIntegerOption(args.limit, selectedSources.length);
  return selectedSources.slice(0, limit);
}

async function refreshSources(database, sources, options) {
  const concurrency = Math.max(1, Math.min(options.concurrency, sources.length || 1));
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < sources.length) {
      const source = sources[cursor];
      cursor += 1;
      const result = await refreshSource(database, source, options);
      console.log(result.line);
      results.push(result);
    }
  });
  await Promise.all(workers);
  return results;
}

async function refreshSource(database, source, options) {
  const checkedAt = new Date().toISOString();
  const prefix = `fetch ${source.id} ... `;
  const base = { id: source.id, name: source.name, product: source.product };
  const markChecked = () =>
    database
      .prepare("update sources set last_checked_at = ?, updated_at = current_timestamp where id = ?")
      .run(checkedAt, source.id);

  try {
    const headers = {
      "accept": "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8",
      "accept-language": "en",
      "user-agent": "IrodoriTableKnowledgeBot/0.1 (+https://irodori.dev)",
      ...(source.fetchHeaders ?? {})
    };
    const { response, body, finalUrl, redirected } = await fetchDocumentWithRetry(
      source.url,
      headers,
      options.timeoutMs
    );
    if (response.status >= 400) {
      markChecked();
      return { ...base, outcome: "failed", httpStatus: response.status, error: `HTTP ${response.status}`, line: `${prefix}failed: HTTP ${response.status}` };
    }
    const text = normalizeText(stripHtml(body));
    const title = extractTitle(body) ?? source.name;
    if (isChallengePage(title, text)) {
      markChecked();
      return { ...base, outcome: "failed", httpStatus: response.status, error: "bot challenge detected", line: `${prefix}failed: bot challenge detected` };
    }
    const contentHash = hash(`${finalUrl}\n${text}`);
    const existing = database
      .prepare("select id from source_snapshots where source_id = ? and content_hash = ?")
      .get(source.id, contentHash);

    if (!existing || options.force) {
      database
        .prepare(`
          insert into source_snapshots (
            source_id, fetched_at, http_status, content_hash, title, url, raw_text, metadata_json
          ) values (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          source.id,
          checkedAt,
          response.status,
          contentHash,
          title,
          finalUrl,
          text.slice(0, 1_000_000),
          JSON.stringify({
            redirected,
            contentType: response.headers.get("content-type"),
            sourceUrl: source.url
          })
        );
      database
        .prepare(`
          update sources
          set last_checked_at = ?, last_changed_at = ?, last_hash = ?, updated_at = current_timestamp
          where id = ?
        `)
        .run(checkedAt, checkedAt, contentHash, source.id);
      return { ...base, outcome: "stored", httpStatus: response.status, title, line: `${prefix}stored ${response.status}` };
    } else {
      markChecked();
      return { ...base, outcome: "unchanged", httpStatus: response.status, line: `${prefix}unchanged ${response.status}` };
    }
  } catch (error) {
    markChecked();
    return { ...base, outcome: "failed", error: error.message, line: `${prefix}failed: ${error.message}` };
  }
}

// --- fetch helpers ------------------------------------------------------------

function isChallengePage(title, text) {
  const probe = `${title}\n${text.slice(0, 2_000)}`.toLowerCase();
  return challengeMarkers.some((marker) => probe.includes(marker));
}

async function fetchDocumentWithRetry(url, headers, timeoutMs) {
  let lastError;
  for (let attempt = 0; attempt < fetchAttempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(retryDelaysMs[attempt - 1] ?? retryDelaysMs.at(-1));
    }
    try {
      const result = await fetchDocument(url, headers, timeoutMs);
      const status = result.response.status;
      if ((status === 429 || status >= 500) && attempt < fetchAttempts - 1) {
        lastError = new Error(`HTTP ${status}`);
        continue;
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

// Manual redirect loop with a per-request cookie jar. Some upstreams (e.g.
// milvus.io) answer with a same-URL redirect plus a challenge cookie; the
// built-in redirect follower drops cookies and loops until "fetch failed".
async function fetchDocument(url, headers, timeoutMs) {
  const cookies = new Map();
  let currentUrl = url;
  let redirected = false;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: cookies.size
          ? { ...headers, cookie: [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ") }
          : headers
      });
      if (response.status >= 300 && response.status < 400) {
        rememberCookies(response, cookies);
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) {
          throw new Error(`redirect ${response.status} without location`);
        }
        currentUrl = new URL(location, currentUrl).toString();
        redirected = true;
        continue;
      }
      const body = await response.text();
      return { response, body, finalUrl: currentUrl, redirected };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`too many redirects (${maxRedirects})`);
}

function rememberCookies(response, cookies) {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq > 0) {
      cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function upsertSources(database, items) {
  const statement = database.prepare(`
    insert into sources (
      id, name, product, category, source_type, url, official, cadence, enabled, notes, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)
    on conflict(id) do update set
      name = excluded.name,
      product = excluded.product,
      category = excluded.category,
      source_type = excluded.source_type,
      url = excluded.url,
      official = excluded.official,
      cadence = excluded.cadence,
      enabled = excluded.enabled,
      notes = excluded.notes,
      updated_at = current_timestamp
  `);

  database.exec("begin");
  try {
    for (const item of items) {
      statement.run(
        item.id,
        item.name,
        item.product,
        item.category,
        item.sourceType,
        item.url,
        item.official === false ? 0 : 1,
        item.cadence ?? "monthly",
        item.enabled === false ? 0 : 1,
        item.notes ?? ""
      );
    }
    database.exec("commit");
  } catch (error) {
    database.exec("rollback");
    throw error;
  }
}

function printSummary(database, path) {
  const sourcesCount = database.prepare("select count(*) as count from sources").get().count;
  const snapshotCount = database.prepare("select count(*) as count from source_snapshots").get().count;
  console.log(`knowledge db: ${path}`);
  console.log(`sources: ${sourcesCount}`);
  console.log(`snapshots: ${snapshotCount}`);
}

function stripHtml(input) {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeText(input) {
  return input
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function extractTitle(input) {
  const h1 = input.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return normalizeText(stripHtml(h1[1])).slice(0, 240);
  const title = input.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return normalizeText(stripHtml(title[1])).slice(0, 240);
  return null;
}

function hash(input) {
  return createHash("sha256").update(input).digest("hex");
}

function parseIntegerOption(value, fallback) {
  const parsed = Number.parseInt(value ?? `${fallback}`, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
