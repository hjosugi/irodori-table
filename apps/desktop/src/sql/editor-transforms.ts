export type SqlEditorTransformAction =
  | "uppercase"
  | "lowercase"
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
    case "appendCommas":
      return appendCommasToLines(text);
    case "doubleToSingleQuotes":
      return text.replace(/"/g, "'");
  }
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
