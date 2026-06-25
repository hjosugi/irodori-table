#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const GENERATOR = "knowledge-analyze-v1";
const DEFAULT_MIN_SCORE = 3;
const DEFAULT_PER_SOURCE = 6;
const BOOLEAN_OPTIONS = new Set([
  "changed-only",
  "dry-run",
  "help",
  "json",
  "replace",
  "strict-changed"
]);

function main(argv) {
  const cliOptions = parseArgs(argv);
  const root = resolve(new URL("../..", import.meta.url).pathname);
  const dbPath = resolve(root, cliOptions.db ?? "knowledge/irodori-knowledge.sqlite");
  const schemaPath = resolve(root, "knowledge/schema.sql");

  if (cliOptions.help) {
    printUsage();
    process.exit(0);
  }

  if (!existsSync(dbPath)) {
    console.error(`knowledge db not found: ${dbPath}`);
    console.error("Run: node tools/knowledge/refresh.mjs --no-fetch");
    process.exit(1);
  }

  const db = new DatabaseSync(dbPath);
  db.exec(readFileSync(schemaPath, "utf8"));

  const analysisOptions = buildAnalysisOptions(cliOptions);
  const snapshots = loadSnapshotsForAnalysis(db, cliOptions);
  const candidates = snapshots.flatMap((snapshot) => extractCandidates(snapshot, analysisOptions));

  if (cliOptions["dry-run"]) {
    printDryRun(candidates, { json: Boolean(cliOptions.json) });
    process.exit(0);
  }

  if (cliOptions.replace) {
    replaceGeneratedFacts(db, snapshots.map((snapshot) => snapshot.snapshot_id));
  }

  const result = insertCandidates(db, candidates);

  if (cliOptions.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printAnalysisSummary({ dbPath, snapshots, candidates, result, analysisOptions });
  }
}

function buildAnalysisOptions(options) {
  return {
    minScore: parsePositiveInteger(options["min-score"], DEFAULT_MIN_SCORE),
    perSource: parsePositiveInteger(options["per-source"], DEFAULT_PER_SOURCE),
    changedOnly: Boolean(options["changed-only"]),
    strictChanged: Boolean(options["strict-changed"])
  };
}

function loadSnapshotsForAnalysis(database, options) {
  return listLatestSnapshots(database, options).map((snapshot) =>
    attachPreviousSnapshot(database, snapshot)
  );
}

function listLatestSnapshots(database, options) {
  const { whereClause, limitClause, params } = buildSnapshotQueryOptions(options);

  return database
    .prepare(`
      select
        s.id as source_id,
        s.name as source_name,
        s.product,
        s.category,
        s.source_type,
        s.notes as source_notes,
        ss.id as snapshot_id,
        ss.fetched_at,
        ss.title as snapshot_title,
        ss.url,
        ss.raw_text
      from sources s
      join source_snapshots ss on ss.id = (
        select latest.id
        from source_snapshots latest
        where latest.source_id = s.id
        order by latest.fetched_at desc, latest.id desc
        limit 1
      )
      ${whereClause}
      order by s.product, s.id
      ${limitClause}
    `)
    .all(...params);
}

function buildSnapshotQueryOptions(options) {
  const filters = [
    options.source && ["s.id = ?", options.source],
    options.product && ["lower(s.product) = lower(?)", options.product],
    options.category && ["s.category = ?", options.category]
  ].filter(Boolean);
  const limit = parsePositiveInteger(options.limit, null);

  return {
    whereClause: filters.length ? `where ${filters.map(([clause]) => clause).join(" and ")}` : "",
    limitClause: limit ? `limit ${limit}` : "",
    params: filters.map(([, value]) => value)
  };
}

function extractCandidates(snapshot, options) {
  const analysisInput = buildAnalysisInput(snapshot, options);
  const segments = splitSegments(analysisInput.text);
  return rankCandidates(
    collectCandidates(snapshot, segments, options, analysisInput),
    options.perSource
  );
}

