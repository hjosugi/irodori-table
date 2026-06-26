import type {
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";

export type ResultEditTarget = {
  schema?: string;
  table: string;
  keyColumns: string[];
};

export type ResultEditTargetInput = {
  sql: string;
  metadata: DatabaseMetadata | null | undefined;
  resultColumns: readonly string[];
};

type ParsedSelectSource = {
  schema?: string;
  table: string;
  alias?: string;
  selectList: string;
};

const joinPattern = /\b(?:cross|full|inner|join|left|natural|outer|right)\b|,/i;

export function deriveResultEditTarget({
  sql,
  metadata,
  resultColumns,
}: ResultEditTargetInput): ResultEditTarget | null {
  if (
    !metadata ||
    resultColumns.length === 0 ||
    hasDuplicateColumns(resultColumns)
  ) {
    return null;
  }

  const source = parseSingleTableSelectSource(sql);
  if (!source || !selectListIsDirectTableProjection(source, resultColumns)) {
    return null;
  }

  const table = findTableMetadata(metadata, source);
  if (!table) {
    return null;
  }

  const keyColumns = editableKeyColumns(table, resultColumns);
  if (!keyColumns) {
    return null;
  }

  return {
    schema: source.schema,
    table: table.name,
    keyColumns,
  };
}

function parseSingleTableSelectSource(sql: string): ParsedSelectSource | null {
  const cleaned = stripSqlComments(sql)
    .trim()
    .replace(/;+\s*$/, "");
  if (!cleaned || !/^\s*select\b/i.test(cleaned)) {
    return null;
  }

  const fromIndex = findTopLevelKeyword(cleaned, "from", 0);
  if (fromIndex === -1) {
    return null;
  }

  const selectList = cleaned.slice(
    cleaned.search(/\bselect\b/i) + "select".length,
    fromIndex,
  );
  const afterFrom = cleaned.slice(fromIndex + "from".length).trimStart();
  if (!selectList.trim() || afterFrom.startsWith("(")) {
    return null;
  }

  const firstClauseIndex = findFirstTopLevelKeyword(afterFrom, [
    "where",
    "group",
    "having",
    "order",
    "limit",
    "offset",
    "fetch",
    "for",
    "union",
    "intersect",
    "except",
  ]);
  const sourceClause =
    firstClauseIndex === -1
      ? afterFrom.trim()
      : afterFrom.slice(0, firstClauseIndex).trim();
  if (!sourceClause || joinPattern.test(sourceClause)) {
    return null;
  }

  const tokens = readIdentifierTokens(sourceClause);
  if (!tokens || (tokens.rest && !isSimpleAlias(tokens.rest))) {
    return null;
  }

  const parts = tokens.identifier.split(".");
  if (
    parts.length === 0 ||
    parts.length > 2 ||
    parts.some((part) => part === "")
  ) {
    return null;
  }

  return {
    schema: parts.length === 2 ? parts[0] : undefined,
    table: parts[parts.length - 1],
    alias: tokens.rest ? stripIdentifierQuotes(tokens.rest.trim()) : undefined,
    selectList,
  };
}

function findTableMetadata(
  metadata: DatabaseMetadata,
  source: Pick<ParsedSelectSource, "schema" | "table">,
): DbObjectMetadata | null {
  const matches = metadata.schemas
    .flatMap((schema) => schema.objects)
    .filter(
      (object) =>
        object.kind === "table" &&
        eqId(object.name, source.table) &&
        (source.schema === undefined || eqId(object.schema, source.schema)),
    );
  return matches.length === 1 ? matches[0] : null;
}

function editableKeyColumns(
  table: DbObjectMetadata,
  resultColumns: readonly string[],
): string[] | null {
  const primaryKey = table.primaryKey ?? [];
  const candidates = [
    ...(primaryKey.length > 0 ? [primaryKey] : []),
    ...table.indexes
      .filter((index) => index.unique && index.columns.length > 0)
      .map((index) => index.columns),
  ];

  for (const candidate of candidates) {
    const mapped = candidate.map((key) => findResultColumn(resultColumns, key));
    if (mapped.every((column): column is string => column !== null)) {
      return mapped;
    }
  }
  return null;
}

function selectListIsDirectTableProjection(
  source: ParsedSelectSource,
  resultColumns: readonly string[],
): boolean {
  const items = splitTopLevelComma(source.selectList);
  if (items.length === 0) {
    return false;
  }

  if (
    items.length === 1 &&
    isStarProjection(items[0], source) &&
    resultColumns.every((column) => column.trim() !== "")
  ) {
    return true;
  }

  const projectedColumns = new Set<string>();
  for (const item of items) {
    const column = directProjectedColumn(item, source);
    if (!column || projectedColumns.has(normalizeId(column))) {
      return false;
    }
    projectedColumns.add(normalizeId(column));
  }
  return true;
}

function directProjectedColumn(
  item: string,
  source: ParsedSelectSource,
): string | null {
  const trimmed = item.trim();
  if (!trimmed || /\s/.test(trimmed) || /[*()+\-/%]|::/.test(trimmed)) {
    return null;
  }

  const parts = parseDottedIdentifier(trimmed);
  if (!parts || parts.length === 0 || parts.length > 2) {
    return null;
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const qualifier = parts[0];
  const allowedQualifiers = [source.alias, source.table].filter(
    (value): value is string => value !== undefined,
  );
  return allowedQualifiers.some((value) => eqId(value, qualifier))
    ? parts[1]
    : null;
}

function isStarProjection(item: string, source: ParsedSelectSource): boolean {
  const trimmed = item.trim();
  if (trimmed === "*") {
    return true;
  }
  const parts = parseDottedIdentifier(trimmed.replace(/\.\*$/, ""));
  if (!trimmed.endsWith(".*") || !parts || parts.length !== 1) {
    return false;
  }
  return [source.alias, source.table]
    .filter((value): value is string => value !== undefined)
    .some((value) => eqId(value, parts[0]));
}

function readIdentifierTokens(
  input: string,
): { identifier: string; rest: string } | null {
  let index = 0;
  const parts: string[] = [];
  while (index < input.length) {
    const read = readIdentifier(input, index);
    if (!read) {
      return null;
    }
    parts.push(read.value);
    index = read.end;
    while (/\s/.test(input[index] ?? "")) {
      index += 1;
    }
    if (input[index] !== ".") {
      break;
    }
    index += 1;
    while (/\s/.test(input[index] ?? "")) {
      index += 1;
    }
  }
  return { identifier: parts.join("."), rest: input.slice(index).trim() };
}

function parseDottedIdentifier(input: string): string[] | null {
  const tokens = readIdentifierTokens(input);
  return tokens && tokens.rest === "" ? tokens.identifier.split(".") : null;
}

function readIdentifier(
  input: string,
  start: number,
): { value: string; end: number } | null {
  const quote = input[start];
  if (quote === '"' || quote === "`" || quote === "[") {
    const close = quote === "[" ? "]" : quote;
    let index = start + 1;
    let value = "";
    while (index < input.length) {
      if (input[index] === close) {
        if (input[index + 1] === close) {
          value += close;
          index += 2;
          continue;
        }
        return { value, end: index + 1 };
      }
      value += input[index];
      index += 1;
    }
    return null;
  }

  const match = /^[A-Za-z_][\w$]*/.exec(input.slice(start));
  return match ? { value: match[0], end: start + match[0].length } : null;
}

function isSimpleAlias(input: string): boolean {
  return (
    /^[A-Za-z_][\w$]*$/.test(input) ||
    /^"([^"]|"")+"$/.test(input) ||
    /^`([^`]|``)+`$/.test(input)
  );
}

function stripIdentifierQuotes(input: string): string {
  const read = readIdentifier(input, 0);
  return read && read.end === input.length ? read.value : input;
}

function splitTopLevelComma(input: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote || (quote === "]" && char === "]")) {
        if (input[index + 1] === char) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`" || char === "[") {
      quote = char === "[" ? "]" : char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === 0) {
      parts.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts.filter((part) => part !== "");
}

