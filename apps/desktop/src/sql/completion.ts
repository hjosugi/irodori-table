import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSection,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { SQLDialect } from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";
import type {
  ColumnMetadata,
  DatabaseMetadata,
  DbEngine,
  DbObjectMetadata,
  ForeignKey,
  SchemaMetadata,
} from "../generated/irodori-api";
import {
  DEFAULT_SNIPPET_RANK,
  defaultSqlSnippets,
  type SqlSnippetDefinition,
} from "./snippets";
import { statementDelimiters } from "./statements";

export {
  cloneDefaultSqlSnippets,
  defaultSqlSnippets,
  isSqlSnippetScope,
  sqlSnippetsFromJson,
  type SqlSnippetDefinition,
  type SqlSnippetScope,
} from "./snippets";

const MAX_SCAN_CHARS = 6_000;
const DEFAULT_LIMIT = 50;

const COLUMN_SECTION: CompletionSection = { name: "columns", rank: 1 };
const JOIN_SECTION: CompletionSection = { name: "joins", rank: 2 };
const RELATION_SECTION: CompletionSection = { name: "tables", rank: 3 };
const SCHEMA_SECTION: CompletionSection = { name: "schemas", rank: 4 };
const ROUTINE_SECTION: CompletionSection = { name: "routines", rank: 5 };
const SNIPPET_SECTION: CompletionSection = { name: "snippets", rank: 6 };
const KEYWORD_SECTION: CompletionSection = { name: "keywords", rank: 9 };

const COMMON_KEYWORDS = [
  "select",
  "from",
  "where",
  "join",
  "left join",
  "inner join",
  "group by",
  "order by",
  "having",
  "limit",
  "offset",
  "insert into",
  "update",
  "delete from",
  "with",
  "union all",
  "returning",
  "on",
  "and",
  "or",
  "as",
  "case",
  "when",
  "then",
  "else",
  "end",
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "coalesce",
  "nullif",
  "cast",
  "exists",
  "not exists",
  "distinct",
];

const ENGINE_KEYWORDS: Partial<Record<DbEngine, string[]>> = {
  postgres: ["ilike", "lateral", "explain analyze", "jsonb_build_object"],
  cockroachdb: ["upsert", "returning", "explain analyze"],
  yugabytedb: ["returning", "explain analyze"],
  timescaledb: ["time_bucket", "hypertable", "explain analyze"],
  neon: ["returning", "explain analyze"],
  mysql: ["straight_join", "explain format=json", "date_format"],
  mariadb: ["straight_join", "date_format"],
  tidb: ["explain analyze", "date_format"],
  sqlite: ["pragma", "without rowid", "strftime"],
  sqlserver: ["top", "cross apply", "outer apply", "with (nolock)"],
  oracle: ["fetch first", "connect by", "merge into", "nvl"],
  duckdb: ["sample", "qualify", "read_csv", "read_parquet"],
  clickhouse: ["prewhere", "array join", "limit by"],
  snowflake: ["qualify", "try_cast", "flatten"],
  bigquery: ["qualify", "unnest", "safe_cast"],
  redshift: ["distkey", "sortkey", "encode"],
};

const RELATION_START_KEYWORDS = new Set([
  "from",
  "join",
  "update",
  "into",
  "table",
  "describe",
  "desc",
]);

const COLUMN_CLAUSE_KEYWORDS = new Set([
  "select",
  "where",
  "on",
  "by",
  "having",
  "returning",
  "set",
  "values",
]);

const CLAUSE_KEYWORDS = new Set([
  "select",
  "from",
  "join",
  "where",
  "group",
  "order",
  "by",
  "having",
  "limit",
  "offset",
  "union",
  "except",
  "intersect",
  "returning",
  "set",
  "values",
  "update",
  "into",
  "on",
]);

const RESERVED_ALIAS_WORDS = new Set([
  ...CLAUSE_KEYWORDS,
  "as",
  "and",
  "or",
  "left",
  "right",
  "inner",
  "outer",
  "full",
  "cross",
  "natural",
  "lateral",
  "using",
  "with",
  "case",
  "when",
  "then",
  "else",
  "end",
]);

type SqlTokenType = "word" | "dot" | "comma" | "open" | "close";

interface SqlToken {
  type: SqlTokenType;
  text: string;
  lower: string;
}

interface ObjectEntry {
  schema: string;
  name: string;
  kind: DbObjectMetadata["kind"];
  object: DbObjectMetadata;
}

interface SchemaEntry {
  name: string;
  objects: ObjectEntry[];
  relations: ObjectEntry[];
  routines: ObjectEntry[];
}

interface RelationRef {
  alias: string;
  explicitAlias: boolean;
  entry: ObjectEntry;
}

export interface SqlCompletionIndex {
  defaultSchema?: string;
  schemas: SchemaEntry[];
  objects: ObjectEntry[];
  relations: ObjectEntry[];
  routines: ObjectEntry[];
  objectsByName: Map<string, ObjectEntry[]>;
  objectByQualifiedName: Map<string, ObjectEntry>;
}

