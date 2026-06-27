import type {
  ColumnMetadata,
  DatabaseMetadata,
  DbObjectMetadata,
} from "@/generated/irodori-api";
import { statementDelimiters } from "./statements";

type SqlTokenType = "word" | "dot" | "comma" | "open" | "close";

type SqlToken = {
  type: SqlTokenType;
  text: string;
  lower: string;
  from: number;
  to: number;
};

type ObjectEntry = {
  schema: string;
  name: string;
  object: DbObjectMetadata;
};

type RelationRef = {
  alias: string;
  object: DbObjectMetadata;
};

type SqlMetadataRange = {
  from: number;
  to: number;
};

export type SqlMetadataTarget =
  | {
      kind: "object";
      range: SqlMetadataRange;
      object: DbObjectMetadata;
    }
  | {
      kind: "column";
      range: SqlMetadataRange;
      object: DbObjectMetadata;
      column: ColumnMetadata;
    };

type MetadataIndex = {
  relations: ObjectEntry[];
  byName: Map<string, ObjectEntry[]>;
  byQualifiedName: Map<string, ObjectEntry>;
};

type QualifiedIdentifier = {
  parts: SqlToken[];
  activePartIndex: number;
  range: SqlMetadataRange;
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

const RESERVED_ALIAS_WORDS = new Set([
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
  "on",
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
  "join",
  "from",
  "select",
  "update",
  "insert",
  "delete",
]);

export function inspectSqlMetadataAt(
  doc: string,
  pos: number,
  metadata: DatabaseMetadata | undefined,
): SqlMetadataTarget | null {
  if (!metadata) {
    return null;
  }
  const index = buildMetadataIndex(metadata);
  if (index.relations.length === 0) {
    return null;
  }

  const statement = statementWindow(doc, pos);
  const tokens = tokenizeSql(doc.slice(statement.from, statement.to), statement.from);
  const identifier = qualifiedIdentifierAt(tokens, pos);
  if (!identifier) {
    return null;
  }

  const refs = relationRefs(tokens, index);
  return resolveQualifiedIdentifier(identifier, refs, index);
}

export function sqlMetadataTargetTitle(target: SqlMetadataTarget): string {
  if (target.kind === "column") {
    return `${qualifiedObjectName(target.object)}.${target.column.name}`;
  }
  return qualifiedObjectName(target.object);
}

export function sqlMetadataTargetSubtitle(target: SqlMetadataTarget): string {
  if (target.kind === "column") {
    const flags = [
      target.column.dataType,
      target.column.nullable ? "nullable" : "not null",
      target.object.primaryKey.includes(target.column.name) ? "primary key" : null,
      foreignKeyForColumn(target.object, target.column.name) ? "foreign key" : null,
    ].filter(Boolean);
    return flags.join(" · ");
  }

  const rowEstimate =
    target.object.rowEstimate === undefined
      ? null
      : `~${target.object.rowEstimate.toLocaleString()} rows`;
  return [target.object.kind, rowEstimate].filter(Boolean).join(" · ");
}

export function sqlObjectDefinitionPreview(object: DbObjectMetadata): string {
  const ddl = object.ddl?.trim();
  if (ddl) {
    return ddl;
  }

  const columns = object.columns.map(
    (column) => `  ${sqlColumnBaseDefinitionPreview(column)}`,
  );
  const primaryKey = object.primaryKey.length
    ? `  primary key (${object.primaryKey.map(quotePreviewIdentifier).join(", ")})`
    : null;
  const foreignKeys = object.foreignKeys.map((foreignKey) => {
    const columns = foreignKey.columns.map(quotePreviewIdentifier).join(", ");
    return `  foreign key (${columns}) references ${foreignKeyReferenceText(
      object,
      foreignKey,
    )}`;
  });
  const body = [...columns, primaryKey, ...foreignKeys]
    .filter(Boolean)
    .join(",\n");
  return `create ${object.kind} ${qualifiedObjectName(object)} (\n${body}\n);`;
}

export function sqlColumnDefinitionPreview(
  object: DbObjectMetadata,
  column: ColumnMetadata,
): string {
  const foreignKey = foreignKeyForColumn(object, column.name);
  const parts = [
    quotePreviewIdentifier(column.name),
    column.dataType || "unknown",
    column.nullable ? null : "not null",
    column.defaultValue ? `default ${column.defaultValue}` : null,
    object.primaryKey.some((name) => eqId(name, column.name))
      ? "primary key"
      : null,
    foreignKey
      ? `references ${foreignKeyReferenceText(object, foreignKey)}`
      : null,
  ].filter(Boolean);
  return parts.join(" ");
}

function sqlColumnBaseDefinitionPreview(column: ColumnMetadata): string {
  const parts = [
    quotePreviewIdentifier(column.name),
    column.dataType || "unknown",
    column.nullable ? null : "not null",
    column.defaultValue ? `default ${column.defaultValue}` : null,
  ].filter(Boolean);
  return parts.join(" ");
}

export function sqlObjectColumnDefinitionRows(
  object: DbObjectMetadata,
  limit = 8,
): string[] {
  const rows = object.columns
    .slice()
    .sort((left, right) => left.ordinal - right.ordinal)
    .slice(0, limit)
    .map((column) => sqlColumnDefinitionPreview(object, column));
  if (object.columns.length > limit) {
    rows.push(`... ${object.columns.length - limit} more column(s)`);
  }
  return rows;
}

export function sqlColumnSampleValues(
  object: DbObjectMetadata,
  column: ColumnMetadata,
  limit = 3,
): string[] {
  const sample = object.sample;
  if (!sample) {
    return [];
  }
  const columnIndex = sample.columns.findIndex((name) => eqId(name, column.name));
  if (columnIndex < 0) {
    return [];
  }
  return sample.rows
    .map((row) => row[columnIndex])
    .filter((value): value is string => value !== undefined && value !== "")
    .slice(0, limit);
}

export function sqlObjectSampleRows(
  object: DbObjectMetadata,
  limit = 3,
): string[][] {
  return object.sample?.rows.slice(0, limit) ?? [];
}

function buildMetadataIndex(metadata: DatabaseMetadata): MetadataIndex {
  const relations = metadata.schemas.flatMap((schema) =>
    schema.objects
      .filter((object) => object.kind === "table" || object.kind === "view")
      .map((object) => ({
        schema: schema.name,
        name: object.name,
        object,
      })),
  );
  const byName = new Map<string, ObjectEntry[]>();
  const byQualifiedName = new Map<string, ObjectEntry>();
  for (const relation of relations) {
    pushMap(byName, relation.name.toLowerCase(), relation);
    byQualifiedName.set(qualifiedKey(relation.schema, relation.name), relation);
  }
  return { relations, byName, byQualifiedName };
}

function statementWindow(doc: string, pos: number): SqlMetadataRange {
  const delimiters = statementDelimiters(doc);
  let previous: number | undefined;
  for (const delimiter of delimiters) {
    if (delimiter >= pos) {
      break;
    }
    previous = delimiter;
  }
  const next = delimiters.find((delimiter) => delimiter >= pos);
  return {
    from: previous === undefined ? 0 : previous + 1,
    to: next === undefined ? doc.length : next,
  };
}

function tokenizeSql(sql: string, offset = 0): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "-" && next === "-") {
      index = skipLineComment(sql, index + 2);
      continue;
    }
    if (char === "/" && next === "*") {
      index = skipBlockComment(sql, index + 2);
      continue;
    }
    if (char === "'") {
      index = skipQuoted(sql, index, "'", "'");
      continue;
    }
    if (char === '"') {
      const end = skipQuoted(sql, index, '"', '"');
      const text = sql.slice(index + 1, end - 1).split('""').join('"');
      pushWord(tokens, text, offset + index, offset + end);
      index = end;
      continue;
    }
    if (char === "`") {
      const end = skipQuoted(sql, index, "`", "`");
      const text = sql.slice(index + 1, end - 1).split("``").join("`");
      pushWord(tokens, text, offset + index, offset + end);
      index = end;
      continue;
    }
    if (char === "[") {
      const end = sql.indexOf("]", index + 1);
      const tokenEnd = end < 0 ? sql.length : end + 1;
      pushWord(
        tokens,
        sql.slice(index + 1, tokenEnd - 1),
        offset + index,
        offset + tokenEnd,
      );
      index = tokenEnd;
      continue;
    }
    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (index < sql.length && isIdentifierPart(sql[index])) {
        index += 1;
      }
      pushWord(tokens, sql.slice(start, index), offset + start, offset + index);
      continue;
    }
    if (char === ".") {
      tokens.push({
        type: "dot",
        text: char,
        lower: char,
        from: offset + index,
        to: offset + index + 1,
      });
    } else if (char === ",") {
      tokens.push({
        type: "comma",
        text: char,
        lower: char,
        from: offset + index,
        to: offset + index + 1,
      });
    } else if (char === "(") {
      tokens.push({
        type: "open",
        text: char,
        lower: char,
        from: offset + index,
        to: offset + index + 1,
      });
    } else if (char === ")") {
      tokens.push({
        type: "close",
        text: char,
        lower: char,
        from: offset + index,
        to: offset + index + 1,
      });
    }
    index += 1;
  }
  return tokens;
}

