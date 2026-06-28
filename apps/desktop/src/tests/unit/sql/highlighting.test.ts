import { describe, expect, it } from "vitest";
import { lightTheme, type SyntaxTokenRole } from "@/theme";
import {
  lezerTokenRoleSpecs,
  sqlHighlightBackend,
  sqlHighlightingExtensions,
  tokenRoleForTreeSitterCapture,
  type TreeSitterSqlGrammar,
} from "@/sql/highlighting";

describe("SQL highlighting roles", () => {
  it("maps every internal syntax role to Lezer tags", () => {
    const modelRoles = Object.keys(lightTheme.syntax).sort();
    const lezerRoles = Array.from(
      new Set(lezerTokenRoleSpecs.map((spec) => spec.role)),
    ).sort();
    expect(lezerRoles).toEqual(modelRoles);
  });

  it("normalizes Tree-sitter captures into internal syntax roles", () => {
    const cases: Array<[string, SyntaxTokenRole | undefined]> = [
      ["@keyword.operator", "keyword"],
      ["string.special", "string"],
      ["@punctuation.bracket", "bracket"],
      ["function.builtin", "function"],
      ["@constant.builtin", "bool"],
      ["@unknown.capture", undefined],
    ];
    for (const [capture, role] of cases) {
      expect(tokenRoleForTreeSitterCapture(capture)).toBe(role);
    }
  });

  it("falls back to Lezer unless a bundled grammar is marked solid", () => {
    expect(sqlHighlightBackend("postgres")).toMatchObject({ kind: "lezer" });

    const grammar: TreeSitterSqlGrammar = {
      engine: "postgres",
      name: "tree-sitter-postgres",
      license: "BSD-3-Clause",
      wasmPath: "/grammars/tree-sitter-postgres.wasm",
      highlightsQueryPath: "/grammars/postgres/highlights.scm",
      solid: true,
    };
    expect(sqlHighlightBackend("postgres", [grammar])).toMatchObject({
      kind: "treeSitter",
      grammar,
    });

    expect(
      sqlHighlightBackend("postgres", [{ ...grammar, solid: false }]),
    ).toMatchObject({ kind: "lezer" });
  });

  it("creates a CodeMirror extension from theme syntax colors", () => {
    expect(
      sqlHighlightingExtensions("postgres", lightTheme.syntax),
    ).toBeTruthy();
  });
});
