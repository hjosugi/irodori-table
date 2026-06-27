#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

await main(process.argv.slice(2));

async function main(argv) {
  const args = parseArgs(argv);
  const paths = resolveKnowledgePaths(args);

  mkdirSync(dirname(paths.dbPath), { recursive: true });

  const db = new DatabaseSync(paths.dbPath);
  db.exec(readFileSync(paths.schemaPath, "utf8"));

  const sources = JSON.parse(readFileSync(paths.sourcesPath, "utf8"));
  upsertSources(db, sources);

  if (args["no-fetch"]) {
    printSummary(db, paths.dbPath);
    process.exit(0);
  }

  await refreshSources(db, selectSourcesForRefresh(sources, args), {
    concurrency: parseIntegerOption(args.concurrency, 6),
    force: Boolean(args.force),
    timeoutMs: parseIntegerOption(args["timeout-ms"], 20_000)
  });

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
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < sources.length) {
      const source = sources[cursor];
      cursor += 1;
      const line = await refreshSource(database, source, options);
      console.log(line);
    }
  });
  await Promise.all(workers);
}

async function refreshSource(database, source, options) {
  const checkedAt = new Date().toISOString();
  const prefix = `fetch ${source.id} ... `;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    let response;
    let body;
    try {
      response = await fetch(source.url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "accept": "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8",
          "user-agent": "IrodoriTableKnowledgeBot/0.1 (+https://irodori.dev)"
        }
      });
      body = await response.text();
    } finally {
      clearTimeout(timeout);
    }
    const text = normalizeText(stripHtml(body));
    const title = extractTitle(body) ?? source.name;
    const contentHash = hash(`${response.url}\n${text}`);
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
          response.url,
          text.slice(0, 1_000_000),
          JSON.stringify({
            redirected: response.redirected,
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
      return `${prefix}stored ${response.status}`;
    } else {
      database
        .prepare("update sources set last_checked_at = ?, updated_at = current_timestamp where id = ?")
        .run(checkedAt, source.id);
      return `${prefix}unchanged ${response.status}`;
    }
  } catch (error) {
    database
      .prepare("update sources set last_checked_at = ?, updated_at = current_timestamp where id = ?")
      .run(checkedAt, source.id);
    return `${prefix}failed: ${error.message}`;
  }
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
        item.cadence ?? "weekly",
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
