#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = parseArgs(process.argv.slice(2));
const root = resolve(new URL("../..", import.meta.url).pathname);
const dbPath = resolve(root, args.db ?? "knowledge/irodori-knowledge.sqlite");
const query = args._.join(" ").trim();

if (!existsSync(dbPath)) {
  console.error(`knowledge db not found: ${dbPath}`);
  console.error("Run: node tools/knowledge/refresh.mjs --no-fetch");
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

if (!query) {
  const rows = db
    .prepare(`
      select id, product, category, source_type, last_checked_at, last_changed_at, url
      from sources
      order by product, id
    `)
    .all();
  for (const row of rows) {
    console.log(`${row.product}\t${row.id}\t${row.source_type}\t${row.last_checked_at ?? "-"}\t${row.url}`);
  }
  process.exit(0);
}

const limit = Number.parseInt(args.limit ?? "20", 10);
const rows = db
  .prepare(`
    select s.product, s.name, ss.title, ss.fetched_at, ss.url,
           snippet(source_snapshots_fts, 1, '[', ']', ' ... ', 18) as snippet
    from source_snapshots_fts
    join source_snapshots ss on ss.id = source_snapshots_fts.rowid
    join sources s on s.id = ss.source_id
    where source_snapshots_fts match ?
    order by rank
    limit ?
  `)
  .all(query, Number.isFinite(limit) ? limit : 20);

for (const row of rows) {
  console.log(`\n${row.product} - ${row.name}`);
  console.log(`${row.title ?? "(untitled)"} | ${row.fetched_at}`);
  console.log(row.url);
  console.log(row.snippet);
}

function parseArgs(values) {
  const parsed = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }
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