interface Candidate {
  option: Completion;
  key: string;
  rank: number;
}

type RelationCompletionKeyword = "join" | "relation";

type CompletionMode =
  | { kind: "qualified"; qualification: string[] }
  | { kind: "relations"; relationKeyword: RelationCompletionKeyword }
  | { kind: "columns" }
  | { kind: "general" };

interface CompletionWord {
  from: number;
  text: string;
}

interface StatementRange {
  start: number;
  end: number;
}

interface ParsedCompletionContext {
  word: CompletionWord;
  prefix: string;
  aliases: RelationRef[];
  mode: CompletionMode;
}

interface ColumnCandidateOptions {
  afterQualifier?: boolean;
  detailPrefix?: string;
  baseRank?: number;
}

interface RelationCandidateOptions {
  afterQualifier?: boolean;
  lowPriority?: boolean;
  relations?: ObjectEntry[];
}

interface LightweightCompletionInput {
  doc: string;
  engine: DbEngine;
  explicit?: boolean;
  index: SqlCompletionIndex;
  limit?: number;
  pos?: number;
  snippets?: readonly SqlSnippetDefinition[];
}

export function lightweightSqlCompletionLanguageData(
  dialect: SQLDialect,
  engine: DbEngine,
  metadata: DatabaseMetadata | undefined,
  snippets: readonly SqlSnippetDefinition[] = defaultSqlSnippets,
): Extension {
  const index = buildSqlCompletionIndex(metadata);
  return dialect.language.data.of({
    autocomplete: lightweightSqlCompletionSource(engine, index, snippets),
  });
}

export function lightweightSqlCompletionSource(
  engine: DbEngine,
  index: SqlCompletionIndex,
  snippets: readonly SqlSnippetDefinition[] = defaultSqlSnippets,
): CompletionSource {
  return (context: CompletionContext) => {
    const windowStart = Math.max(0, context.pos - MAX_SCAN_CHARS);
    const windowEnd = Math.min(context.state.doc.length, context.pos + MAX_SCAN_CHARS);
    const doc = context.state.sliceDoc(windowStart, windowEnd);
    const result = completeSqlLightweight({
      doc,
      engine,
      explicit: context.explicit,
      index,
      pos: context.pos - windowStart,
      snippets,
    });
    if (!result) return null;
    return {
      ...result,
      from: result.from + windowStart,
      to: context.pos,
    };
  };
}

export function buildSqlCompletionIndex(
  metadata: DatabaseMetadata | undefined,
): SqlCompletionIndex {
  const schemas = (metadata?.schemas ?? []).map(schemaEntry);
  const objects = schemas.flatMap((schema) => schema.objects);

  return {
    defaultSchema: schemas[0]?.name,
    schemas,
    objects,
    relations: schemas.flatMap((schema) => schema.relations),
    routines: schemas.flatMap((schema) => schema.routines),
    objectsByName: groupObjectsByName(objects),
    objectByQualifiedName: mapObjectsByQualifiedName(objects),
  };
}

function schemaEntry(schema: SchemaMetadata): SchemaEntry {
  const objects = schema.objects.flatMap((object) =>
    object.kind === "index" ? [] : [objectEntry(schema.name, object)],
  );
  return {
    name: schema.name,
    objects,
    relations: objects.filter(isRelationEntry),
    routines: objects.filter(isRoutineEntry),
  };
}

function objectEntry(schemaName: string, object: DbObjectMetadata): ObjectEntry {
  return {
    schema: schemaName,
    name: object.name,
    kind: object.kind,
    object,
  };
}

function groupObjectsByName(objects: readonly ObjectEntry[]): Map<string, ObjectEntry[]> {
  return objects.reduce((grouped, object) => {
    pushMap(grouped, object.name.toLowerCase(), object);
    return grouped;
  }, new Map<string, ObjectEntry[]>());
}

function mapObjectsByQualifiedName(
  objects: readonly ObjectEntry[],
): Map<string, ObjectEntry> {
  return new Map<string, ObjectEntry>(
    objects.map((object) => [qualifiedKey(object.schema, object.name), object]),
  );
}

export function completeSqlLightweight(
  input: LightweightCompletionInput,
): CompletionResult | null {
  const pos = input.pos ?? input.doc.length;
  const context = parseCompletionContext(input.doc, pos, input.index);
  if (!context) return null;

  if (!input.explicit && !shouldAutoComplete(context.mode, context.prefix)) {
    return null;
  }

  const candidates = collectCompletionCandidates(
    input.engine,
    input.index,
    context,
    input.explicit ?? false,
    input.snippets ?? defaultSqlSnippets,
  );
  const options = rankedCompletionOptions(candidates, input.limit ?? DEFAULT_LIMIT);
  if (options.length === 0) return null;
  return {
    from: context.word.from,
    to: pos,
    options,
    filter: false,
  };
}

