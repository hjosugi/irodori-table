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
}

export type SqlSnippetImportFormat = "json" | "yaml";

export interface SqlSnippetImportResult {
  format: SqlSnippetImportFormat;
  snippets: SqlSnippetDefinition[];
}

const SNIPPET_LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export const DEFAULT_SNIPPET_RANK = 500;

type DefaultSnippetConfig = {
  engineGroups: Record<string, unknown>;
  snippets: unknown[];
};

const defaultSnippetsConfig =
  defaultSnippetConfig as unknown as DefaultSnippetConfig;
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
  const snippetValue = snippetsValueFromImportRoot(parsed);
  return {
    format,
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
  return {
    label,
    detail,
    template,
    scope,
    ...(typeof rank === "number" && Number.isFinite(rank) ? { rank } : {}),
    ...(engines.length > 0 ? { engines } : {}),
  };
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

async function parseYamlImport(text: string): Promise<unknown> {
  const yaml = await import("yaml");
  return yaml.parse(text);
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