function findFirstTopLevelKeyword(
  input: string,
  keywords: readonly string[],
): number {
  let found = -1;
  for (const keyword of keywords) {
    const index = findTopLevelKeyword(input, keyword, 0);
    if (index !== -1 && (found === -1 || index < found)) {
      found = index;
    }
  }
  return found;
}

function findTopLevelKeyword(
  input: string,
  keyword: string,
  start: number,
): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote || (quote === "]" && char === "]")) {
        if (input[index + 1] === char) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`" || char === "[") {
      quote = char === "[" ? "]" : char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (
      depth === 0 &&
      input.slice(index, index + keyword.length).toLowerCase() === keyword &&
      isWordBoundary(input[index - 1]) &&
      isWordBoundary(input[index + keyword.length])
    ) {
      return index;
    }
  }
  return -1;
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function findResultColumn(
  resultColumns: readonly string[],
  key: string,
): string | null {
  const matches = resultColumns.filter((column) => eqId(column, key));
  return matches.length === 1 ? matches[0] : null;
}

function hasDuplicateColumns(columns: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const column of columns) {
    const normalized = normalizeId(column);
    if (seen.has(normalized)) {
      return true;
    }
    seen.add(normalized);
  }
  return false;
}

function normalizeId(value: string): string {
  return value.toLowerCase();
}

function eqId(a: string, b: string): boolean {
  return normalizeId(a) === normalizeId(b);
}

function isWordBoundary(char: string | undefined): boolean {
  return char === undefined || !/[\w$]/.test(char);
}
