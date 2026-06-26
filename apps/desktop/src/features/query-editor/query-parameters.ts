import type {
  QueryParameterInput,
  QueryParameterPromptSet,
} from "@/generated/irodori-api";

export const queryParameterMemoryStorageKey = "irodori.queryParameters.v1";

export type QueryParameterMemory = Record<string, Record<string, string>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadQueryParameterMemory(): QueryParameterMemory {
  try {
    const raw = window.localStorage.getItem(queryParameterMemoryStorageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    const memory: QueryParameterMemory = {};
    for (const [signature, values] of Object.entries(parsed)) {
      if (!isRecord(values)) {
        continue;
      }
      const entry: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === "string") {
          entry[key] = value;
        }
      }
      memory[signature] = entry;
    }
    return memory;
  } catch {
    return {};
  }
}

function parseParameterValue(input: string): unknown {
  const trimmed = input.trim();
  if (trimmed === "null") {
    return null;
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (/^-?\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isSafeInteger(value)) {
      return value;
    }
  }
  if (/^-?(?:\d+\.\d+|\d+e[+-]?\d+|\d+\.\d+e[+-]?\d+)$/i.test(trimmed)) {
    const value = Number(trimmed);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return input;
    }
  }
  return input;
}

export function buildParameterInputs(
  promptSet: QueryParameterPromptSet,
  values: Record<string, string>,
): QueryParameterInput[] {
  return promptSet.prompts.map((prompt) => ({
    key: prompt.key,
    value: parseParameterValue(values[prompt.id] ?? ""),
  }));
}
