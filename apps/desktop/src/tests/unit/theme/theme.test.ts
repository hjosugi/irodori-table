import { describe, expect, it } from "vitest";
import {
  cssVariables,
  customThemeEntryFromJson,
  darkTheme,
  defaultThemeById,
  defaultThemeEntries,
  defaultThemeEntriesByKind,
  defaultThemeForKind,
  importThemeJson,
  importVsCodeTheme,
  irodoriThemeFromJson,
  lightTheme,
  themes,
  upsertCustomThemeEntry,
  vscodeThemeFromIrodoriTheme,
} from "@/theme";

function relativeLuminance(color: string) {
  const values = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(color.slice(1 + offset, 3 + offset), 16);
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string) {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe("theme model", () => {
  it("exposes distinct light and dark themes", () => {
    expect(lightTheme.kind).toBe("light");
    expect(darkTheme.kind).toBe("dark");
    expect(lightTheme.ui.surface).not.toBe(darkTheme.ui.surface);
    expect(lightTheme.syntax.keyword).not.toBe(darkTheme.syntax.keyword);
    expect(themes.light).toBe(lightTheme);
    expect(themes.dark).toBe(darkTheme);
  });

  it("loads curated default themes from JSON", () => {
    expect(defaultThemeEntries).toHaveLength(44);
    expect(defaultThemeEntriesByKind.dark).toHaveLength(22);
    expect(defaultThemeEntriesByKind.light).toHaveLength(22);
    expect(new Set(defaultThemeEntries.map((theme) => theme.id)).size).toBe(
      defaultThemeEntries.length,
    );

    for (const entry of defaultThemeEntries) {
      expect(entry.name).toBe(entry.theme.name);
      expect(entry.kind).toBe(entry.theme.kind);
      expect(entry.inspiredBy.length).toBeGreaterThan(0);
      expect(entry.licenseNote).toContain("Original Irodori palette");
      expect(
        contrastRatio(entry.theme.ui.text, entry.theme.ui.editorBg),
      ).toBeGreaterThanOrEqual(7);
      expect(
        contrastRatio(entry.theme.syntax.comment, entry.theme.ui.editorBg),
      ).toBeGreaterThanOrEqual(3.5);
    }
  });

  it("resolves default themes by id and kind", () => {
    const darkEntry = defaultThemeEntriesByKind.dark[0];
    const lightEntry = defaultThemeEntriesByKind.light[0];
    expect(defaultThemeById(darkEntry.id)).toBe(darkEntry);
    expect(defaultThemeForKind("dark", darkEntry.id)).toBe(darkEntry.theme);
    expect(defaultThemeForKind("dark", lightEntry.id)).toBe(darkEntry.theme);
  });

  it("can project Irodori themes into a VS Code color theme shape", () => {
    const entry = defaultThemeEntries[0];
    const vscode = vscodeThemeFromIrodoriTheme(entry.theme);
    expect(vscode.$schema).toBe("vscode://schemas/color-theme");
    expect(vscode.name).toBe(entry.name);
    expect(vscode.type).toBe(entry.kind);
    expect(vscode.colors["editor.background"]).toBe(entry.theme.ui.editorBg);
    expect(vscode.colors["editor.foreground"]).toBe(entry.theme.ui.text);
    expect(
      vscode.tokenColors.some((rule) =>
        Array.isArray(rule.scope)
          ? rule.scope.includes("keyword")
          : rule.scope === "keyword",
      ),
    ).toBe(true);
    expect(vscode.tokenColors.some((rule) => rule.name === "Comments")).toBe(
      true,
    );
    expect(vscode.semanticTokenColors.keyword).toBe(entry.theme.syntax.keyword);
  });

  it("maps ui colors onto shell CSS custom properties", () => {
    const vars = cssVariables(darkTheme);
    expect(vars["--surface"]).toBe(darkTheme.ui.surface);
    expect(vars["--text"]).toBe(darkTheme.ui.text);
    expect(vars["--border"]).toBe(darkTheme.ui.border);
    expect(vars["--editor-bg"]).toBe(darkTheme.ui.editorBg);
    expect(vars["--gutter-bg"]).toBe(darkTheme.ui.gutterBg);
    expect(vars["--selection"]).toBe(darkTheme.ui.selection);
    expect(Object.keys(vars).every((key) => key.startsWith("--"))).toBe(true);
  });

  it("round-trips complete Irodori custom theme JSON", () => {
    const source = {
      ...darkTheme,
      name: "Custom Dark",
      ui: {
        ...darkTheme.ui,
        editorBg: "#101418",
      },
    };
    const theme = irodoriThemeFromJson(source);
    expect(theme.name).toBe("Custom Dark");
    expect(theme.kind).toBe("dark");
    expect(theme.ui.editorBg).toBe("#101418");
    expect(theme.syntax.keyword).toBe(darkTheme.syntax.keyword);
  });

  it("converts VS Code JSON into a saved Irodori custom theme", () => {
    const imported = importThemeJson(
      {
        name: "Workbench Smoke",
        type: "dark",
        colors: {
          "editor.background": "#101418",
          "editor.foreground": "#d8dee9",
          focusBorder: "#4ea1ff",
        },
        tokenColors: [
          { scope: "keyword", settings: { foreground: "#82aaff" } },
        ],
      },
      "dark",
    );
    expect(imported.source).toBe("vscode");
    expect(imported.theme.name).toBe("Workbench Smoke");
    expect(imported.theme.ui.editorBg).toBe("#101418");
    expect(imported.theme.syntax.keyword).toBe("#82aaff");

    const saved = upsertCustomThemeEntry([], imported.theme);
    expect(saved.id).toBe("custom-workbench-smoke");
    expect(saved.entries[0].name).toBe("Workbench Smoke");

    const updated = upsertCustomThemeEntry(saved.entries, {
      ...imported.theme,
      ui: { ...imported.theme.ui, editorBg: "#111111" },
    });
    expect(updated.entries).toHaveLength(1);
    expect(updated.entries[0].theme.ui.editorBg).toBe("#111111");
  });

  it("loads custom theme entries from settings JSON shape", () => {
    const entry = customThemeEntryFromJson(
      {
        id: "night",
        name: "Night Work",
        theme: { ...darkTheme, name: "Original Name" },
      },
      0,
      [],
    );
    expect(entry.id).toBe("night");
    expect(entry.name).toBe("Night Work");
    expect(entry.theme.name).toBe("Night Work");
  });

  it("imports common VS Code workbench colors", () => {
    const result = importVsCodeTheme(
      {
        name: "Nebula SQL",
        type: "dark",
        colors: {
          "editor.background": "#10141a",
          "editor.foreground": "#d6deeb",
          "editor.selectionBackground": "#314f78",
          "editor.lineHighlightBackground": "#1b2430",
          "editorCursor.foreground": "#ffcc66",
          "editorGutter.background": "#10141a",
          "editorLineNumber.foreground": "#63788a",
          "sideBar.background": "#151922",
          "sideBar.border": "#2c3340",
          "sideBarSectionHeader.background": "#1a2030",
          "panel.background": "#181d27",
          "titleBar.activeBackground": "#0c1016",
          focusBorder: "#82aaff",
          "input.background": "#1b2230",
          "list.hoverBackground": "#202a38",
          "list.activeSelectionBackground": "#263b54",
          "charts.green": "#addb67",
          "charts.red": "#ff5370",
          "charts.yellow": "#ffcb6b",
          "charts.blue": "#82aaff",
          "charts.purple": "#c792ea",
          "notebook.cellBorderColor": "#ff00ff",
        },
      },
      { licenseNote: "Sample theme is available under a compatible license." },
    );

    expect(result.theme.name).toBe("Nebula SQL");
    expect(result.theme.kind).toBe("dark");
    expect(result.licenseNote).toContain("compatible license");
    expect(result.theme.ui.editorBg).toBe("#10141a");
    expect(result.theme.ui.text).toBe("#d6deeb");
    expect(result.theme.syntax.name).toBe("#d6deeb");
    expect(result.theme.ui.selection).toBe("#314f78");
    expect(result.theme.ui.activeLine).toBe("#1b2430");
    expect(result.theme.ui.caret).toBe("#ffcc66");
    expect(result.theme.ui.gutterBg).toBe("#10141a");
    expect(result.theme.ui.gutterText).toBe("#63788a");
    expect(result.theme.ui.surface).toBe("#151922");
    expect(result.theme.ui.border).toBe("#2c3340");
    expect(result.theme.ui.surfaceMuted).toBe("#1a2030");
    expect(result.theme.ui.surfaceRaised).toBe("#181d27");
    expect(result.theme.ui.chrome).toBe("#0c1016");
    expect(result.theme.ui.focus).toBe("#82aaff");
    expect(result.theme.ui.inputBg).toBe("#1b2230");
    expect(result.theme.ui.hover).toBe("#202a38");
    expect(result.theme.ui.selectedStrong).toBe("#263b54");
    expect(result.theme.ui.green).toBe("#addb67");
    expect(result.theme.ui.red).toBe("#ff5370");
    expect(result.theme.ui.amber).toBe("#ffcb6b");
    expect(result.theme.ui.blue).toBe("#82aaff");
    expect(result.theme.ui.purple).toBe("#c792ea");
    expect(result.unsupported.colors).toContain("notebook.cellBorderColor");
    expect(
      result.warnings.some((warning) =>
        warning.includes("unsupported workbench"),
      ),
    ).toBe(true);
  });

  it("imports VS Code TextMate and semantic token colors", () => {
    const result = importVsCodeTheme({
      name: "Token Sample",
      type: "dark",
      tokenColors: [
        {
          name: "Comments",
          scope: ["comment", "punctuation.definition.comment"],
          settings: { foreground: "#637777", fontStyle: "italic" },
        },
        {
          name: "Strings",
          scope: "string, constant.other.symbol",
          settings: { foreground: "#c3e88d" },
        },
        {
          name: "Numbers",
          scope: "constant.numeric",
          settings: { foreground: "#f78c6c" },
        },
        {
          name: "Keywords",
          scope: ["keyword", "storage.modifier"],
          settings: { foreground: "#c792ea" },
        },
        {
          name: "Types",
          scope: ["entity.name.type", "support.type", "storage.type"],
          settings: { foreground: "#ffcb6b" },
        },
        {
          name: "Functions",
          scope: ["entity.name.function", "support.function"],
          settings: { foreground: "#82aaff" },
        },
        {
          name: "Properties",
          scope: ["variable.other.property", "support.variable.property"],
          settings: { foreground: "#addb67" },
        },
        {
          name: "Operators",
          scope: "keyword.operator",
          settings: { foreground: "#89ddff" },
        },
        {
          name: "Punctuation",
          scope: ["punctuation.separator", "punctuation.terminator"],
          settings: { foreground: "#89ddff" },
        },
        {
          name: "Brackets",
          scope: "punctuation.section.braces",
          settings: { foreground: "#ffcc66" },
        },
        {
          name: "Unsupported",
          scope: "markup.heading",
          settings: { foreground: "#ffffff" },
        },
        {
          name: "Broken",
          scope: "string.regexp",
          settings: { foreground: "blue" },
        },
      ],
      semanticTokenColors: {
        "variable.readonly": "#eeffff",
        method: { foreground: "#80cbc4" },
        "type.defaultLibrary": "#ffcb6b",
        boolean: "#ff5370",
        unknownTokenType: "#ffffff",
      },
    });

    expect(result.theme.syntax.comment).toBe("#637777");
    expect(result.theme.syntax.string).toBe("#c3e88d");
    expect(result.theme.syntax.number).toBe("#f78c6c");
    expect(result.theme.syntax.keyword).toBe("#c792ea");
    expect(result.theme.syntax.type).toBe("#ffcb6b");
    expect(result.theme.syntax.function).toBe("#80cbc4");
    expect(result.theme.syntax.property).toBe("#addb67");
    expect(result.theme.syntax.operator).toBe("#89ddff");
    expect(result.theme.syntax.punctuation).toBe("#89ddff");
    expect(result.theme.syntax.bracket).toBe("#ffcc66");
    expect(result.theme.syntax.name).toBe("#eeffff");
    expect(result.theme.syntax.bool).toBe("#ff5370");
    expect(result.unsupported.tokenScopes).toContain("markup.heading");
    expect(result.unsupported.semanticTokenColors).toContain(
      "unknownTokenType",
    );
    expect(
      result.warnings.some((warning) => warning.includes("Broken foreground")),
    ).toBe(true);
  });

  it("degrades gracefully for partial or malformed VS Code theme input", () => {
    const invalid = importVsCodeTheme(null, {
      fallbackTheme: lightTheme,
      name: "Fallback Import",
    });
    expect(invalid.theme.name).toBe("Fallback Import");
    expect(invalid.theme.kind).toBe("light");
    expect(invalid.theme.ui.editorBg).toBe(lightTheme.ui.editorBg);
    expect(invalid.warnings).toContain(
      "Theme import expected a JSON object; using fallback theme.",
    );

    const partial = importVsCodeTheme({
      name: "Partial Light",
      type: "light",
      license: "Apache-2.0",
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "black",
      },
      tokenColors: { scope: "keyword" },
      semanticTokenColors: { keyword: { foreground: "#005cc5" } },
    });
    expect(partial.theme.kind).toBe("light");
    expect(partial.theme.ui.editorBg).toBe("#ffffff");
    expect(partial.theme.ui.text).toBe(lightTheme.ui.text);
    expect(partial.theme.syntax.keyword).toBe("#005cc5");
    expect(partial.licenseNote).toContain("Apache-2.0");
    expect(partial.warnings).toEqual(
      expect.arrayContaining([
        'Ignored VS Code workbench color "editor.foreground" because it is not a supported hex color.',
        "Ignored VS Code tokenColors because it is not an array.",
      ]),
    );
  });
});
