#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = parseArgs(process.argv.slice(2));
const root = resolve(new URL("../..", import.meta.url).pathname);
const dbPath = resolve(root, args.db ?? "knowledge/irodori-knowledge.sqlite");
const schemaPath = resolve(root, "knowledge/schema.sql");
const sourcesPath = resolve(root, args.sources ?? "knowledge/sources.json");

mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(readFileSync(schemaPath, "utf8"));

const sources = JSON.parse(readFileSync(sourcesPath, "utf8"));
upsertSources(db, sources);

if (args["no-fetch"]) {
  printSummary(db, dbPath);
  process.exit(0);
}

const selectedSources = sources.filter((source) => {
  if (source.enabled === false) return false;
  if (args.source && source.id !== args.source) return false;
  return true;
});

const limit = Number.parseInt(args.limit ?? `${selectedSources.length}`, 10);
const work = selectedSources.slice(0, Number.isFinite(limit) ? limit : selectedSources.length);

for (const source of work) {
  await refreshSource(db, source, Boolean(args.force));
}

printSummary(db, dbPath);

async function refreshSource(database, source, force) {
  const checkedAt = new Date().toISOString();
  process.stdout.write(`fetch ${source.id} ... `);

  try {
    const response = await fetch(source.url, {
      redirect: "follow",
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "IrodoriTableKnowledgeBot/0.1 (+https://irodori.dev)"
      }
    });

    const body = await response.text();
    const text = normalizeText(stripHtml(body));
    const title = extractTitle(body) ?? source.name;
    const contentHash = hash(`${response.url}\n${text}`);
    const existing = database
      .prepare("select id from source_snapshots where source_id = ? and content_hash = ?")
      .get(source.id, contentHash);

    if (!existing || force) {
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
      console.log(`stored ${response.status}`);
    } else {
      database
        .prepare("update sources set last_checked_at = ?, updated_at = current_timestamp where id = ?")
        .run(checkedAt, source.id);
      console.log(`unchanged ${response.status}`);
    }
  } catch (error) {
    database
      .prepare("update sources set last_checked_at = ?, updated_at = current_timestamp where id = ?")
      .run(checkedAt, source.id);
    console.log(`failed: ${error.message}`);
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
