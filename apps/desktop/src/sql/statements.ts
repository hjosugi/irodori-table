// SQL statement boundary detection.
//
// Pure, dependency-free helpers shared by the editor and the run actions, kept
// out of App.tsx so they can be unit-tested. `statementDelimiters` is dialect-
// agnostic: it walks the text tracking single/double quotes, line/block comments,
// and dollar-quoted bodies so a `;` inside a string or comment is not treated as
// a statement boundary.

/** Return the dollar-quote tag (`$$` or `$tag$`) starting at `index`, if any. */
export function dollarTagAt(sql: string, index: number): string | undefined {
  const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
  return match?.[0];
}

/** Indices of top-level `;` statement separators (ignoring quotes/comments). */
export function statementDelimiters(sql: string): number[] {
  const delimiters: number[] = [];
  let quote: "normal" | "single" | "double" | "line" | "block" | "dollar" =
    "normal";
  let dollarTag = "";

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (quote === "single") {
      if (char === "'" && next === "'") {
        index += 1;
      } else if (char === "'") {
        quote = "normal";
      }
      continue;
    }

    if (quote === "double") {
      if (char === '"' && next === '"') {
        index += 1;
      } else if (char === '"') {
        quote = "normal";
      }
      continue;
    }

    if (quote === "line") {
      if (char === "\n") {
        quote = "normal";
      }
      continue;
    }

    if (quote === "block") {
      if (char === "*" && next === "/") {
        quote = "normal";
        index += 1;
      }
      continue;
    }

    if (quote === "dollar") {
      if (sql.startsWith(dollarTag, index)) {
        index += dollarTag.length - 1;
        quote = "normal";
      }
      continue;
    }

    if (char === "'") {
      quote = "single";
    } else if (char === '"') {
      quote = "double";
    } else if (char === "-" && next === "-") {
      quote = "line";
      index += 1;
    } else if (char === "/" && next === "*") {
      quote = "block";
      index += 1;
    } else if (char === "$") {
      const tag = dollarTagAt(sql, index);
      if (tag) {
        quote = "dollar";
        dollarTag = tag;
        index += tag.length - 1;
      }
    } else if (char === ";") {
      delimiters.push(index);
    }
  }

  return delimiters;
}

/**
 * The SQL to run: the trimmed selection if one exists, otherwise the single
 * statement under the caret (between the surrounding `;` boundaries), falling
 * back to the whole buffer.
 */
export function selectedOrCurrentStatement(
  selectionStart: number,
  selectionEnd: number,
  sql: string,
): string {
  const selectedSql = sql.slice(selectionStart, selectionEnd).trim();
  if (selectedSql) {
    return selectedSql;
  }

  const cursor = Math.min(selectionStart, sql.length);
  const delimiters = statementDelimiters(sql);
  let previous: number | undefined;
  for (const delimiter of delimiters) {
    if (delimiter >= cursor) {
      break;
    }
    previous = delimiter;
  }
  const next = delimiters.find((delimiter) => delimiter >= cursor);
  const start = previous === undefined ? 0 : previous + 1;
  const end = next === undefined ? sql.length : next + 1;
  const statement = sql.slice(start, end).trim();

  return statement || sql.trim();
}
