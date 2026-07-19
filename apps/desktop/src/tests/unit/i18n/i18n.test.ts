import { describe, expect, it } from "vitest";
import {
  createTranslator,
  interpolate,
  normalizeLocale,
  splitTranslation,
  translate,
} from "@/i18n";

describe("i18n core", () => {
  it("normalizes supported locale tags", () => {
    expect(normalizeLocale("ja")).toBe("ja");
    expect(normalizeLocale("ja-JP")).toBe("ja");
    expect(normalizeLocale("ja_JP")).toBe("ja");
    expect(normalizeLocale("EN-us")).toBe("en");
    expect(normalizeLocale("日本語")).toBe("ja");
  });

  it("falls back to English for empty or unsupported locales", () => {
    expect(normalizeLocale(undefined)).toBe("en");
    expect(normalizeLocale("")).toBe("en");
    expect(normalizeLocale("fr-FR")).toBe("en");
    expect(translate("common.save", { locale: "fr-FR" })).toBe("Save");
  });

  it("interpolates values", () => {
    expect(interpolate("Hello {name}", { name: "Ada" })).toBe("Hello Ada");
    expect(interpolate("{count} rows returned", { count: 12 })).toBe(
      "12 rows returned",
    );
    expect(interpolate("Value: {value}", { value: null })).toBe("Value: ");
  });

  /**
   * Leaving an unmatched placeholder alone is a fallback, not a feature: a
   * caller that forgets a value ships a literal `{count}` to the user, and
   * several call sites did exactly that before anything checked.
   *
   * It stays non-throwing because strings that are not templates rely on it —
   * `settings.snippets.importPlaceholder` carries CodeMirror snippet syntax
   * (`${0}`) that has to reach the editor untouched. Mismatches are caught
   * statically instead, at the call site where the mistake actually is: see
   * translation-placeholders.test.ts.
   */
  it("leaves a placeholder it has no value for untouched", () => {
    expect(interpolate("Missing {name}")).toBe("Missing {name}");
    expect(interpolate("tab stop ${0} survives")).toBe(
      "tab stop ${0} survives",
    );
  });

  it("translates Japanese labels", () => {
    const translator = createTranslator("ja-JP");

    expect(translator.locale).toBe("ja");
    expect(translator.t("locale.ja")).toBe("日本語");
    expect(translator.t("common.save")).toBe("保存");
    expect(translator.t("common.search")).toBe("検索");
    expect(translator.t("query.run")).toBe("クエリを実行");
  });

  it("covers migrated workbench UI key families", () => {
    const translator = createTranslator("ja");

    expect(translator.t("commandPalette.placeholder")).toBe("コマンドを検索");
    expect(translator.t("git.confirm.discard.title")).toBe(
      "変更を破棄しますか？",
    );
    expect(
      translator.t("results.confirmDeleteRows.title", {
        count: 2,
        table: "orders",
      }),
    ).toBe("orders から 2 行を削除しますか？");
    expect(translator.t("rowDetail.mode.tree")).toBe("ツリー");
  });

  it("splits a template around a placeholder for JSX interpolation", () => {
    const { t } = createTranslator("en");

    expect(splitTranslation(t, "ai.generate.notCompiled", "flag")).toEqual([
      "AI generation is not compiled into this ",
      " build.",
    ]);
    // A template without the slot keeps the whole sentence readable.
    expect(splitTranslation(t, "common.save", "flag")).toEqual(["Save", ""]);
  });

  it("interpolates Japanese translations", () => {
    expect(
      translate("query.rowsReturned", {
        locale: "ja",
        values: { count: 3 },
      }),
    ).toBe("3 行を返しました");
    expect(
      translate("query.parameterMissing", {
        locale: "ja",
        values: { name: "limit" },
      }),
    ).toBe("limit の値が必要です");
  });
});
