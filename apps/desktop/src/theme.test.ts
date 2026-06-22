import { describe, expect, it } from "vitest";
import { cssVariables, darkTheme, lightTheme, themes } from "./theme";

describe("theme model", () => {
  it("exposes distinct light and dark themes", () => {
    expect(lightTheme.kind).toBe("light");
    expect(darkTheme.kind).toBe("dark");
    expect(lightTheme.ui.surface).not.toBe(darkTheme.ui.surface);
    expect(lightTheme.syntax.keyword).not.toBe(darkTheme.syntax.keyword);
    expect(themes.light).toBe(lightTheme);
    expect(themes.dark).toBe(darkTheme);
  });

  it("maps ui colors onto shell CSS custom properties", () => {
    const vars = cssVariables(darkTheme);
    expect(vars["--surface"]).toBe(darkTheme.ui.surface);
    expect(vars["--text"]).toBe(darkTheme.ui.text);
    expect(vars["--border"]).toBe(darkTheme.ui.border);
    expect(vars["--editor-bg"]).toBe(darkTheme.ui.editorBg);
    expect(Object.keys(vars).every((key) => key.startsWith("--"))).toBe(true);
  });
});