function parseCompletionContext(
  doc: string,
  pos: number,
  index: SqlCompletionIndex,
): ParsedCompletionContext | null {
  const statementRange = currentStatementRange(doc, pos);
  const statement = doc.slice(statementRange.start, statementRange.end);
  const statementBeforeCursor = doc.slice(statementRange.start, pos);
  if (isInsideBlockedRegion(statementBeforeCursor)) return null;

  const docBeforeCursor = doc.slice(0, pos);
  const word = wordBefore(docBeforeCursor, pos);
  const qualification = qualificationBefore(docBeforeCursor, word.from);
  const prefix = word.text;
  const tokensBeforePrefix = tokenizeSql(doc.slice(statementRange.start, word.from));
  const statementTokens = tokenizeSql(statement);
  const aliases = resolveRelationRefs(statementTokens, index);
  const mode = classifyCompletion(tokensBeforePrefix, qualification, aliases);

  return {
    word,
    prefix,
    aliases,
    mode,
  };
}

function collectCompletionCandidates(
  engine: DbEngine,
  index: SqlCompletionIndex,
  context: ParsedCompletionContext,
  explicit: boolean,
  snippets: readonly SqlSnippetDefinition[],
): Candidate[] {
  const candidates: Candidate[] = [];
  switch (context.mode.kind) {
    case "qualified":
      addQualifiedCandidates(
        candidates,
        index,
        context.aliases,
        context.mode.qualification,
        context.prefix,
      );
      break;
    case "relations":
      if (context.mode.relationKeyword === "join") {
        addJoinCandidates(candidates, index, context.aliases, context.prefix);
      }
      addRelationCandidates(candidates, index, context.prefix);
      addSchemaCandidates(candidates, index, context.prefix);
      break;
    case "columns":
      addScopedColumnCandidates(
        candidates,
        index,
        context.aliases,
        context.prefix,
        explicit,
      );
      addRoutineCandidates(candidates, index, context.prefix);
      addSnippetCandidates(candidates, snippets, context.prefix, explicit, [
        "expression",
        "clause",
      ]);
      if (context.prefix.length > 0 || explicit) {
        addRelationCandidates(candidates, index, context.prefix, {
          lowPriority: true,
        });
        addKeywordCandidates(candidates, engine, context.prefix);
      }
      break;
    case "general":
      if (explicit) {
        addScopedColumnCandidates(candidates, index, context.aliases, context.prefix, true);
      }
      addRelationCandidates(candidates, index, context.prefix);
      addSchemaCandidates(candidates, index, context.prefix);
      addRoutineCandidates(candidates, index, context.prefix);
      addSnippetCandidates(candidates, snippets, context.prefix, explicit);
      addKeywordCandidates(candidates, engine, context.prefix);
      break;
  }
  return candidates;
}

function addQualifiedCandidates(
  candidates: Candidate[],
  index: SqlCompletionIndex,
  aliases: RelationRef[],
  qualification: string[],
  prefix: string,
) {
  if (qualification.length === 1) {
    const name = qualification[0];
    const alias = aliases.find((ref) => sameIdentifier(ref.alias, name));
    if (alias) {
      addColumnCandidates(candidates, alias.entry, prefix, {
        afterQualifier: true,
        detailPrefix: `${alias.entry.schema}.${alias.entry.name}`,
      });
      return;
    }

    const schema = index.schemas.find(
      (candidate) => sameIdentifier(candidate.name, name),
    );
    if (schema) {
      addRelationCandidates(candidates, index, prefix, {
        relations: schema.relations,
        afterQualifier: true,
      });
      return;
    }

    const object = findObject(index, [name]);
    if (object) {
      addColumnCandidates(candidates, object, prefix, { afterQualifier: true });
    }
    return;
  }

  const object = findObject(index, qualification);
  if (object) {
    addColumnCandidates(candidates, object, prefix, { afterQualifier: true });
  }
}

function addScopedColumnCandidates(
  candidates: Candidate[],
  index: SqlCompletionIndex,
  aliases: RelationRef[],
  prefix: string,
  explicit: boolean,
) {
  const refs = uniqueRelationRefs(aliases);
  if (refs.length === 0) {
    if (!explicit && prefix.length < 2) return;
    for (const entry of index.relations) {
      addColumnCandidates(candidates, entry, prefix, {
        detailPrefix: `${entry.schema}.${entry.name}`,
        baseRank: 150,
      });
    }
    return;
  }

  const columnCounts = countColumnsByName(refs);

  for (const ref of refs) {
    const forceQualified = refs.length > 1 || ref.explicitAlias;
    for (const column of ref.entry.object.columns) {
      const label = scopedColumnLabel(ref, column, columnCounts, forceQualified);
      if (!matchesAny(prefix, [label, column.name])) continue;
      const detail = `${ref.entry.name}.${column.name} ${columnDetail(column)}`;
      const rank =
        420 +
        columnRankBonus(ref.entry.object, column) +
        matchBonus(prefix, label, column.name);
      candidates.push({
        key: `column:${ref.alias}:${ref.entry.schema}:${ref.entry.name}:${column.name}`,
        rank,
        option: {
          label,
          apply: label,
          detail,
          type: "property",
          section: COLUMN_SECTION,
          boost: clampBoost(rank - 400),
        },
      });
    }
  }
}

