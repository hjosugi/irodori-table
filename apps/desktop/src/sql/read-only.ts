import { dollarTagAt, statementDelimiters } from "./statements";

const writeKeywords = new Set([
  "alter",
  "analyze",
  "call",
  "comment",
  "copy",
  "create",
  "delete",
  "do",
  "drop",
  "exec",
  "execute",
  "grant",
  "insert",
  "load",
  "merge",
  "refresh",
  "reindex",
  "rename",
  "replace",
  "revoke",
  "truncate",
  "update",
  "upsert",
  "vacuum",
]);

export function sqlMayWrite(sql: string) {
  return splitSqlStatements(sql).some((statement) =>
    sqlWordTokens(statement).some((token) => writeKeywords.has(token)),
  );
}

function splitSqlStatements(sql: string) {
  const statements: string[] = [];
  let start = 0;
  for (const delimiter of statementDelimiters(sql)) {
    const statement = sql.slice(start, delimiter).trim();
    if (statement) {
      statements.push(statement);
    }
    start = delimiter + 1;
  }
  const tail = sql.slice(start).trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
}

function sqlWordTokens(sql: string) {
  const tokens: string[] = [];
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (char === "-" && next === "-") {
      index = skipLineComment(sql, index + 2);
      continue;
    }
    if (char === "/" && next === "*") {
      index = skipBlockComment(sql, index + 2);
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      index = skipQuoted(sql, index + 1, char);
      continue;
    }
    if (char === "$") {
      const tag = dollarTagAt(sql, index);
      if (tag) {
        index = skipDollarQuoted(sql, index + tag.length, tag);
        continue;
      }
    }
    if (isIdentifierStart(char)) {
      const start = index;
      while (isIdentifierPart(sql[index + 1])) {
        index += 1;
      }
      tokens.push(sql.slice(start, index + 1).toLowerCase());
    }
  }
  return tokens;
}

function skipLineComment(sql: string, index: number) {
  const newline = sql.indexOf("\n", index);
  return newline === -1 ? sql.length : newline;
}

function skipBlockComment(sql: string, index: number) {
  const end = sql.indexOf("*/", index);
  return end === -1 ? sql.length : end + 1;
}

function skipQuoted(sql: string, index: number, quote: string) {
  for (; index < sql.length; index += 1) {
    if (sql[index] === "\\" && quote === "'" && sql[index + 1] !== undefined) {
      index += 1;
    } else if (sql[index] === quote && sql[index + 1] === quote) {
      index += 1;
    } else if (sql[index] === quote) {
      return index;
    }
  }
  return sql.length;
}

function skipDollarQuoted(sql: string, index: number, tag: string) {
  const end = sql.indexOf(tag, index);
  return end === -1 ? sql.length : end + tag.length - 1;
}

function isIdentifierStart(char: string | undefined) {
  return Boolean(char && /[A-Za-z_]/.test(char));
}

function isIdentifierPart(char: string | undefined) {
  return Boolean(char && /[A-Za-z0-9_$]/.test(char));
}