function skipLineComment(sql: string, index: number): number {
  const lineEnd = sql.indexOf("\n", index);
  return lineEnd < 0 ? sql.length : lineEnd + 1;
}

function skipBlockComment(sql: string, index: number): number {
  const blockEnd = sql.indexOf("*/", index);
  return blockEnd < 0 ? sql.length : blockEnd + 2;
}

function skipQuoted(
  sql: string,
  index: number,
  quote: string,
  escapedQuote: string,
): number {
  for (let cursor = index + 1; cursor < sql.length; cursor += 1) {
    if (sql[cursor] !== quote) {
      continue;
    }
    if (sql[cursor + 1] === escapedQuote) {
      cursor += 1;
      continue;
    }
    return cursor + 1;
  }
  return sql.length;
}

function pushWord(tokens: SqlToken[], text: string, from: number, to: number) {
  tokens.push({ type: "word", text, lower: text.toLowerCase(), from, to });
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function qualifiedIdentifierAt(
  tokens: readonly SqlToken[],
  pos: number,
): QualifiedIdentifier | null {
  const activeIndex = tokens.findIndex(
    (token) => token.type === "word" && pos >= token.from && pos <= token.to,
  );
  if (activeIndex < 0) {
    return null;
  }

  let first = activeIndex;
  while (
    first >= 2 &&
    tokens[first - 1]?.type === "dot" &&
    tokens[first - 2]?.type === "word"
  ) {
    first -= 2;
  }

  let last = activeIndex;
  while (
    last + 2 < tokens.length &&
    tokens[last + 1]?.type === "dot" &&
    tokens[last + 2]?.type === "word"
  ) {
    last += 2;
  }

  const parts = tokens
    .slice(first, last + 1)
    .filter((token) => token.type === "word");
  const activePartIndex = parts.findIndex(
    (token) => token.from === tokens[activeIndex].from,
  );
  return {
    parts,
    activePartIndex,
    range: {
      from: parts[0].from,
      to: parts[parts.length - 1].to,
    },
  };
}

function relationRefs(
  tokens: readonly SqlToken[],
  index: MetadataIndex,
): RelationRef[] {
  const refs: RelationRef[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== "word" || !RELATION_START_KEYWORDS.has(token.lower)) {
      continue;
    }
    const parsed = readRelation(tokens, i + 1, index);
    if (!parsed) {
      continue;
    }
    refs.push({ alias: parsed.object.name, object: parsed.object });
    if (parsed.alias && !eqId(parsed.alias, parsed.object.name)) {
      refs.push({ alias: parsed.alias, object: parsed.object });
    }
    i = parsed.nextIndex - 1;
  }
  return refs;
}