function countColumnsByName(refs: readonly RelationRef[]): Map<string, number> {
  return refs.reduce((counts, ref) => {
    for (const column of ref.entry.object.columns) {
      const key = column.name.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, new Map<string, number>());
}

function scopedColumnLabel(
  ref: RelationRef,
  column: ColumnMetadata,
  columnCounts: ReadonlyMap<string, number>,
  forceQualified: boolean,
): string {
  const ambiguous = (columnCounts.get(column.name.toLowerCase()) ?? 0) > 1;
  return forceQualified || ambiguous ? `${ref.alias}.${column.name}` : column.name;
}

function addColumnCandidates(
  candidates: Candidate[],
  entry: ObjectEntry,
  prefix: string,
  options: ColumnCandidateOptions,
) {
  for (const column of entry.object.columns) {
    if (!matchesAny(prefix, [column.name])) continue;
    const detailPrefix = options.detailPrefix ?? `${entry.schema}.${entry.name}`;
    const rank =
      (options.baseRank ?? 520) +
      columnRankBonus(entry.object, column) +
      matchBonus(prefix, column.name);
    candidates.push({
      key: `column:${entry.schema}:${entry.name}:${column.name}:${options.afterQualifier ? "q" : "u"}`,
      rank,
      option: {
        label: column.name,
        apply: column.name,
        detail: `${detailPrefix} ${columnDetail(column)}`,
        type: "property",
        section: COLUMN_SECTION,
        boost: clampBoost(rank - 480),
      },
    });
  }
}

function addRelationCandidates(
  candidates: Candidate[],
  index: SqlCompletionIndex,
  prefix: string,
  options: RelationCandidateOptions = {},
) {
  const relations = options.relations ?? index.relations;
  for (const entry of relations) {
    const apply =
      options.afterQualifier || !shouldQualifyRelationName(entry, index)
        ? entry.name
        : qualifiedName(entry);
    const matchTexts = objectMatchTexts(entry);
    if (!matchesAny(prefix, matchTexts)) continue;
    const rank =
      (options.lowPriority ? 130 : 330) +
      (entry.kind === "table" ? 12 : 0) +
      matchBonus(prefix, ...matchTexts);
    candidates.push({
      key: `relation:${entry.schema}:${entry.name}:${apply}`,
      rank,
      option: {
        label: entry.name,
        apply,
        detail: `${entry.schema} ${entry.kind}`,
        type: entry.kind === "view" ? "type" : "class",
        section: RELATION_SECTION,
        commitCharacters: ["."],
        boost: clampBoost(rank - 300),
      },
    });
  }
}

function addSchemaCandidates(
  candidates: Candidate[],
  index: SqlCompletionIndex,
  prefix: string,
) {
  for (const schema of index.schemas) {
    if (!matchesAny(prefix, [schema.name])) continue;
    const rank = 260 + matchBonus(prefix, schema.name);
    candidates.push({
      key: `schema:${schema.name}`,
      rank,
      option: {
        label: schema.name,
        apply: `${schema.name}.`,
        detail: "schema",
        type: "namespace",
        section: SCHEMA_SECTION,
        boost: clampBoost(rank - 250),
      },
    });
  }
}

function addRoutineCandidates(
  candidates: Candidate[],
  index: SqlCompletionIndex,
  prefix: string,
) {
  for (const entry of index.routines) {
    const matchTexts = objectMatchTexts(entry);
    if (!matchesAny(prefix, matchTexts)) continue;
    const rank = 230 + matchBonus(prefix, entry.name);
    candidates.push({
      key: `routine:${entry.schema}:${entry.name}:${entry.kind}`,
      rank,
      option: {
        label: entry.name,
        apply: `${entry.name}(`,
        detail: `${entry.schema} ${entry.kind}`,
        type: "function",
        section: ROUTINE_SECTION,
        boost: clampBoost(rank - 220),
      },
    });
  }
}

function addSnippetCandidates(
  candidates: Candidate[],
  snippets: readonly SqlSnippetDefinition[],
  prefix: string,
  explicit: boolean,
  scopes?: readonly SqlSnippetDefinition["scope"][],
) {
  if (!explicit && prefix.length === 0) return;
  for (const definition of snippets) {
    if (scopes && !scopes.includes(definition.scope)) continue;
    if (!matchesAny(prefix, [definition.label, definition.detail])) continue;
    const baseRank = definition.rank ?? DEFAULT_SNIPPET_RANK;
    const rank =
      baseRank + matchBonus(prefix, definition.label, definition.detail);
    candidates.push({
      key: `snippet:${definition.label}`,
      rank,
      option: snippetCompletion(definition.template, {
        label: definition.label,
        detail: definition.detail,
        type: "keyword",
        section: SNIPPET_SECTION,
        boost: clampBoost(rank - 500),
      }),
    });
  }
}

function addKeywordCandidates(
  candidates: Candidate[],
  engine: DbEngine,
  prefix: string,
) {
  for (const keyword of keywordList(engine)) {
    if (!matchesAny(prefix, [keyword])) continue;
    const rank = 90 + matchBonus(prefix, keyword);
    candidates.push({
      key: `keyword:${keyword}`,
      rank,
      option: {
        label: keyword,
        apply: keyword,
        detail: "keyword",
        type: "keyword",
        section: KEYWORD_SECTION,
        boost: clampBoost(rank - 90),
      },
    });
  }
}

function addJoinCandidates(
  candidates: Candidate[],
  index: SqlCompletionIndex,
  aliases: RelationRef[],
  prefix: string,
) {
  const refs = uniqueRelationRefs(aliases);
  if (refs.length === 0) return;
  const usedAliases = new Set(refs.map((ref) => ref.alias.toLowerCase()));
  const usedObjects = new Set(
    refs.map((ref) => qualifiedKey(ref.entry.schema, ref.entry.name)),
  );

  for (const entry of index.relations) {
    if (usedObjects.has(qualifiedKey(entry.schema, entry.name))) continue;
    const matchTexts = objectMatchTexts(entry);
    if (!matchesAny(prefix, matchTexts)) continue;

    const alias = proposedAlias(entry.name, usedAliases);
    const match = firstJoinMatch(entry, alias, refs);
    if (!match) continue;
    const relationName = relationInsertName(entry, index);
    const apply = `${relationName} ${alias} on ${match.condition}`;
    const rank = 620 + matchBonus(prefix, entry.name);
    candidates.push({
      key: `join:${entry.schema}:${entry.name}:${match.condition}`,
      rank,
      option: {
        label: entry.name,
        apply,
        detail: match.detail,
        type: "class",
        section: JOIN_SECTION,
        boost: clampBoost(rank - 560),
      },
    });
  }
}

function firstJoinMatch(
  candidate: ObjectEntry,
  candidateAlias: string,
  refs: RelationRef[],
): { condition: string; detail: string } | null {
  for (const ref of refs) {
    const candidateToRef = joinFromForeignKeys(
      candidate.object.foreignKeys,
      candidate,
      candidateAlias,
      ref.entry,
      ref.alias,
      true,
    );
    if (candidateToRef) return candidateToRef;

    const refToCandidate = joinFromForeignKeys(
      ref.entry.object.foreignKeys,
      ref.entry,
      ref.alias,
      candidate,
      candidateAlias,
      false,
    );
    if (refToCandidate) return refToCandidate;
  }
  return null;
}

function joinFromForeignKeys(
  foreignKeys: ForeignKey[],
  source: ObjectEntry,
  sourceAlias: string,
  target: ObjectEntry,
  targetAlias: string,
  sourceIsCandidate: boolean,
): { condition: string; detail: string } | null {
  for (const fk of foreignKeys) {
    if (!referencesObject(fk, source.schema, target)) continue;
    const conditions = fk.columns
      .map((column, index) => {
        const targetColumn = fk.referencesColumns[index];
        if (!targetColumn) return null;
        return `${sourceAlias}.${column} = ${targetAlias}.${targetColumn}`;
      })
      .filter((condition): condition is string => Boolean(condition));
    if (conditions.length === 0) continue;
    const arrow = sourceIsCandidate
      ? `fk -> ${target.name}`
      : `fk <- ${source.name}`;
    return {
      condition: conditions.join(" and "),
      detail: arrow,
    };
  }
  return null;
}

function referencesObject(
  fk: ForeignKey,
  sourceSchema: string,
  target: ObjectEntry,
): boolean {
  if (fk.referencesTable.toLowerCase() !== target.name.toLowerCase()) return false;
  const referencesSchema = fk.referencesSchema ?? sourceSchema;
  return referencesSchema.toLowerCase() === target.schema.toLowerCase();
}

function classifyCompletion(
  tokensBeforePrefix: SqlToken[],
  qualification: string[] | null,
  aliases: RelationRef[],
): CompletionMode {
  if (qualification) {
    return { kind: "qualified", qualification };
  }
  const relationKeyword = relationContextKeyword(tokensBeforePrefix);
  if (relationKeyword) {
    return { kind: "relations", relationKeyword };
  }
  const clause = nearestClauseKeyword(tokensBeforePrefix);
  if (aliases.length > 0 || (clause && COLUMN_CLAUSE_KEYWORDS.has(clause))) {
    return { kind: "columns" };
  }
  return { kind: "general" };
}

function relationContextKeyword(tokens: SqlToken[]): RelationCompletionKeyword | null {
  const lastWord = lastWordLower(tokens);
  if (lastWord && RELATION_START_KEYWORDS.has(lastWord)) {
    return lastWord === "join" ? "join" : "relation";
  }
  const last = lastToken(tokens);
  const clause = nearestClauseKeyword(tokens);
  if (last?.type === "comma" && (clause === "from" || clause === "join")) {
    return "relation";
  }
  return null;
}

function shouldAutoComplete(mode: CompletionMode, prefix: string): boolean {
  if (mode.kind === "qualified" || mode.kind === "relations") return true;
  if (mode.kind === "columns") return prefix.length > 0;
  return prefix.length > 0;
}

function resolveRelationRefs(
  tokens: SqlToken[],
  index: SqlCompletionIndex,
): RelationRef[] {
  const refs: RelationRef[] = [];
  let inFromList = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== "word") {
      if (token.type === "comma" && inFromList) {
        const parsed = parseRelationAt(tokens, i + 1, index);
        if (parsed) {
          refs.push(parsed.ref);
          i = parsed.next - 1;
        }
      }
      continue;
    }

    if (CLAUSE_KEYWORDS.has(token.lower) && token.lower !== "join") {
      inFromList = token.lower === "from";
    }

    if (token.lower === "from" || token.lower === "join") {
      const parsed = parseRelationAt(tokens, i + 1, index);
      inFromList = token.lower === "from";
      if (parsed) {
        refs.push(parsed.ref);
        i = parsed.next - 1;
      }
      continue;
    }

    if (token.lower === "update" || token.lower === "into") {
      const parsed = parseRelationAt(tokens, i + 1, index);
      if (parsed) {
        refs.push(parsed.ref);
        i = parsed.next - 1;
      }
    }
  }

  return refs;
}

