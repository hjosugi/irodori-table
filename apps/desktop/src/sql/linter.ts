import type { Diagnostic } from "@codemirror/lint";
import type { DbEngine } from "../generated/irodori-api";
import { dollarTagAt } from "./statements";

export type SqlLinterId = "gentle" | "disabled";

export const linterOptions: Array<{ id: SqlLinterId; label: string }> = [
  { id: "gentle", label: "Gentle" },
  { id: "disabled", label: "Disabled" },
];

export function isSqlLinterId(value: string | null): value is SqlLinterId {
  return value === "gentle" || value === "disabled";
}

type ScannerMode = "normal" | "single" | "double" | "line" | "block" | "dollar";

interface SqlWordToken {
  from: number;
  to: number;
  text: string;
  depth: number;
}

interface SqlStatementRange {
  from: number;
  to: number;
}

interface SqlScanResult {
  diagnostics: Diagnostic[];
  tokens: SqlWordToken[];
  statements: SqlStatementRange[];
}

const SOURCE = "irodori-sql";
const MAX_DIAGNOSTICS = 24;

function diagnostic(
  sql: string,
  from: number,
  to: number,
  severity: Diagnostic["severity"],
  message: string,
): Diagnostic {
  const safeFrom = Math.max(0, Math.min(from, sql.length));
  const safeTo = Math.max(safeFrom, Math.min(to, sql.length));
  return {
    from: safeFrom,
    to: safeTo > safeFrom ? safeTo : Math.min(sql.length, safeFrom + 1),
    severity,
    source: SOURCE,
    message,
  };
}

function isIdentifierStart(char: string | undefined) {
  return Boolean(char && /[A-Za-z_]/.test(char));
}

function isIdentifierPart(char: string | undefined) {
  return Boolean(char && /[A-Za-z0-9_$]/.test(char));
}

function trimmedStatementRange(sql: string, from: number, to: number) {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(sql[start])) start += 1;
  while (end > start && /\s/.test(sql[end - 1])) end -= 1;
  return start < end ? { from: start, to: end } : null;
}

function scanSql(sql: string): SqlScanResult {
  const diagnostics: Diagnostic[] = [];
  const tokens: SqlWordToken[] = [];
  const statements: SqlStatementRange[] = [];
  const parens: number[] = [];
  let mode: ScannerMode = "normal";
  let modeStart = 0;
  let statementStart = 0;
  let dollarTag = "";

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (mode === "single") {
      if (char === "\\" && next !== undefined) {
        index += 1;
      } else if (char === "'" && next === "'") {
        index += 1;
      } else if (char === "'") {
        mode = "normal";
      }
      continue;
    }

    if (mode === "double") {
      if (char === '"' && next === '"') {
        index += 1;
      } else if (char === '"') {
        mode = "normal";
      }
      continue;
    }

    if (mode === "line") {
      if (char === "\n") {
        mode = "normal";
      }
      continue;
    }

    if (mode === "block") {
      if (char === "*" && next === "/") {
        mode = "normal";
        index += 1;
      }
      continue;
    }

    if (mode === "dollar") {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        mode = "normal";
      }
      continue;
    }

    if (char === "'") {
      mode = "single";
      modeStart = index;
      continue;
    }

    if (char === '"') {
      mode = "double";
      modeStart = index;
      continue;
    }

    if (char === "-" && next === "-") {
      mode = "line";
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      mode = "block";
      modeStart = index;
      index += 1;
      continue;
    }

    if (char === "$") {
      const tag = dollarTagAt(sql, index);
      if (tag) {
        mode = "dollar";
        modeStart = index;
        dollarTag = tag;
        index += tag.length - 1;
        continue;
      }
    }

    if (char === "(") {
      parens.push(index);
      continue;
    }

    if (char === ")") {
      if (parens.length === 0) {
        diagnostics.push(
          diagnostic(sql, index, index + 1, "error", "Unmatched closing parenthesis."),
        );
      } else {
        parens.pop();
      }
      continue;
    }

    if (char === ";") {
      const range = trimmedStatementRange(sql, statementStart, index + 1);
      if (range) {
        statements.push(range);
      }
      statementStart = index + 1;
      continue;
    }

    if (isIdentifierStart(char)) {
      const from = index;
      while (isIdentifierPart(sql[index + 1])) {
        index += 1;
      }
      tokens.push({
        from,
        to: index + 1,
        text: sql.slice(from, index + 1).toLowerCase(),
        depth: parens.length,
      });
    }
  }

  const tail = trimmedStatementRange(sql, statementStart, sql.length);
  if (tail) {
    statements.push(tail);
  }

  if (mode === "single") {
    diagnostics.push(
      diagnostic(sql, modeStart, sql.length, "error", "Unclosed string literal."),
    );
  } else if (mode === "double") {
    diagnostics.push(
      diagnostic(sql, modeStart, sql.length, "error", "Unclosed quoted identifier."),
    );
  } else if (mode === "block") {
    diagnostics.push(
      diagnostic(sql, modeStart, sql.length, "error", "Unclosed block comment."),
    );
  } else if (mode === "dollar") {
    diagnostics.push(
      diagnostic(sql, modeStart, sql.length, "error", `Unclosed dollar quote ${dollarTag}.`),
    );
  }

  for (const from of parens.slice(-MAX_DIAGNOSTICS)) {
    diagnostics.push(
      diagnostic(sql, from, from + 1, "error", "Unclosed opening parenthesis."),
    );
  }

  return {
    diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
    tokens,
    statements,
  };
}

function tokensInRange(tokens: SqlWordToken[], range: SqlStatementRange) {
  return tokens.filter((token) => token.from >= range.from && token.to <= range.to);
}

function firstActionToken(tokens: SqlWordToken[]) {
  const first = tokens[0]?.text;
  if (first !== "explain" && first !== "analyze") {
    return tokens[0];
  }
  return tokens[1];
}

function lintStatementRisk(
  sql: string,
  engine: DbEngine,
  range: SqlStatementRange,
  tokens: SqlWordToken[],
): Diagnostic[] {
  const action = firstActionToken(tokens);
  if (!action) {
    return [];
  }

  const hasWhere = tokens.some(
    (token) => token.text === "where" && token.depth === 0,
  );
  if ((action.text === "update" || action.text === "delete") && !hasWhere) {
    const verb = action.text.toUpperCase();
    return [
      diagnostic(
        sql,
        range.from,
        range.to,
        "warning",
        `${verb} without WHERE can affect every row. Add a WHERE clause or run intentionally.`,
      ),
    ];
  }

  if (action.text === "truncate" || action.text === "drop") {
    const verb = action.text.toUpperCase();
    const qualifier =
      engine === "sqlite" && action.text === "truncate"
        ? " SQLite does not support TRUNCATE."
        : "";
    return [
      diagnostic(
        sql,
        range.from,
        range.to,
        "warning",
        `${verb} is destructive.${qualifier} Run intentionally.`,
      ),
    ];
  }

  return [];
}

export function lintSqlDocument(sql: string, engine: DbEngine): Diagnostic[] {
  if (!sql.trim()) {
    return [];
  }

  const scan = scanSql(sql);
  const diagnostics = [...scan.diagnostics];
  for (const range of scan.statements) {
    if (diagnostics.length >= MAX_DIAGNOSTICS) {
      break;
    }
    diagnostics.push(
      ...lintStatementRisk(sql, engine, range, tokensInRange(scan.tokens, range)),
    );
  }

  return diagnostics.slice(0, MAX_DIAGNOSTICS);
}