function readRelation(
  tokens: readonly SqlToken[],
  startIndex: number,
  index: MetadataIndex,
): { object: DbObjectMetadata; alias: string | null; nextIndex: number } | null {
  const relation = readRelationObject(tokens, startIndex, index);
  if (!relation) {
    return null;
  }

  let aliasIndex = relation.nextIndex;
  if (tokens[aliasIndex]?.lower === "as") {
    aliasIndex += 1;
  }
  const aliasToken = tokens[aliasIndex];
  const alias =
    aliasToken?.type === "word" && !RESERVED_ALIAS_WORDS.has(aliasToken.lower)
      ? aliasToken.text
      : null;
  return {
    object: relation.object,
    alias,
    nextIndex: alias ? aliasIndex + 1 : relation.nextIndex,
  };
}

function readRelationObject(
  tokens: readonly SqlToken[],
  startIndex: number,
  index: MetadataIndex,
): { object: DbObjectMetadata; nextIndex: number } | null {
  const first = tokens[startIndex];
  if (first?.type !== "word") {
    return null;
  }

  if (
    tokens[startIndex + 1]?.type === "dot" &&
    tokens[startIndex + 2]?.type === "word"
  ) {
    const qualified = lookupQualifiedObject(
      index,
      first.text,
      tokens[startIndex + 2].text,
    );
    if (qualified) {
      return { object: qualified, nextIndex: startIndex + 3 };
    }
  }

  const object = lookupUniqueObject(index, first.text);
  return object ? { object, nextIndex: startIndex + 1 } : null;
}