function parseRelationAt(
  tokens: SqlToken[],
  start: number,
  index: SqlCompletionIndex,
): { ref: RelationRef; next: number } | null {
  let i = start;
  while (tokens[i]?.type === "word" && tokens[i].lower === "lateral") {
    i += 1;
  }
  if (tokens[i]?.type === "open") return null;

  const name = readQualifiedName(tokens, i);
  if (!name) return null;
  const entry = findObject(index, name.parts);
  if (!entry || !isRelationEntry(entry)) return null;

  let next = name.next;
  let alias = entry.name;
  let explicitAlias = false;
  if (tokens[next]?.type === "word" && tokens[next].lower === "as") {
    if (isAliasToken(tokens[next + 1])) {
      alias = tokens[next + 1].text;
      explicitAlias = true;
      next += 2;
    }
  } else if (isAliasToken(tokens[next])) {
    alias = tokens[next].text;
    explicitAlias = true;
    next += 1;
  }

  return {
    ref: { alias, explicitAlias, entry },
    next,
  };
}

function readQualifiedName(
  tokens: SqlToken[],
  start: number,
): { parts: string[]; next: number } | null {
  if (tokens[start]?.type !== "word") return null;
  const parts = [tokens[start].text];
  let next = start + 1;
  while (tokens[next]?.type === "dot" && tokens[next + 1]?.type === "word") {
    parts.push(tokens[next + 1].text);
    next += 2;
  }
  return { parts, next };
}