function collectCandidates(snapshot, segments, options, analysisInput) {
  const seen = new Set();

  return segments.flatMap((segment) =>
    analyzeSegment(segment, snapshot)
      .filter((analysis) => analysis.score >= options.minScore)
      .flatMap((analysis) => uniqueCandidate(snapshot, segment, analysis, analysisInput, seen))
  );
}

function uniqueCandidate(snapshot, segment, analysis, analysisInput, seen) {
  const key = `${analysis.area}:${normalizeKey(segment.text).slice(0, 240)}`;
  if (seen.has(key)) return [];

  seen.add(key);
  return [buildCandidate(snapshot, segment, analysis, analysisInput)];
}

function rankCandidates(candidates, perSource) {
  return [...candidates].sort(compareCandidates).slice(0, perSource);
}

function compareCandidates(left, right) {
  return right.score - left.score || left.position - right.position;
}

function attachPreviousSnapshot(database, snapshot) {
  const previous = database
    .prepare(`
      select id, raw_text
      from source_snapshots
      where source_id = ?
        and (
          fetched_at < ?
          or (fetched_at = ? and id < ?)
        )
      order by fetched_at desc, id desc
      limit 1
    `)
    .get(snapshot.source_id, snapshot.fetched_at, snapshot.fetched_at, snapshot.snapshot_id);

  return {
    ...snapshot,
    previous_snapshot_id: previous?.id ?? null,
    previous_raw_text: previous?.raw_text ?? ""
  };
}

function buildAnalysisInput(snapshot, options) {
  if (!options.changedOnly) {
    return {
      text: snapshot.raw_text,
      mode: "full",
      previousSnapshotId: snapshot.previous_snapshot_id,
      lineCount: normalizeLines(snapshot.raw_text).length,
      addedLineCount: null
    };
  }

  if (!snapshot.previous_raw_text) {
    const latestUnits = diffUnits(snapshot.raw_text);
    return {
      text: options.strictChanged ? "" : latestUnits.join("\n"),
      mode: options.strictChanged ? "changed_no_previous" : "full_no_previous",
      previousSnapshotId: null,
      lineCount: latestUnits.length,
      addedLineCount: options.strictChanged ? 0 : latestUnits.length
    };
  }

  const latestUnits = diffUnits(snapshot.raw_text);
  const previousUnitSet = new Set(diffUnits(snapshot.previous_raw_text).map(normalizeDiffLine));
  const addedUnits = latestUnits.filter((line) => !previousUnitSet.has(normalizeDiffLine(line)));

  return {
    text: addedUnits.join("\n"),
    mode: "changed",
    previousSnapshotId: snapshot.previous_snapshot_id,
    lineCount: latestUnits.length,
    addedLineCount: addedUnits.length
  };
}

function splitSegments(rawText) {
  return normalizeLines(rawText)
    .filter((line) => !isNoiseLine(line))
    .flatMap((line, index) => segmentLine(line, index));
}

function segmentLine(line, position) {
  if (line.length <= 900) {
    return [{ text: line, position }];
  }

  return sentenceChunks(line, 720)
    .filter((chunk) => chunk.length >= 24)
    .map((chunk) => ({ text: chunk, position }));
}

