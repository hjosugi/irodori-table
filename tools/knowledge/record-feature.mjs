#!/usr/bin/env node
// Records an Irodori feature event into the knowledge base so product changes
// accumulate in one ledger (the implementation_notes table used by local
// knowledge tooling). This is the "ACCUMULATE" half of the auto-doc
// plan: feature lands -> note recorded -> doc generators can fold it in.
//
//   node tools/knowledge/record-feature.mjs \
//     --component metadata --product Neo4j --status landed \
//     --title "Neo4j graph result view" \
//     --note "Query-result graph visualization shipped for Bolt/Cypher results." \
//     --ticket ADV-004D
//
//   node tools/knowledge/record-feature.mjs --list           # recent feature notes
//   node tools/knowledge/record-feature.mjs --from-git        # read Doc-Update trailers from HEAD
//
// A commit can also drive this via trailers, one per doc-worthy change:
//   Doc-Update: <component> | <product> | <title> | <note>
//
// Re-recording the same component+title updates the existing note in place.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const DB = resolve(ROOT, "knowledge/irodori-knowledge.sqlite");
const SCHEMA = resolve(ROOT, "knowledge/schema.sql");
const KNOWN_COMPONENTS = ["driver", "metadata", "sql_dialect", "completion", "ui", "export", "planning"];

main(parseArgs(process.argv.slice(2)));

function main(args) {
  if (args.help) return printUsage();
  const db = openDb();
  try {
    if (args.list) return listNotes(db, Number.parseInt(args.list === true ? "20" : args.list, 10) || 20);

    const events = args["from-git"] ? readGitTrailers() : [eventFromArgs(args)];
    const valid = events.filter(Boolean);
    if (!valid.length) {
      console.error("record-feature: nothing to record. Pass --component/--title/--note or --from-git.");
      process.exit(1);
    }
    let inserted = 0;
    let updated = 0;
    for (const event of valid) {
      validateEvent(event);
      const result = upsertNote(db, event);
      if (result === "insert") inserted += 1;
      else updated += 1;
      console.log(`${result === "insert" ? "recorded" : "updated"}: [${event.component}] ${event.product || "-"} — ${event.title}`);
    }
    console.log(`record-feature: ${inserted} inserted, ${updated} updated.`);
  } finally {
    db.close();
  }
}

function openDb() {
  if (!existsSync(DB)) {
    // Initialize an empty knowledge DB so feature recording works before any refresh.
    const db = new DatabaseSync(DB);
    db.exec(readFileSync(SCHEMA, "utf8"));
    return db;
  }
  const db = new DatabaseSync(DB);
  db.exec(readFileSync(SCHEMA, "utf8"));
  return db;
}

function eventFromArgs(args) {
  if (!args.component && !args.title && !args.note) return null;
  const note = args.note ?? "";
  return {
    component: args.component,
    product: args.product ?? args.engine ?? "",
    title: args.title,
    note: args.ticket ? `${note} (${args.ticket})`.trim() : note,
    status: args.status ?? "landed",
  };
}

// Parse `Doc-Update: component | product | title | note` trailers from HEAD.
function readGitTrailers() {
  let body;
  try {
    body = execFileSync("git", ["log", "-1", "--pretty=%B"], { cwd: ROOT, encoding: "utf8" });
  } catch (error) {
    console.error(`record-feature: could not read git log: ${error.message}`);
    return [];
  }
  const events = [];
  for (const line of body.split("\n")) {
    const match = line.match(/^Doc-Update:\s*(.+)$/i);
    if (!match) continue;
    const [component, product, title, note] = match[1].split("|").map((part) => part.trim());
    events.push({ component, product: product ?? "", title: title ?? "", note: note ?? "", status: "landed" });
  }
  if (!events.length) console.log("record-feature: no Doc-Update trailers found on HEAD.");
  return events;
}

function validateEvent(event) {
  if (!event.component) throw new Error("--component is required");
  if (!event.title) throw new Error("--title is required");
  if (!event.note) throw new Error("--note is required");
  if (!KNOWN_COMPONENTS.includes(event.component)) {
    console.error(`record-feature: warning — component '${event.component}' is not one of ${KNOWN_COMPONENTS.join(", ")}`);
  }
}

function upsertNote(db, event) {
  const existing = db
    .prepare("select id from implementation_notes where component = ? and title = ? limit 1")
    .get(event.component, event.title);
  if (existing) {
    db.prepare(
      "update implementation_notes set product = ?, note = ?, status = ?, updated_at = current_timestamp where id = ?",
    ).run(event.product, event.note, event.status, existing.id);
    return "update";
  }
  db.prepare(
    "insert into implementation_notes (fact_id, product, component, title, note, status) values (null, ?, ?, ?, ?, ?)",
  ).run(event.product, event.component, event.title, event.note, event.status);
  return "insert";
}

function listNotes(db, limit) {
  const rows = db
    .prepare(
      `select product, component, title, status, updated_at
       from implementation_notes
       where fact_id is null
       order by updated_at desc, id desc
       limit ?`,
    )
    .all(limit);
  if (!rows.length) {
    console.log("record-feature: no feature notes recorded yet.");
    return;
  }
  for (const row of rows) {
    console.log(`${row.status.padEnd(8)} [${row.component.padEnd(11)}] ${(row.product || "-").padEnd(14)} ${row.title}`);
  }
}

function parseArgs(argv) {
  const flags = new Set(["from-git", "help"]);
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (!v.startsWith("--")) continue;
    const key = v.slice(2);
    if (flags.has(key)) {
      parsed[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage: node tools/knowledge/record-feature.mjs [options]

Record an Irodori feature event into the knowledge base (implementation_notes).

Options:
  --component <name>  One of: ${KNOWN_COMPONENTS.join(", ")}
  --title <text>      Short feature title (the upsert key with --component)
  --note <text>       What changed and why it is doc-worthy
  --product <name>    Engine/product the feature touches (optional)
  --status <name>     landed | open | in-progress (default: landed)
  --ticket <id>       Backlog ticket id, appended to the note
  --from-git          Read 'Doc-Update: component | product | title | note' trailers from HEAD
  --list [n]          List recent feature notes (default 20)
  --help              Show this help`);
}
