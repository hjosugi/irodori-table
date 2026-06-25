#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_LIMIT = 20;
const BOOLEAN_OPTIONS = new Set(["facts", "notes", "help"]);

main(process.argv.slice(2));

function main(argv) {
  const options = parseArgs(argv);
  const root = resolve(new URL("../..", import.meta.url).pathname);
  const dbPath = resolve(root, options.db ?? "knowledge/irodori-knowledge.sqlite");
  const searchText = options._.join(" ").trim();
  const rowLimit = parseIntegerOption(options.limit, DEFAULT_LIMIT);

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  if (!existsSync(dbPath)) {
    console.error(`knowledge db not found: ${dbPath}`);
    console.error("Run: node tools/knowledge/refresh.mjs --no-fetch");
    process.exit(1);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  printQueryResult(db, { ...options, searchText, rowLimit });
}

function printQueryResult(database, options) {
  if (options.facts) {
    printFacts(database, options.searchText, options.rowLimit);
    return;
  }

  if (options.notes) {
    printImplementationNotes(database, options.searchText, options.rowLimit);
    return;
  }

  if (!options.searchText) {
    printSources(database);
    return;
  }

  printSnapshotSearchResults(database, options.searchText, options.rowLimit);
}

function printSources(database) {
  printRows(listSources(database), formatSourceRow);
}

function listSources(database) {
  return database
    .prepare(`
      select id, product, category, source_type, last_checked_at, last_changed_at, url
      from sources
      order by product, id
    `)
    .all();
}

function formatSourceRow(row) {
  return `${row.product}\t${row.id}\t${row.source_type}\t${row.last_checked_at ?? "-"}\t${row.url}`;
}

function printSnapshotSearchResults(database, text, limitValue) {
  printRows(searchSnapshots(database, text, limitValue), formatSnapshotSearchRow);
}

function searchSnapshots(database, text, limitValue) {
  return database
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
    .all(text, limitValue);
}

function formatSnapshotSearchRow(row) {
  return [
    `\n${row.product} - ${row.name}`,
    `${row.title ?? "(untitled)"} | ${row.fetched_at}`,
    row.url,
    row.snippet
  ].join("\n");
}

function printFacts(database, text, limitValue) {
  printRows(findFacts(database, text, limitValue), formatFactRow);
}

function findFacts(database, text, limitValue) {
  if (!text) {
    return database
      .prepare(`
        select id, product, area, priority, confidence, title, summary,
               impact, url, observed_at, summary as snippet
        from facts
        order by observed_at desc, id desc
        limit ?
      `)
      .all(limitValue);
  }

  const pattern = containsPattern(text);
  return database
    .prepare(`
      select f.id, f.product, f.area, f.priority, f.confidence, f.title,
             f.summary, f.impact, f.url, f.observed_at, f.summary as snippet
      from facts f
      where f.product like ?
         or f.area like ?
         or f.title like ?
         or f.summary like ?
         or f.impact like ?
      order by f.observed_at desc, f.id desc
      limit ?
    `)
    .all(pattern, pattern, pattern, pattern, pattern, limitValue);
}

function formatFactRow(row) {
  const lines = [
    `\n#${row.id} ${row.product} / ${row.area} / ${row.priority} / ${row.confidence}`,
    row.title,
    row.summary
  ];
  if (row.impact) lines.push(`impact: ${row.impact}`);
  lines.push(row.url);
  return lines.join("\n");
}

function printImplementationNotes(database, text, limitValue) {
  printRows(findImplementationNotes(database, text, limitValue), formatImplementationNoteRow);
}

function findImplementationNotes(database, text, limitValue) {
  if (!text) {
    return database
      .prepare(`
        select id, product, component, title, note, status, updated_at
        from implementation_notes
        order by updated_at desc, id desc
        limit ?
      `)
      .all(limitValue);
  }

  const pattern = containsPattern(text);
  return database
    .prepare(`
      select id, product, component, title, note, status, updated_at
      from implementation_notes
      where title like ? or note like ? or product like ? or component like ?
      order by updated_at desc, id desc
      limit ?
    `)
    .all(pattern, pattern, pattern, pattern, limitValue);
}

function formatImplementationNoteRow(row) {
  return [
    `\n#${row.id} ${row.product} / ${row.component} / ${row.status}`,
    row.title,
    row.note
  ].join("\n");
}

function printRows(rows, formatter) {
  for (const row of rows) {
    console.log(formatter(row));
  }
}

function containsPattern(text) {
  return `%${text}%`;
}

function parseIntegerOption(value, fallback) {
  const parsed = Number.parseInt(value ?? `${fallback}`, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(values) {
  return parseOptionArguments(values, {
    booleanOptions: BOOLEAN_OPTIONS,
    collectPositionals: true
  });
}

function parseOptionArguments(values, { booleanOptions, collectPositionals = false }) {
  const parsed = collectPositionals ? { _: [] } : {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      if (collectPositionals) parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
    if (booleanOptions.has(key)) {
      parsed[key] = true;
      continue;
    }
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

function printUsage() {
  console.log(`Usage: node tools/knowledge/query.mjs [options] [query]

Default:
  no query              List registered sources
  query                 Search stored source snapshots

Options:
  --db <path>           SQLite DB path
  --facts               List or search generated facts
  --notes               List or search implementation notes
  --limit <n>           Max rows (default: 20)
  --help                Show this help
`);
}