function sentenceChunks(text, maxLength) {
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [text];
  const chunks = [];
  let current = "";

  for (const sentence of sentences.map((item) => item.trim()).filter(Boolean)) {
    if (current && `${current} ${sentence}`.length > maxLength) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function isNoiseLine(line) {
  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function analyzeSegment(segment, snapshot) {
  return RULES
    .map((rule) => analyzeRule(rule, segment, snapshot))
    .filter(Boolean)
    .sort(compareAnalysisScore);
}

function analyzeRule(rule, segment, snapshot) {
  const matchedPatterns = rule.patterns.filter((pattern) => pattern.re.test(segment.text));
  const score = patternScore(matchedPatterns) + ruleContextScore(rule, snapshot);

  if (score <= 0) return null;

  return {
    ...rule,
    matchedTerms: uniqueValues(matchedPatterns.map((pattern) => pattern.label)),
    score
  };
}

function patternScore(patterns) {
  return patterns.reduce((total, pattern) => total + pattern.weight, 0);
}

function ruleContextScore(rule, snapshot) {
  return [
    snapshot.category === "db_client" && rule.area === "client_ui",
    snapshot.source_type === "release_notes" && rule.area === "compatibility",
    snapshot.source_type === "driver_docs" && rule.component === "driver"
  ].filter(Boolean).length;
}

function compareAnalysisScore(left, right) {
  return right.score - left.score;
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function buildCandidate(snapshot, segment, analysis, analysisInput) {
  const factKey = hash(`${snapshot.snapshot_id}\n${analysis.area}\n${normalizeKey(segment.text)}`).slice(0, 20);
  const version = extractVersion(segment.text, snapshot);
  const termText = analysis.matchedTerms.join(", ");
  const evidence = segment.text.slice(0, 700);
  const title = `${snapshot.product}: ${analysis.title}`;
  const scopeText = analysisInput.mode === "changed" ? "added or changed" : "latest";
  const summary = [
    `The ${scopeText} ${snapshot.source_name} snapshot has ${analysis.label} material`,
    termText ? `matching ${termText}` : "matching the analyzer rules",
    "that should be checked before related implementation work."
  ].join(" ");

  return {
    factKey,
    sourceId: snapshot.source_id,
    snapshotId: snapshot.snapshot_id,
    product: snapshot.product,
    dbFamily: snapshot.category === "database" ? snapshot.product : "",
    version,
    area: analysis.area,
    component: analysis.component,
    title,
    summary,
    impact: analysis.impact,
    priority: analysis.priority,
    confidence: confidenceForScore(analysis.score),
    url: snapshot.url,
    score: analysis.score,
    position: segment.position,
    extractionMode: analysisInput.mode,
    previousSnapshotId: analysisInput.previousSnapshotId,
    lineCount: analysisInput.lineCount,
    addedLineCount: analysisInput.addedLineCount,
    matchedTerms: analysis.matchedTerms,
    evidence,
    noteTitle: `Review ${snapshot.product} ${analysis.area} for ${analysis.component}`,
    note: buildImplementationNote(snapshot, analysis, termText, analysisInput)
  };
}

function buildImplementationNote(snapshot, analysis, termText, analysisInput) {
  const paths = COMPONENT_PATHS[analysis.component] ?? "the affected Irodori component";
  const terms = termText || analysis.label;
  const scope =
    analysisInput.mode === "changed"
      ? `changed text segments since snapshot #${analysisInput.previousSnapshotId}`
      : "the latest upstream snapshot";
  return [
    `${snapshot.source_name} matched ${terms} in ${scope}.`,
    `Before changing ${paths}, check the latest upstream snapshot (${snapshot.source_id}) and confirm tests cover the documented behavior.`
  ].join(" ");
}

function insertCandidates(database, candidates) {
  let insertedFacts = 0;
  let reusedFacts = 0;
  let insertedNotes = 0;

  const findFact = database.prepare(`
    select id
    from facts
    where snapshot_id = ?
      and metadata_json like ?
    limit 1
  `);
  const insertFact = database.prepare(`
    insert into facts (
      source_id, snapshot_id, product, db_family, version, area, title,
      summary, impact, priority, confidence, url, metadata_json
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findNote = database.prepare(`
    select id
    from implementation_notes
    where fact_id = ?
      and component = ?
      and title = ?
    limit 1
  `);
  const insertNote = database.prepare(`
    insert into implementation_notes (
      fact_id, product, component, title, note, status
    ) values (?, ?, ?, ?, ?, 'open')
  `);

  database.exec("begin");
  try {
    for (const candidate of candidates) {
      const metadata = JSON.stringify({
        generator: GENERATOR,
        factKey: candidate.factKey,
        score: candidate.score,
        component: candidate.component,
        extractionMode: candidate.extractionMode,
        previousSnapshotId: candidate.previousSnapshotId,
        lineCount: candidate.lineCount,
        addedLineCount: candidate.addedLineCount,
        matchedTerms: candidate.matchedTerms,
        evidence: candidate.evidence
      });
      const existing = findFact.get(candidate.snapshotId, `%"factKey":"${candidate.factKey}"%`);
      let factId = existing?.id;

      if (factId) {
        reusedFacts += 1;
      } else {
        insertFact.run(
          candidate.sourceId,
          candidate.snapshotId,
          candidate.product,
          candidate.dbFamily,
          candidate.version,
          candidate.area,
          candidate.title,
          candidate.summary,
          candidate.impact,
          candidate.priority,
          candidate.confidence,
          candidate.url,
          metadata
        );
        factId = database.prepare("select last_insert_rowid() as id").get().id;
        insertedFacts += 1;
      }

      const existingNote = findNote.get(factId, candidate.component, candidate.noteTitle);
      if (!existingNote) {
        insertNote.run(
          factId,
          candidate.product,
          candidate.component,
          candidate.noteTitle,
          candidate.note
        );
        insertedNotes += 1;
      }
    }
    database.exec("commit");
  } catch (error) {
    database.exec("rollback");
    throw error;
  }

  return {
    scannedCandidates: candidates.length,
    insertedFacts,
    reusedFacts,
    insertedNotes
  };
}

function replaceGeneratedFacts(database, snapshotIds) {
  const uniqueIds = [...new Set(snapshotIds)];
  const findFacts = database.prepare(`
    select id
    from facts
    where snapshot_id = ?
      and metadata_json like ?
  `);
  const deleteNotes = database.prepare("delete from implementation_notes where fact_id = ?");
  const deleteFact = database.prepare("delete from facts where id = ?");

  database.exec("begin");
  try {
    for (const snapshotId of uniqueIds) {
      const rows = findFacts.all(snapshotId, `%"generator":"${GENERATOR}"%`);
      for (const row of rows) {
        deleteNotes.run(row.id);
        deleteFact.run(row.id);
      }
    }
    database.exec("commit");
  } catch (error) {
    database.exec("rollback");
    throw error;
  }
}

function printAnalysisSummary({ dbPath, snapshots, candidates, result, analysisOptions }) {
  console.log(formatAnalysisSummary({ dbPath, snapshots, candidates, result, analysisOptions }));
}

function formatAnalysisSummary({ dbPath, snapshots, candidates, result, analysisOptions }) {
  return [
    `knowledge db: ${dbPath}`,
    `snapshots scanned: ${snapshots.length}`,
    analysisOptions.changedOnly
      ? `changed-only: yes (${countSnapshotsWithPrevious(snapshots)} with previous snapshots)`
      : null,
    `candidates: ${candidates.length}`,
    `facts inserted: ${result.insertedFacts}`,
    `facts reused: ${result.reusedFacts}`,
    `implementation notes inserted: ${result.insertedNotes}`
  ]
    .filter(Boolean)
    .join("\n");
}

function countSnapshotsWithPrevious(snapshots) {
  return snapshots.filter((snapshot) => snapshot.previous_snapshot_id).length;
}

function printDryRun(candidates, options) {
  if (options.json) {
    console.log(JSON.stringify(candidates, null, 2));
    return;
  }

  console.log(formatDryRun(candidates));
}

function formatDryRun(candidates) {
  return [`candidates: ${candidates.length}`, ...candidates.map(formatDryRunCandidate)].join("\n");
}

function formatDryRunCandidate(candidate) {
  return [
    "",
    `${candidate.priority.toUpperCase()} ${candidate.product} / ${candidate.area} / ${candidate.component}`,
    candidate.title,
    candidate.summary,
    `mode: ${candidate.extractionMode}`,
    `terms: ${candidate.matchedTerms.join(", ") || "-"}`,
    `url: ${candidate.url}`,
    `evidence: ${candidate.evidence.slice(0, 220)}`
  ].join("\n");
}

function extractVersion(text, snapshot) {
  const urlVersion = snapshot.url.match(/(?:release-|relnotes\/|docs\/|manual\/|refman\/|v)(\d+(?:\.\d+){0,3})/i);
  if (urlVersion) return urlVersion[1];

  const textVersion = text.match(/\b(?:version|release|v)\s*(\d+(?:\.\d+){0,3})\b/i);
  return textVersion?.[1] ?? "";
}

function confidenceForScore(score) {
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function normalizeKey(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeLines(input) {
  return input
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 24 && /[a-zA-Z0-9]/.test(line));
}

function diffUnits(input) {
  const units = [];
  for (const line of normalizeLines(input)) {
    const sentences = line.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [line];
    for (const sentence of sentences.map((item) => item.replace(/\s+/g, " ").trim())) {
      if (sentence.length >= 24 && /[a-zA-Z0-9]/.test(sentence)) {
        units.push(sentence);
      }
    }
  }
  return units;
}

function normalizeDiffLine(input) {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function hash(input) {
  return createHash("sha256").update(input).digest("hex");
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(values) {
  return parseOptionArguments(values, { booleanOptions: BOOLEAN_OPTIONS });
}

function parseOptionArguments(values, { booleanOptions }) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
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
  console.log(`Usage: node tools/knowledge/analyze.mjs [options]

Generate facts and implementation notes from the latest stored source snapshots.

Options:
  --db <path>          SQLite DB path (default: knowledge/irodori-knowledge.sqlite)
  --source <id>        Analyze one source id
  --product <name>     Analyze one product
  --category <name>    Analyze one category: database, db_client, tooling, ai
  --limit <n>          Limit snapshots scanned
  --per-source <n>     Max facts generated per source (default: ${DEFAULT_PER_SOURCE})
  --min-score <n>      Minimum rule score (default: ${DEFAULT_MIN_SCORE})
  --changed-only       Analyze text segments added since the previous snapshot for each source
  --strict-changed     With --changed-only, skip sources that do not have a previous snapshot
  --dry-run            Print candidates without writing
  --replace            Replace generated facts/notes for scanned snapshots
  --json               Print JSON output
  --help               Show this help
`);
}

const COMPONENT_PATHS = {
  driver: "apps/desktop/src-tauri/src/db/ and crates/irodori-data-sources",
  metadata: "metadata introspection in apps/desktop/src-tauri/src/db/",
  sql_dialect: "crates/irodori-sql and apps/desktop/src/sql/",
  completion: "crates/irodori-completion and the CodeMirror editor integration",
  ui: "apps/desktop/src/ workbench UI",
  export: "apps/desktop/src/result-export.ts and import/export flows",
  planning: "docs/feature-matrix.md and docs/implementation-backlog.md"
};

const NOISE_PATTERNS = [
  /^copyright\b/i,
  /^previous\s+next\b/i,
  /^table of contents\b/i,
  /^skip to\b/i,
  /^this page\b/i,
  /^on this page\b/i,
  /^edit this page\b/i,
  /^feedback\b/i,
  /^sign in\b/i,
  /^cookie\b/i
];

const RULES = [
  {
    area: "compatibility",
    component: "driver",
    label: "compatibility, migration, or deprecation",
    title: "compatibility or deprecation note",
    priority: "high",
    impact: "May require driver, dialect, or compatibility tests before upgrading supported behavior.",
    patterns: [
      { label: "breaking change", weight: 4, re: /\bbreaking changes?\b/i },
      { label: "deprecated", weight: 4, re: /\bdeprecat(?:ed|ion|es?)\b/i },
      { label: "removed", weight: 4, re: /\bremoved?\b|\bno longer\b|\bend of support\b/i },
      { label: "migration", weight: 3, re: /\bmigrat(?:e|ion|ing)\b|\bupgrade\b/i },
      { label: "incompatible", weight: 3, re: /\bincompatib(?:le|ility)\b|\bbehavior changes?\b/i }
    ]
  },
  {
    area: "auth",
    component: "driver",
    label: "authentication or secure connection",
    title: "authentication or secure connection detail",
    priority: "high",
    impact: "Connection profiles, secret handling, or transport setup may need updates.",
    patterns: [
      { label: "authentication", weight: 3, re: /\bauth(?:entication|orization)?\b|\blogin\b|\bcredential\b/i },
      { label: "oauth", weight: 4, re: /\boauth\b|\bsso\b|\bsaml\b|\bopenid\b/i },
      { label: "mfa", weight: 4, re: /\bmfa\b|\bmulti-factor\b|\bpasscode\b/i },
      { label: "jwt", weight: 3, re: /\bjwt\b|\bkey[- ]pair\b|\bprivate key\b/i },
      { label: "tls", weight: 3, re: /\btls\b|\bssl\b|\bcertificate\b|\bencryption\b/i }
    ]
  },
  {
    area: "connection",
    component: "driver",
    label: "connection, protocol, or session behavior",
    title: "connection or protocol behavior",
    priority: "normal",
    impact: "Driver connection code may need option, timeout, protocol, or session handling changes.",
    patterns: [
      { label: "connection", weight: 2, re: /\bconnections?\b|\bconnection string\b|\bdatasource\b/i },
      { label: "session", weight: 2, re: /\bsessions?\b|\bcontext\b/i },
      { label: "protocol", weight: 3, re: /\bprotocol\b|\bhttp\b|\brest\b|\bgrpc\b|\bwire\b/i },
      { label: "timeout", weight: 2, re: /\btimeout\b|\bretry\b|\bkeepalive\b/i },
      { label: "proxy", weight: 3, re: /\bproxy\b|\btunnel\b|\bssh\b/i }
    ]
  },
  {
    area: "metadata",
    component: "metadata",
    label: "catalog or schema metadata",
    title: "catalog or schema metadata detail",
    priority: "normal",
    impact: "Schema explorer, ERD, edit keys, and completion metadata may need introspection updates.",
    patterns: [
      { label: "information schema", weight: 4, re: /\binformation_schema\b|\bsystem catalog\b|\bcatalog\b/i },
      { label: "schema objects", weight: 2, re: /\bschema\b|\btables?\b|\bviews?\b|\bcolumns?\b/i },
      { label: "constraints", weight: 3, re: /\bconstraints?\b|\bprimary key\b|\bforeign key\b|\bunique key\b/i },
      { label: "indexes", weight: 3, re: /\bindexes?\b|\bindices\b/i },
      { label: "describe", weight: 2, re: /\bdescribe\b|\bshow\s+(?:tables|columns|schemas|databases)\b/i }
    ]
  },
  {
    area: "sql_dialect",
    component: "sql_dialect",
    label: "SQL dialect syntax or semantics",
    title: "SQL dialect syntax detail",
    priority: "normal",
    impact: "SQL parsing, formatting, highlighting, snippets, and query generation may need updates.",
    patterns: [
      { label: "syntax", weight: 3, re: /\bsyntax\b|\bstatement\b|\bclause\b|\bgrammar\b/i },
      { label: "ddl", weight: 2, re: /\bcreate\b|\balter\b|\bdrop\b|\btruncate\b/i },
      { label: "dml", weight: 2, re: /\bselect\b|\binsert\b|\bupdate\b|\bdelete\b|\bmerge\b/i },
      { label: "data types", weight: 3, re: /\bdata types?\b|\bjson\b|\barray\b|\btimestamp\b|\bdate\b|\bnumeric\b|\bvector\b/i },
      { label: "functions", weight: 3, re: /\bfunctions?\b|\boperators?\b|\bkeywords?\b|\breserved\b/i },
      { label: "explain", weight: 3, re: /\bexplain\b|\bquery plan\b|\bprofile\b/i }
    ]
  },
  {
    area: "completion",
    component: "completion",
    label: "completion or editor assistance",
    title: "completion or editor assistance detail",
    priority: "normal",
    impact: "Completion ranking, snippets, or local knowledge prompts may need source-aware updates.",
    patterns: [
      { label: "autocomplete", weight: 4, re: /\bauto[- ]?complete\b|\bcompletion\b|\bsuggestions?\b/i },
      { label: "assistant", weight: 3, re: /\bassistant\b|\bcopilot\b|\btext-to-sql\b|\bnatural language\b/i },
      { label: "snippets", weight: 2, re: /\bsnippets?\b|\btemplates?\b/i },
      { label: "editor", weight: 2, re: /\beditor\b|\bworksheet\b|\bquery console\b/i }
    ]
  },
  {
    area: "result_ui",
    component: "ui",
    label: "result grid or data browsing UI",
    title: "result grid or data browsing behavior",
    priority: "normal",
    impact: "Result grid, row detail, export, or object browsing UX may need parity work.",
    patterns: [
      { label: "results", weight: 3, re: /\bresults?\b|\bgrid\b|\btable view\b|\bdata viewer\b/i },
      { label: "export", weight: 3, re: /\bexports?\b|\bcsv\b|\bjson\b|\bexcel\b|\bparquet\b/i },
      { label: "filter", weight: 2, re: /\bfilters?\b|\bsorts?\b|\bsearch\b/i },
      { label: "edit data", weight: 3, re: /\bedit data\b|\beditable\b|\bupdate rows?\b/i },
      { label: "schema browser", weight: 2, re: /\bschema browser\b|\bobject explorer\b|\bdata explorer\b/i }
    ]
  },
  {
    area: "visualization",
    component: "ui",
    label: "visualization or dashboard feature",
    title: "visualization or dashboard feature",
    priority: "normal",
    impact: "Charting, dashboard, and worksheet result visualization roadmap items may need updates.",
    patterns: [
      { label: "chart", weight: 4, re: /\bcharts?\b|\bvisuali[sz]ation\b|\bgraphs?\b/i },
      { label: "dashboard", weight: 4, re: /\bdashboards?\b|\breports?\b/i },
      { label: "notebook", weight: 3, re: /\bnotebooks?\b|\bstreamlit\b/i }
    ]
  },
  {
    area: "admin_monitoring",
    component: "planning",
    label: "administration, monitoring, or cost feature",
    title: "administration or monitoring capability",
    priority: "low",
    impact: "May inform roadmap scope, especially features that are platform-specific rather than core SQL client work.",
    patterns: [
      { label: "roles", weight: 3, re: /\broles?\b|\busers?\b|\bprivileges?\b|\bgrants?\b/i },
      { label: "monitoring", weight: 3, re: /\bmonitor(?:ing)?\b|\bquery history\b|\baudit\b|\blogs?\b/i },
      { label: "cost", weight: 3, re: /\bcost\b|\bbilling\b|\bbudget\b|\bwarehouse\b|\bcompute\b/i },
      { label: "sharing", weight: 3, re: /\bsharing\b|\bmarketplace\b|\bnative app\b/i }
    ]
  },
  {
    area: "client_market",
    component: "planning",
    label: "DB client product capability",
    title: "DB client capability signal",
    priority: "low",
    impact: "May update competitive parity notes or future UX backlog items.",
    patterns: [
      { label: "database client", weight: 3, re: /\bdatabase client\b|\bsql client\b|\bide\b|\bdata studio\b/i },
      { label: "drivers", weight: 2, re: /\bdrivers?\b|\bconnectors?\b|\bdata sources?\b/i },
      { label: "workspace", weight: 2, re: /\bworkspaces?\b|\bprojects?\b|\bteam\b|\bcollaboration\b/i },
      { label: "feature", weight: 2, re: /\bfeatures?\b|\bcapabilit(?:y|ies)\b/i }
    ]
  }
];

main(process.argv.slice(2));
