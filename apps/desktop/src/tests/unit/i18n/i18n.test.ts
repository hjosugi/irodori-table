import { describe, expect, it } from "vitest";
import {
  createTranslator,
  interpolate,
  normalizeLocale,
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

  it("interpolates values and leaves missing placeholders intact", () => {
    expect(interpolate("Hello {name}", { name: "Ada" })).toBe("Hello Ada");
    expect(interpolate("{count} rows returned", { count: 12 })).toBe(
      "12 rows returned",
    );
    expect(interpolate("Missing {name}")).toBe("Missing {name}");
    expect(interpolate("Value: {value}", { value: null })).toBe("Value: ");
  });

  it("translates Japanese labels", () => {
    const translator = createTranslator("ja-JP");

    expect(translator.locale).toBe("ja");
    expect(translator.t("locale.ja")).toBe("日本語");
    expect(translator.t("common.save")).toBe("保存");
    expect(translator.t("common.search")).toBe("検索");
    expect(translator.t("query.run")).toBe("クエリを実行");
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
