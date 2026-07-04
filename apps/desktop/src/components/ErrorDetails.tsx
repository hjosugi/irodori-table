import type { ReactNode } from "react";
import type { IrodoriErrorKind } from "@/generated/irodori-api";
import { isIrodoriError } from "@/core/errors";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator, type TranslationKey, type Translator } from "@/i18n";

const errorTitleKeys: Record<IrodoriErrorKind, TranslationKey> = {
  validation: "errors.kind.validation",
  unsupported: "errors.kind.unsupported",
  notFound: "errors.kind.notFound",
  connection: "errors.kind.connection",
  query: "errors.kind.query",
  metadata: "errors.kind.metadata",
  edit: "errors.kind.edit",
  timeout: "errors.kind.timeout",
  cancelled: "errors.kind.cancelled",
  transport: "errors.kind.transport",
  internal: "errors.kind.internal",
};

function rawDetails(error: unknown): string | null {
  if (isIrodoriError(error)) {
    return JSON.stringify(error, null, 2);
  }
  if (error instanceof Error) {
    return error.stack && error.stack !== error.message
      ? error.stack
      : error.message;
  }
  if (typeof error === "string") {
    return null;
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}

function displayError(
  error: unknown,
  t: Translator["t"],
): { title: string; summary?: string; raw?: string } {
  if (isIrodoriError(error)) {
    return {
      title: t(errorTitleKeys[error.kind]),
      summary: error.message,
      raw: rawDetails(error) ?? undefined,
    };
  }
  if (error instanceof Error) {
    return {
      title: error.message,
      raw: rawDetails(error) ?? undefined,
    };
  }
  if (typeof error === "string") {
    return { title: error };
  }
  return {
    title: t("errors.unknown"),
    raw: rawDetails(error) ?? undefined,
  };
}

export function ErrorDetails({
  error,
  className,
  icon,
  role = "alert",
}: {
  error: unknown;
  className?: string;
  icon?: ReactNode;
  role?: "alert" | "status";
}) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const display = displayError(error, t);
  const showRaw = display.raw && display.raw !== display.summary;

  return (
    <div className={className ?? "error-callout"} role={role}>
      {icon}
      <span className="error-callout-body">
        <strong className="error-callout-title">{display.title}</strong>
        {display.summary ? (
          <span className="error-callout-summary">{display.summary}</span>
        ) : null}
        {showRaw ? (
          <details className="error-callout-details">
            <summary>{t("errors.details")}</summary>
            <pre>{display.raw}</pre>
          </details>
        ) : null}
      </span>
    </div>
  );
}

export { displayError as formatErrorDetails };