function findObject(index: SqlCompletionIndex, parts: string[]): ObjectEntry | null {
  if (parts.length >= 2) {
    const schema = parts[parts.length - 2];
    const object = parts[parts.length - 1];
    return index.objectByQualifiedName.get(qualifiedKey(schema, object)) ?? null;
  }

  const name = parts[0];
  if (!name) return null;
  if (index.defaultSchema) {
    const inDefault = index.objectByQualifiedName.get(
      qualifiedKey(index.defaultSchema, name),
    );
    if (inDefault) return inDefault;
  }
  const matches = index.objectsByName.get(name.toLowerCase()) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      i = skipLineComment(sql, i + 2);
      continue;
    }
    if (char === "/" && next === "*") {
      i = skipBlockComment(sql, i + 2);
      continue;
    }
    if (char === "'") {
      i = skipQuoted(sql, i, "'");
      continue;
    }
    if (char === '"' || char === "`") {
      const quoted = readQuotedIdentifier(sql, i, char, char);
      if (quoted) {
        tokens.push({ type: "word", text: quoted.text, lower: quoted.text.toLowerCase() });
        i = quoted.end;
        continue;
      }
    }
    if (char === "[") {
      const quoted = readQuotedIdentifier(sql, i, "[", "]");
      if (quoted) {
        tokens.push({ type: "word", text: quoted.text, lower: quoted.text.toLowerCase() });
        i = quoted.end;
        continue;
      }
    }
    if (isIdentifierChar(char)) {
      const start = i;
      i += 1;
      while (i < sql.length && isIdentifierChar(sql[i])) i += 1;
      const text = sql.slice(start, i);
      tokens.push({ type: "word", text, lower: text.toLowerCase() });
      continue;
    }
    if (char === ".") tokens.push({ type: "dot", text: char, lower: char });
    if (char === ",") tokens.push({ type: "comma", text: char, lower: char });
    if (char === "(") tokens.push({ type: "open", text: char, lower: char });
    if (char === ")") tokens.push({ type: "close", text: char, lower: char });
    i += 1;
  }
  return tokens;
}