function resolveQualifiedIdentifier(
  identifier: QualifiedIdentifier,
  refs: readonly RelationRef[],
  index: MetadataIndex,
): SqlMetadataTarget | null {
  const parts = identifier.parts.map((part) => part.text);
  const activeIsLast = identifier.activePartIndex === parts.length - 1;

  if (parts.length >= 3) {
    const object = lookupQualifiedObject(
      index,
      parts[parts.length - 3],
      parts[parts.length - 2],
    );
    if (!object) {
      return null;
    }
    if (!activeIsLast) {
      return { kind: "object", range: identifier.range, object };
    }
    const column = lookupColumn(object, parts[parts.length - 1]);
    return column ? { kind: "column", range: identifier.range, object, column } : null;
  }

  if (parts.length === 2) {
    const [qualifier, name] = parts;
    const refObject = lookupRefObject(refs, qualifier);
    if (refObject) {
      if (!activeIsLast) {
        return { kind: "object", range: identifier.range, object: refObject };
      }
      const column = lookupColumn(refObject, name);
      return column
        ? { kind: "column", range: identifier.range, object: refObject, column }
        : null;
    }

    const qualified = lookupQualifiedObject(index, qualifier, name);
    if (qualified) {
      return { kind: "object", range: identifier.range, object: qualified };
    }

    const object = lookupUniqueObject(index, qualifier);
    const column = object ? lookupColumn(object, name) : null;
    return object && column
      ? { kind: "column", range: identifier.range, object, column }
      : null;
  }

  const name = parts[0];
  const refObject = lookupRefObject(refs, name);
  if (refObject) {
    return { kind: "object", range: identifier.range, object: refObject };
  }

  const object = lookupUniqueObject(index, name);
  if (object) {
    return { kind: "object", range: identifier.range, object };
  }

  const columnMatch = lookupUnqualifiedColumn(refs, name);
  return columnMatch
    ? {
        kind: "column",
        range: identifier.range,
        object: columnMatch.object,
        column: columnMatch.column,
      }
    : null;
}

function lookupRefObject(
  refs: readonly RelationRef[],
  alias: string,
): DbObjectMetadata | null {
  const matches = refs.filter((ref) => eqId(ref.alias, alias));
  const uniqueObjects = uniqueBy(matches.map((match) => match.object), qualifiedObjectName);
  return uniqueObjects.length === 1 ? uniqueObjects[0] : null;
}

function lookupUnqualifiedColumn(
  refs: readonly RelationRef[],
  name: string,
): { object: DbObjectMetadata; column: ColumnMetadata } | null {
  const matches = refs.flatMap((ref) => {
    const column = lookupColumn(ref.object, name);
    return column ? [{ object: ref.object, column }] : [];
  });
  const uniqueMatches = uniqueBy(
    matches,
    (match) => `${qualifiedObjectName(match.object)}.${match.column.name}`,
  );
  return uniqueMatches.length === 1 ? uniqueMatches[0] : null;
}

function lookupUniqueObject(
  index: MetadataIndex,
  name: string,
): DbObjectMetadata | null {
  const matches = index.byName.get(name.toLowerCase()) ?? [];
  return matches.length === 1 ? matches[0].object : null;
}

function lookupQualifiedObject(
  index: MetadataIndex,
  schema: string,
  name: string,
): DbObjectMetadata | null {
  return index.byQualifiedName.get(qualifiedKey(schema, name))?.object ?? null;
}

function lookupColumn(
  object: DbObjectMetadata,
  name: string,
): ColumnMetadata | null {
  return object.columns.find((column) => eqId(column.name, name)) ?? null;
}

function foreignKeyForColumn(object: DbObjectMetadata, columnName: string) {
  return object.foreignKeys.find((foreignKey) =>
    foreignKey.columns.some((column) => eqId(column, columnName)),
  );
}

function foreignKeyReferenceText(
  object: DbObjectMetadata,
  foreignKey: DbObjectMetadata["foreignKeys"][number],
): string {
  const schema = foreignKey.referencesSchema ?? object.schema;
  const table = `${schema}.${foreignKey.referencesTable}`;
  return `${table}(${foreignKey.referencesColumns.join(", ")})`;
}

function qualifiedObjectName(object: DbObjectMetadata): string {
  return `${object.schema}.${object.name}`;
}

function qualifiedKey(schema: string, name: string): string {
  return `${schema.toLowerCase()}.${name.toLowerCase()}`;
}

function quotePreviewIdentifier(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    ? value
    : `"${value.split('"').join('""')}"`;
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const current = map.get(key);
  if (current) {
    current.push(value);
  } else {
    map.set(key, [value]);
  }
}

function uniqueBy<T>(items: readonly T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = keyFor(item).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function eqId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
