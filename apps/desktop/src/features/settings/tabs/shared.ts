import type { Translator } from "../../../i18n";

export type TranslateFn = Translator["t"];

export type ValueUpdater<T> = T | ((current: T) => T);
export type BooleanUpdater = ValueUpdater<boolean>;

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function openExternalUrl(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}