function wordBefore(doc: string, pos: number): { from: number; text: string } {
  let from = pos;
  while (from > 0 && isIdentifierChar(doc[from - 1])) from -= 1;
  return { from, text: doc.slice(from, pos) };
}

function qualificationBefore(doc: string, wordStart: number): string[] | null {
  const parts: string[] = [];
  let dot = skipWhitespaceBack(doc, wordStart - 1);
  if (doc[dot] !== ".") return null;

  while (dot >= 0 && doc[dot] === ".") {
    const end = skipWhitespaceBack(doc, dot - 1) + 1;
    const ident = readIdentifierBack(doc, end);
    if (!ident) break;
    parts.unshift(ident.text);
    dot = skipWhitespaceBack(doc, ident.from - 1);
  }
  return parts.length > 0 ? parts : null;
}

function readIdentifierBack(
  doc: string,
  end: number,
): { from: number; text: string } | null {
  if (end <= 0) return null;
  const last = doc[end - 1];
  if (last === '"' || last === "`") {
    const start = doc.lastIndexOf(last, end - 2);
    if (start >= 0) return { from: start, text: doc.slice(start + 1, end - 1) };
  }
  if (last === "]") {
    const start = doc.lastIndexOf("[", end - 2);
    if (start >= 0) return { from: start, text: doc.slice(start + 1, end - 1) };
  }

  let from = end;
  while (from > 0 && isIdentifierChar(doc[from - 1])) from -= 1;
  if (from === end) return null;
  return { from, text: doc.slice(from, end) };
}

function isInsideBlockedRegion(sql: string): boolean {
  let single = false;
  let double = false;
  let backtick = false;
  let bracket = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (single) {
      if (char === "'" && next === "'") {
        i += 1;
      } else if (char === "'") {
        single = false;
      }
      continue;
    }
    if (double) {
      if (char === '"' && next === '"') {
        i += 1;
      } else if (char === '"') {
        double = false;
      }
      continue;
    }
    if (backtick) {
      if (char === "`") backtick = false;
      continue;
    }
    if (bracket) {
      if (char === "]") bracket = false;
      continue;
    }
    if (char === "-" && next === "-") {
      lineComment = true;
      i += 1;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      i += 1;
    } else if (char === "'") {
      single = true;
    } else if (char === '"') {
      double = true;
    } else if (char === "`") {
      backtick = true;
    } else if (char === "[") {
      bracket = true;
    }
  }
  return single || double || backtick || bracket || lineComment || blockComment;
}

function currentStatementRange(doc: string, pos: number): StatementRange {
  const cursor = Math.max(0, Math.min(pos, doc.length));
  let start = 0;
  let end = doc.length;

  for (const delimiter of statementDelimiters(doc)) {
    if (delimiter < cursor) {
      start = delimiter + 1;
    } else {
      end = delimiter;
      break;
    }
  }

  return { start, end };
}

function nearestClauseKeyword(tokens: SqlToken[]): string | null {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (token.type === "word" && CLAUSE_KEYWORDS.has(token.lower)) {
      return token.lower;
    }
  }
  return null;
}

function lastWordLower(tokens: SqlToken[]): string | null {
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (tokens[i].type === "word") return tokens[i].lower;
  }
  return null;
}

