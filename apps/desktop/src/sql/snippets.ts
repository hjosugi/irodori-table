import type { DbEngine } from "../generated/irodori-api";
import defaultSnippetConfig from "./default-snippets.json";

export type SqlSnippetScope = "statement" | "expression" | "clause";

export interface SqlSnippetDefinition {
  label: string;
  detail: string;
  template: string;
  scope: SqlSnippetScope;
  rank?: number;
  engines?: readonly DbEngine[];
  // Free-form grouping labels. Optional and additive: a snippet saved or
  // imported before tags existed simply has no `tags` key, which is why this
  // stayed on schemaVersion 1 instead of needing a migration.
  tags?: readonly string[];
}

export type SqlSnippetImportFormat = "json" | "yaml";

export interface SqlSnippetImportResult {
  format: SqlSnippetImportFormat;
  schemaVersion?: number;
  snippets: SqlSnippetDefinition[];
}

const SNIPPET_LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export const SQL_SNIPPETS_SCHEMA_VERSION = 1;

export const SNIPPET_TAG_MAX_LENGTH = 32;

export const DEFAULT_SNIPPET_RANK = 500;

type DefaultSnippetConfig = {
  schemaVersion?: unknown;
  engineGroups: Record<string, unknown>;
  snippets: unknown[];
};

const defaultSnippetsConfig =
  defaultSnippetConfig as unknown as DefaultSnippetConfig;

validateSchemaVersion(
  defaultSnippetsConfig.schemaVersion,
  SQL_SNIPPETS_SCHEMA_VERSION,
  "defaultSnippets.schemaVersion",
);

const defaultSnippetEngineGroups = isRecord(defaultSnippetsConfig.engineGroups)
  ? defaultSnippetsConfig.engineGroups
  : {};

export const sqlSnippetEngines = defaultSnippetEngineList(
  defaultSnippetEngineGroups.sqlSnippetEngines,
);

const sqlSnippetEngineSet = new Set<string>(sqlSnippetEngines);

export const defaultSqlSnippets: readonly SqlSnippetDefinition[] =
  defaultSqlSnippetsFromJson(defaultSnippetsConfig.snippets);

export function cloneDefaultSqlSnippets(): SqlSnippetDefinition[] {
  return defaultSqlSnippets.map(cloneSnippet);
}

export function mergeDefaultSqlSnippets(
  snippets: readonly SqlSnippetDefinition[],
): SqlSnippetDefinition[] {
  const seen = new Set(snippets.map(snippetIdentityKey));
  return [
    ...snippets.map(cloneSnippet),
    ...defaultSqlSnippets
      .filter(
        (snippetDefinition) => !seen.has(snippetIdentityKey(snippetDefinition)),
      )
      .map(cloneSnippet),
  ];
}

export function mergeImportedSqlSnippets(
  current: readonly SqlSnippetDefinition[],
  imported: readonly SqlSnippetDefinition[],
): SqlSnippetDefinition[] {
  const merged = current.map(cloneSnippet);
  const indexByKey = new Map(
    merged.map((snippet, index) => [snippetIdentityKey(snippet), index]),
  );

  for (const snippet of imported) {
    const nextSnippet = cloneSnippet(snippet);
    const key = snippetIdentityKey(nextSnippet);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push(nextSnippet);
    } else {
      merged[existingIndex] = nextSnippet;
    }
  }

  return merged;
}

export function snippetsForEngine(
  snippets: readonly SqlSnippetDefinition[],
  engine: DbEngine,
): SqlSnippetDefinition[] {
  const matching = snippets.filter((snippetDefinition) =>
    snippetMatchesEngine(snippetDefinition, engine),
  );
  const specificityByLabel = new Map<string, number>();
  for (const snippetDefinition of matching) {
    const specificity = snippetSpecificity(snippetDefinition);
    const current = specificityByLabel.get(snippetDefinition.label);
    if (current === undefined || specificity < current) {
      specificityByLabel.set(snippetDefinition.label, specificity);
    }
  }
  return matching
    .filter(
      (snippetDefinition) =>
        snippetSpecificity(snippetDefinition) ===
        specificityByLabel.get(snippetDefinition.label),
    )
    .map(cloneSnippet);
}

export function isSqlSnippetScope(value: unknown): value is SqlSnippetScope {
  return value === "statement" || value === "expression" || value === "clause";
}

export function isSqlSnippetEngine(value: unknown): value is DbEngine {
  return typeof value === "string" && sqlSnippetEngineSet.has(value);
}

export function sqlSnippetsFromJson(value: unknown): SqlSnippetDefinition[] {
  if (!Array.isArray(value)) {
    throw new Error("editor.snippets must be an array");
  }
  return value.map((entry, index) => sqlSnippetFromJson(entry, index));
}

export async function sqlSnippetsFromText(
  text: string,
  sourceName = "",
): Promise<SqlSnippetImportResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("snippet import is empty");
  }

  const format = inferSnippetImportFormat(sourceName, trimmed);
  const parsed =
    format === "json" ? JSON.parse(trimmed) : await parseYamlImport(trimmed);
  const schemaVersion = snippetImportSchemaVersion(parsed);
  const snippetValue = snippetsValueFromImportRoot(parsed);
  return {
    format,
    ...(schemaVersion === undefined ? {} : { schemaVersion }),
    snippets: sqlSnippetsFromJson(snippetValue),
  };
}

