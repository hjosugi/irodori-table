import type { DbEngine } from "../generated/irodori-api";
import completionKeywordsConfig from "./completion-keywords.json";

export const SQL_COMPLETION_KEYWORDS_SCHEMA_VERSION = 1;

type CompletionKeywordConfig = {
  schemaVersion?: unknown;
  common?: unknown;
  engines?: unknown;
};

const keywordConfig =
  completionKeywordsConfig as unknown as CompletionKeywordConfig;

validateKeywordSchemaVersion(keywordConfig.schemaVersion);

export const commonSqlCompletionKeywords = keywordList(
  keywordConfig.common,
  "completionKeywords.common",
);

export const engineSqlCompletionKeywords = keywordMap(keywordConfig.engines);

function validateKeywordSchemaVersion(value: unknown): void {
  if (value !== SQL_COMPLETION_KEYWORDS_SCHEMA_VERSION) {
    throw new Error(
      `completionKeywords.schemaVersion must be ${SQL_COMPLETION_KEYWORDS_SCHEMA_VERSION}`,
    );
  }
}

function keywordMap(value: unknown): Partial<Record<DbEngine, string[]>> {
  if (!isRecord(value)) {
    throw new Error("completionKeywords.engines must be an object");
  }
  return Object.fromEntries(
    Object.entries(value).map(([engine, keywords]) => [
      engine,
      keywordList(keywords, `completionKeywords.engines.${engine}`),
    ]),
  ) as Partial<Record<DbEngine, string[]>>;
}

function keywordList(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return value.map((keyword, index) => {
    if (typeof keyword !== "string" || keyword.trim().length === 0) {
      throw new Error(`${fieldName}[${index}] must be a non-empty string`);
    }
    return keyword.trim();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