function lastToken(tokens: SqlToken[]): SqlToken | null {
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

function isAliasToken(token: SqlToken | undefined): token is SqlToken {
  return Boolean(
    token &&
      token.type === "word" &&
      !RESERVED_ALIAS_WORDS.has(token.lower),
  );
}

function uniqueRelationRefs(refs: RelationRef[]): RelationRef[] {
  const seen = new Set<string>();
  const unique: RelationRef[] = [];
  for (const ref of refs) {
    const key = `${ref.alias.toLowerCase()}:${qualifiedKey(ref.entry.schema, ref.entry.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function rankedCompletionOptions(candidates: Candidate[], limit: number): Completion[] {
  return uniqueCandidates(candidates)
    .sort(compareCandidateRank)
    .slice(0, limit)
    .map((candidate) => candidate.option);
}

function uniqueCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      const key = candidateDedupKey(candidate);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function candidateDedupKey(candidate: Candidate): string {
  return `${candidate.key}:${candidate.option.label}:${candidate.option.apply ?? ""}`;
}

function compareCandidateRank(left: Candidate, right: Candidate): number {
  return (
    right.rank - left.rank ||
    sectionRank(left.option.section) - sectionRank(right.option.section) ||
    left.option.label.localeCompare(right.option.label)
  );
}

function sectionRank(section: Completion["section"]): number {
  if (typeof section === "object") {
    return section.rank === "dynamic" ? 50 : (section.rank ?? 50);
  }
  return 50;
}

function matchesAny(prefix: string, texts: readonly string[]): boolean {
  if (!prefix) return true;
  return bestMatchBonus(prefix, texts) !== null;
}

function matchBonus(prefix: string, ...texts: string[]): number {
  if (!prefix) return 0;
  return bestMatchBonus(prefix, texts) ?? 0;
}

function bestMatchBonus(prefix: string, texts: readonly string[]): number | null {
  const needle = prefix.toLowerCase();
  let best: number | null = null;
  for (const text of texts) {
    const bonus = textMatchBonus(needle, text);
    if (bonus !== null) best = Math.max(best ?? 0, bonus);
  }
  return best;
}

function textMatchBonus(needle: string, text: string): number | null {
  const lower = text.toLowerCase();
  if (lower === needle) return 80;
  if (lower.startsWith(needle)) return 45;
  if (lower.split(".").some((part) => part.startsWith(needle))) return 28;
  if (needle.length < 3) return null;
  if (lower.split(/[_\s]+/).some((part) => part.startsWith(needle))) return 18;
  if (lower.includes(needle)) return 8;
  return null;
}

function columnRankBonus(object: DbObjectMetadata, column: ColumnMetadata): number {
  let bonus = 30 - Math.min(column.ordinal, 30);
  if (object.primaryKey.includes(column.name)) bonus += 35;
  if (object.foreignKeys.some((fk) => fk.columns.includes(column.name))) bonus += 18;
  return bonus;
}

function columnDetail(column: ColumnMetadata): string {
  return column.nullable ? column.dataType : `${column.dataType} not null`;
}

function keywordList(engine: DbEngine): string[] {
  return [...new Set([...COMMON_KEYWORDS, ...(ENGINE_KEYWORDS[engine] ?? [])])];
}

function relationInsertName(entry: ObjectEntry, index: SqlCompletionIndex): string {
  return shouldQualifyRelationName(entry, index) ? qualifiedName(entry) : entry.name;
}

function shouldQualifyRelationName(
  entry: ObjectEntry,
  index: SqlCompletionIndex,
): boolean {
  const duplicateName =
    (index.objectsByName.get(entry.name.toLowerCase()) ?? []).length > 1;
  return duplicateName || entry.schema !== index.defaultSchema;
}

function objectMatchTexts(entry: ObjectEntry): [string, string] {
  return [entry.name, qualifiedName(entry)];
}

function qualifiedName(entry: ObjectEntry): string {
  return `${entry.schema}.${entry.name}`;
}

function proposedAlias(name: string, used: Set<string>): string {
  const parts = name.split(/[_\s]+/).filter(Boolean);
  const seeds = [
    parts.length > 1 ? parts.map((part) => part[0]).join("") : name[0],
    name.slice(0, 2),
    name,
  ].filter(Boolean);

  for (const seed of seeds) {
    const alias = seed.toLowerCase();
    if (!used.has(alias) && !RESERVED_ALIAS_WORDS.has(alias)) return alias;
  }

  let suffix = 2;
  const base = (seeds[0] ?? "t").toLowerCase();
  while (used.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

function isRelationEntry(entry: ObjectEntry): boolean {
  return entry.kind === "table" || entry.kind === "view";
}

function isRoutineEntry(entry: ObjectEntry): boolean {
  return entry.kind === "function" || entry.kind === "procedure";
}

function qualifiedKey(schema: string, object: string): string {
  return `${schema.toLowerCase()}.${object.toLowerCase()}`;
}

function sameIdentifier(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function clampBoost(value: number): number {
  return Math.max(-99, Math.min(99, value));
}

function isIdentifierChar(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_$]/.test(char));
}

function skipWhitespaceBack(doc: string, index: number): number {
  let i = index;
  while (i >= 0 && /\s/.test(doc[i])) i -= 1;
  return i;
}

function skipLineComment(sql: string, start: number): number {
  const end = sql.indexOf("\n", start);
  return end >= 0 ? end + 1 : sql.length;
}

function skipBlockComment(sql: string, start: number): number {
  const end = sql.indexOf("*/", start);
  return end >= 0 ? end + 2 : sql.length;
}

function skipQuoted(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote && sql[i + 1] === quote) {
      i += 2;
    } else if (sql[i] === quote) {
      return i + 1;
    } else {
      i += 1;
    }
  }
  return sql.length;
}

function readQuotedIdentifier(
  sql: string,
  start: number,
  _open: string,
  close: string,
): { text: string; end: number } | null {
  const end = sql.indexOf(close, start + 1);
  if (end < 0) return null;
  return { text: sql.slice(start + 1, end), end: end + 1 };
}