function defaultSqlSnippetsFromJson(value: unknown): SqlSnippetDefinition[] {
  if (!Array.isArray(value)) {
    throw new Error("defaultSnippets.snippets must be an array");
  }
  return value.map((entry, index) => defaultSqlSnippetFromJson(entry, index));
}

function defaultSqlSnippetFromJson(
  value: unknown,
  index: number,
): SqlSnippetDefinition {
  if (!isRecord(value)) {
    throw new Error(`defaultSnippets.snippets[${index}] must be an object`);
  }
  const groupEngines = defaultSnippetGroupEngines(value.engineGroups, index);
  const explicitEngines =
    value.engines === undefined || value.engines === null
      ? []
      : normalizeSnippetEngines(
          arrayField(
            value.engines,
            `defaultSnippets.snippets[${index}].engines`,
          ),
          `defaultSnippets.snippets[${index}].engines`,
        );
  return sqlSnippetFromJson(
    {
      ...value,
      engines: uniqueSnippetEngines([...groupEngines, ...explicitEngines]),
    },
    index,
  );
}

function defaultSnippetGroupEngines(value: unknown, index: number): DbEngine[] {
  if (value === undefined || value === null) {
    return [];
  }
  const groups = arrayField(
    value,
    `defaultSnippets.snippets[${index}].engineGroups`,
  );
  const engines: DbEngine[] = [];
  for (const group of groups) {
    if (typeof group !== "string" || group.length === 0) {
      throw new Error(
        `defaultSnippets.snippets[${index}].engineGroups must contain group names`,
      );
    }
    engines.push(
      ...normalizeSnippetEngines(
        arrayField(
          defaultSnippetEngineGroups[group],
          `defaultSnippets.engineGroups.${group}`,
        ),
        `defaultSnippets.engineGroups.${group}`,
      ),
    );
  }
  return engines;
}

function sqlSnippetFromJson(
  value: unknown,
  index: number,
): SqlSnippetDefinition {
  if (!isRecord(value)) {
    throw new Error(`editor.snippets[${index}] must be an object`);
  }
  const label = stringField(value, "label", index).trim();
  if (!SNIPPET_LABEL_PATTERN.test(label)) {
    throw new Error(
      `editor.snippets[${index}].label must start with a letter and contain only letters, numbers, "_" or "-"`,
    );
  }
  const detail = stringField(value, "detail", index).trim();
  const template = stringField(value, "template", index);
  const scope = value.scope;
  if (!isSqlSnippetScope(scope)) {
    throw new Error(
      `editor.snippets[${index}].scope must be "statement", "clause", or "expression"`,
    );
  }
  const rank = value.rank;
  if (
    rank !== undefined &&
    (typeof rank !== "number" || !Number.isFinite(rank))
  ) {
    throw new Error(`editor.snippets[${index}].rank must be a number`);
  }
  const engines = sqlSnippetEnginesFromJson(value.engines, index);
  const tags = sqlSnippetTagsFromJson(value.tags, index);
  return {
    label,
    detail,
    template,
    scope,
    ...(typeof rank === "number" && Number.isFinite(rank) ? { rank } : {}),
    ...(engines.length > 0 ? { engines } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function sqlSnippetTagsFromJson(value: unknown, index: number): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`editor.snippets[${index}].tags must be an array`);
  }
  for (const tag of value) {
    if (typeof tag !== "string") {
      throw new Error(`editor.snippets[${index}].tags must contain strings`);
    }
  }
  return normalizeSnippetTags(value as string[]);
}

