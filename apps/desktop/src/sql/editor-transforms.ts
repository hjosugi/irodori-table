export type SqlEditorTransformAction =
  | "uppercase"
  | "lowercase"
  | "unformat"
  | "appendCommas"
  | "doubleToSingleQuotes";

export function transformSqlEditorText(
  text: string,
  action: SqlEditorTransformAction,
): string {
  switch (action) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "unformat":
      return unformatSqlToOneLine(text);
    case "appendCommas":
      return appendCommasToLines(text);
    case "doubleToSingleQuotes":
      return text.replace(/"/g, "'");
  }
}

function unformatSqlToOneLine(text: string): string {
  let output = "";
  let pendingSpace = false;
  let index = 0;

  function append(value: string) {
    if (pendingSpace && output.length > 0) {
      output += " ";
    }
    output += value;
    pendingSpace = false;
  }

  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    if (/\s/.test(char)) {
      pendingSpace = true;
      index += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      const commentEnd = lineCommentEnd(text, index + 2);
      const comment = text.slice(index + 2, commentEnd).trim();
      append(`/*${comment ? ` ${comment} ` : ""}*/`);
      pendingSpace = true;
      index = skipLineBreak(text, commentEnd);
      continue;
    }

    if (char === "/" && next === "*") {
      const commentEnd = text.indexOf("*/", index + 2);
      const end = commentEnd === -1 ? text.length : commentEnd + 2;
      append(text.slice(index, end).replace(/\s+/g, " "));
      pendingSpace = true;
      index = end;
      continue;
    }

    if (char === "'" || char === "\"" || char === "`") {
      const quoted = readQuotedToken(text, index, char);
      append(quoted.value);
      index = quoted.end;
      continue;
    }

    if (char === "[") {
      const bracketed = readBracketedIdentifier(text, index);
      append(bracketed.value);
      index = bracketed.end;
      continue;
    }

    append(char);
    index += 1;
  }

  return output.trim();
}

function lineCommentEnd(text: string, start: number) {
  const newline = text.slice(start).search(/\r\n|\r|\n/);
  return newline === -1 ? text.length : start + newline;
}

function skipLineBreak(text: string, index: number) {
  if (text.startsWith("\r\n", index)) return index + 2;
  if (text[index] === "\r" || text[index] === "\n") return index + 1;
  return index;
}

function readQuotedToken(text: string, start: number, quote: string) {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === quote) {
      if (text[index + 1] === quote) {
        index += 2;
        continue;
      }
      index += 1;
      break;
    }
    index += 1;
  }
  return {
    value: text.slice(start, index),
    end: index,
  };
}

function readBracketedIdentifier(text: string, start: number) {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "]") {
      if (text[index + 1] === "]") {
        index += 2;
        continue;
      }
      index += 1;
      break;
    }
    index += 1;
  }
  return {
    value: text.slice(start, index),
    end: index,
  };
}

function appendCommasToLines(text: string): string {
  return text
    .split(/(\r\n|\n|\r)/)
    .map((part) => {
      if (part === "\n" || part === "\r" || part === "\r\n") {
        return part;
      }
      if (!part.trim() || part.trimEnd().endsWith(",")) {
        return part;
      }
      return part.replace(/(\s*)$/, ",$1");
    })
    .join("");
}
