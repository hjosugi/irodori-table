import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t, type Tag } from "@lezer/highlight";
import type { DbEngine } from "../generated/irodori-api";
import type { IrodoriSyntaxColors, SyntaxTokenRole } from "../theme";

type FontStyle = "italic";

interface LezerTokenRoleSpec {
  role: SyntaxTokenRole;
  tags: readonly Tag[];
  fontStyle?: FontStyle;
}

export const lezerTokenRoleSpecs: readonly LezerTokenRoleSpec[] = [
  { role: "keyword", tags: [t.keyword, t.operatorKeyword] },
  { role: "string", tags: [t.string, t.special(t.string)] },
  { role: "number", tags: [t.number] },
  {
    role: "comment",
    tags: [t.comment, t.lineComment, t.blockComment],
    fontStyle: "italic",
  },
  { role: "type", tags: [t.typeName, t.className] },
  { role: "property", tags: [t.propertyName] },
  { role: "name", tags: [t.name, t.variableName] },
  { role: "operator", tags: [t.operator] },
  {
    role: "function",
    tags: [t.function(t.variableName), t.function(t.propertyName)],
  },
  { role: "bracket", tags: [t.bracket, t.paren, t.brace, t.squareBracket] },
  { role: "punctuation", tags: [t.punctuation, t.separator] },
  { role: "bool", tags: [t.bool, t.null, t.atom] },
];

export const treeSitterCaptureTokenRoles: readonly {
  capture: string;
  role: SyntaxTokenRole;
}[] = [
  { capture: "keyword", role: "keyword" },
  { capture: "keyword.operator", role: "keyword" },
  { capture: "string", role: "string" },
  { capture: "string.special", role: "string" },
  { capture: "number", role: "number" },
  { capture: "float", role: "number" },
  { capture: "comment", role: "comment" },
  { capture: "type", role: "type" },
  { capture: "type.builtin", role: "type" },
  { capture: "property", role: "property" },
  { capture: "field", role: "property" },
  { capture: "variable", role: "name" },
  { capture: "identifier", role: "name" },
  { capture: "operator", role: "operator" },
  { capture: "function", role: "function" },
  { capture: "function.builtin", role: "function" },
  { capture: "punctuation.bracket", role: "bracket" },
  { capture: "punctuation.delimiter", role: "punctuation" },
  { capture: "punctuation.special", role: "punctuation" },
  { capture: "boolean", role: "bool" },
  { capture: "constant.builtin", role: "bool" },
];

export interface TreeSitterSqlGrammar {
  engine: DbEngine;
  name: string;
  license: string;
  wasmPath: string;
  highlightsQueryPath: string;
  solid: boolean;
}

export type SqlHighlightBackend =
  | {
      kind: "lezer";
      reason: string;
    }
  | {
      kind: "treeSitter";
      grammar: TreeSitterSqlGrammar;
    };

// No SQL grammar WASM is bundled yet. Registering a grammar here is the point at
// which the editor can enable Tree-sitter query captures for that dialect.
export const bundledTreeSitterSqlGrammars: readonly TreeSitterSqlGrammar[] = [];

export function tokenRoleForTreeSitterCapture(
  capture: string,
): SyntaxTokenRole | undefined {
  const normalized = capture.replace(/^@/, "");
  const exact = treeSitterCaptureTokenRoles.find(
    (mapping) => mapping.capture === normalized,
  );
  if (exact) {
    return exact.role;
  }
  const [base] = normalized.split(".");
  return treeSitterCaptureTokenRoles.find((mapping) => mapping.capture === base)
    ?.role;
}

export function sqlHighlightBackend(
  engine: DbEngine,
  grammars: readonly TreeSitterSqlGrammar[] = bundledTreeSitterSqlGrammars,
): SqlHighlightBackend {
  const grammar = grammars.find((candidate) => candidate.engine === engine);
  if (grammar?.solid) {
    return { kind: "treeSitter", grammar };
  }
  if (grammar && !grammar.solid) {
    return {
      kind: "lezer",
      reason: `${grammar.name} is registered but not marked solid for highlighting`,
    };
  }
  return {
    kind: "lezer",
    reason: `no bundled Tree-sitter SQL grammar for ${engine}`,
  };
}

function lezerHighlightStyle(syntax: IrodoriSyntaxColors): HighlightStyle {
  return HighlightStyle.define(
    lezerTokenRoleSpecs.map((spec) => ({
      tag: spec.tags.length === 1 ? spec.tags[0] : spec.tags,
      color: syntax[spec.role],
      ...(spec.fontStyle ? { fontStyle: spec.fontStyle } : {}),
    })),
  );
}

export function sqlHighlightingExtensions(
  engine: DbEngine,
  syntax: IrodoriSyntaxColors,
): Extension {
  const backend = sqlHighlightBackend(engine);
  return syntaxHighlighting(lezerHighlightStyle(syntax), {
    fallback: backend.kind === "treeSitter",
  });
}