// Tags are compared and grouped case-insensitively, so "DDL" and "ddl" are one
// group rather than two. Blank entries are dropped rather than rejected, so a
// trailing comma in the tag field is not an error.
export function normalizeSnippetTags(tags: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const value = tag.trim().toLowerCase().slice(0, SNIPPET_TAG_MAX_LENGTH);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export function parseSnippetTagInput(value: string): string[] {
  return normalizeSnippetTags(value.split(","));
}

export function formatSnippetTagInput(tags: readonly string[] | undefined) {
  return (tags ?? []).join(", ");
}

// Every tag in use, sorted, for the Settings tag filter.
export function collectSqlSnippetTags(
  snippets: readonly SqlSnippetDefinition[],
): string[] {
  const seen = new Set<string>();
  for (const snippet of snippets) {
    for (const tag of snippet.tags ?? []) {
      seen.add(tag);
    }
  }
  return [...seen].sort();
}

// Free-text search over everything a user might remember about a snippet: its
// trigger, its description, the SQL body itself, and its tags.
export function snippetMatchesSearch(
  snippet: SqlSnippetDefinition,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return (
    snippet.label.toLowerCase().includes(needle) ||
    snippet.detail.toLowerCase().includes(needle) ||
    snippet.template.toLowerCase().includes(needle) ||
    (snippet.tags ?? []).some((tag) => tag.includes(needle))
  );
}

// Selected tags widen rather than narrow (match any), so picking a second tag
// never empties the list the way "must have every tag" would.
export function snippetMatchesTags(
  snippet: SqlSnippetDefinition,
  tags: readonly string[],
): boolean {
  if (tags.length === 0) {
    return true;
  }
  const snippetTags = snippet.tags ?? [];
  return tags.some((tag) => snippetTags.includes(tag));
}

export function snippetMatchesFilter(
  snippet: SqlSnippetDefinition,
  query: string,
  tags: readonly string[],
): boolean {
  return (
    snippetMatchesSearch(snippet, query) && snippetMatchesTags(snippet, tags)
  );
}

function inferSnippetImportFormat(
  sourceName: string,
  text: string,
): SqlSnippetImportFormat {
  const lowerName = sourceName.toLowerCase();
  if (lowerName.endsWith(".yaml") || lowerName.endsWith(".yml")) {
    return "yaml";
  }
  if (lowerName.endsWith(".json")) {
    return "json";
  }
  return text.startsWith("{") || text.startsWith("[") ? "json" : "yaml";
}

function snippetsValueFromImportRoot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value)) {
    if ("snippets" in value) {
      return value.snippets;
    }
    if (isRecord(value.editor) && "snippets" in value.editor) {
      return value.editor.snippets;
    }
  }
  throw new Error(
    "snippet import must be an array, or an object with snippets or editor.snippets",
  );
}

function snippetImportSchemaVersion(value: unknown): number | undefined {
  if (!isRecord(value) || !("schemaVersion" in value)) {
    return undefined;
  }
  validateSchemaVersion(
    value.schemaVersion,
    SQL_SNIPPETS_SCHEMA_VERSION,
    "snippet import schemaVersion",
  );
  return SQL_SNIPPETS_SCHEMA_VERSION;
}

async function parseYamlImport(text: string): Promise<unknown> {
  const yaml = await import("yaml");
  return yaml.parse(text);
}

function validateSchemaVersion(
  value: unknown,
  expectedVersion: number,
  fieldName: string,
): void {
  if (value !== expectedVersion) {
    throw new Error(`${fieldName} must be ${expectedVersion}`);
  }
}

function sqlSnippetEnginesFromJson(value: unknown, index: number): DbEngine[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`editor.snippets[${index}].engines must be an array`);
  }
  return normalizeSnippetEngines(value, `editor.snippets[${index}].engines`);
}

function normalizeSnippetEngines(
  engines: readonly unknown[],
  fieldName: string,
): DbEngine[] {
  const normalized: DbEngine[] = [];
  const seen = new Set<DbEngine>();
  for (const engine of engines) {
    if (!isSqlSnippetEngine(engine)) {
      throw new Error(`${fieldName} contains an unsupported database engine`);
    }
    if (seen.has(engine)) continue;
    seen.add(engine);
    normalized.push(engine);
  }
  return normalized;
}

function defaultSnippetEngineList(value: unknown): readonly DbEngine[] {
  const engines = arrayField(
    value,
    "defaultSnippets.engineGroups.sqlSnippetEngines",
  );
  return engines.map((engine) => {
    if (typeof engine !== "string" || engine.length === 0) {
      throw new Error(
        "defaultSnippets.engineGroups.sqlSnippetEngines must contain engine ids",
      );
    }
    return engine as DbEngine;
  });
}

function uniqueSnippetEngines(engines: readonly DbEngine[]): DbEngine[] {
  const unique: DbEngine[] = [];
  const seen = new Set<DbEngine>();
  for (const engine of engines) {
    if (seen.has(engine)) continue;
    seen.add(engine);
    unique.push(engine);
  }
  return unique;
}

function arrayField(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value;
}

function stringField(
  value: Record<string, unknown>,
  field: "label" | "detail" | "template",
  index: number,
): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new Error(`editor.snippets[${index}].${field} must be a string`);
  }
  return fieldValue;
}

function snippetMatchesEngine(
  snippetDefinition: SqlSnippetDefinition,
  engine: DbEngine,
) {
  return (
    !snippetDefinition.engines ||
    snippetDefinition.engines.length === 0 ||
    snippetDefinition.engines.includes(engine)
  );
}

function snippetSpecificity(snippetDefinition: SqlSnippetDefinition): number {
  return snippetDefinition.engines && snippetDefinition.engines.length > 0
    ? snippetDefinition.engines.length
    : Number.POSITIVE_INFINITY;
}

function cloneSnippet(
  snippetDefinition: SqlSnippetDefinition,
): SqlSnippetDefinition {
  return {
    ...snippetDefinition,
    ...(snippetDefinition.engines
      ? { engines: [...snippetDefinition.engines] }
      : {}),
    ...(snippetDefinition.tags ? { tags: [...snippetDefinition.tags] } : {}),
  };
}

function snippetIdentityKey(snippetDefinition: SqlSnippetDefinition): string {
  const engines =
    snippetDefinition.engines && snippetDefinition.engines.length > 0
      ? [...snippetDefinition.engines].sort().join(",")
      : "*";
  return `${snippetDefinition.label}:${engines}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
