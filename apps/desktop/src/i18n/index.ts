import { en, type TranslationDictionary, type TranslationKey } from "./locales/en";
import { ja } from "./locales/ja";

export { en } from "./locales/en";
export { ja } from "./locales/ja";
export type { TranslationDictionary, TranslationKey } from "./locales/en";

export const defaultLocale = "en";
export const supportedLocales = ["en", "ja"] as const;

export type SupportedLocale = (typeof supportedLocales)[number];
export type Locale = SupportedLocale;
export type LocaleInput = string | null | undefined;
export type InterpolationValue = string | number | boolean | null | undefined;
export type InterpolationValues = Record<string, InterpolationValue>;
export type TranslationDictionaries = Record<SupportedLocale, TranslationDictionary>;

export const dictionaries = {
  en,
  ja,
} satisfies TranslationDictionaries;

const localeAliases: Readonly<Record<string, SupportedLocale>> = {
  english: "en",
  japanese: "ja",
  nihongo: "ja",
  "日本語": "ja",
};

const supportedLocaleValues: readonly string[] = supportedLocales;

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return supportedLocaleValues.includes(locale);
}

function resolveSupportedLocale(locale: LocaleInput): SupportedLocale | null {
  if (!locale) {
    return null;
  }

  const normalized = locale.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) {
    return null;
  }

  if (isSupportedLocale(normalized)) {
    return normalized;
  }

  const alias = localeAliases[normalized];
  if (alias) {
    return alias;
  }

  const primaryLocale = normalized.split("-")[0];
  if (primaryLocale && isSupportedLocale(primaryLocale)) {
    return primaryLocale;
  }

  return null;
}

export function normalizeLocale(
  locale: LocaleInput,
  fallbackLocale: SupportedLocale = defaultLocale,
): SupportedLocale {
  const fallback = isSupportedLocale(fallbackLocale)
    ? fallbackLocale
    : defaultLocale;

  return resolveSupportedLocale(locale) ?? fallback;
}

function browserLocaleCandidates(): readonly LocaleInput[] {
  if (navigator.languages.length > 0) {
    return navigator.languages;
  }

  return navigator.language ? [navigator.language] : [];
}

export function detectBrowserLocale(
  candidates: readonly LocaleInput[] = browserLocaleCandidates(),
  fallbackLocale: SupportedLocale = defaultLocale,
): Locale {
  for (const candidate of candidates) {
    const locale = resolveSupportedLocale(candidate);
    if (locale) {
      return locale;
    }
  }

  return fallback;
}

export function interpolate(
  template: string,
  values: InterpolationValues = {},
): string {
  return template.replace(/\{\s*([A-Za-z0-9_.-]+)\s*\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      return match;
    }

    const value = values[key];
    return value == null ? "" : String(value);
  });
}

export interface TranslateOptions {
  locale?: LocaleInput;
  values?: InterpolationValues;
  fallbackLocale?: SupportedLocale;
}

export function translate(
  key: TranslationKey,
  options: TranslateOptions = {},
): string {
  const fallbackLocale = options.fallbackLocale ?? defaultLocale;
  const locale = normalizeLocale(options.locale, fallbackLocale);
  const template =
    dictionaries[locale][key] ??
    dictionaries[fallbackLocale][key] ??
    dictionaries[defaultLocale][key];

  return interpolate(template, options.values);
}

export interface Translator {
  locale: SupportedLocale;
  t: (key: TranslationKey, values?: InterpolationValues) => string;
}

export function createTranslator(
  locale: LocaleInput = defaultLocale,
  fallbackLocale: SupportedLocale = defaultLocale,
): Translator {
  const normalizedLocale = normalizeLocale(locale, fallbackLocale);

  return {
    locale: normalizedLocale,
    t: (key, values) =>
      translate(key, {
        locale: normalizedLocale,
        values,
        fallbackLocale,
      }),
  };
}
