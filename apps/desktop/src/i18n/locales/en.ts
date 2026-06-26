export const en = {
  "app.name": "Irodori Table",
  "locale.en": "English",
  "locale.ja": "Japanese",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.copy": "Copy",
  "common.delete": "Delete",
  "common.save": "Save",
  "common.search": "Search",
  "query.run": "Run query",
  "query.rowsReturned": "{count} rows returned",
  "query.parameterMissing": "Value required for {name}",
  "errors.unknown": "Something went wrong",
} as const;

export type TranslationKey = keyof typeof en;
export type TranslationDictionary = Record<TranslationKey, string>;
