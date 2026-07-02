import type { IrodoriError } from "@/generated/irodori-api";

const errorTitles: Record<IrodoriError["kind"], string> = {
  validation: "Check the input",
  unsupported: "Not supported in this build",
  notFound: "Not found",
  connection: "Connection failed",
  query: "Query failed",
  metadata: "Could not load metadata",
  edit: "Could not apply the edit",
  timeout: "Timed out",
  cancelled: "Cancelled",
  transport: "Connection transport failed",
  internal: "Internal error",
};

export function isIrodoriError(value: unknown): value is IrodoriError {
  if (!value || typeof value !== "object") {
    return false;
  }
  const maybe = value as { kind?: unknown; message?: unknown };
  return typeof maybe.kind === "string" && typeof maybe.message === "string";
}

// Backend errors carry a `retryable` classification (connection drops,
// timeouts); surface it so the UI can offer a Retry affordance.
export function isRetryableError(error: unknown): boolean {
  return isIrodoriError(error) && error.retryable;
}

export function errorMessage(error: unknown): string {
  if (isIrodoriError(error)) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

export function errorDisplay(error: unknown): {
  title: string;
  detail?: string;
} {
  if (isIrodoriError(error)) {
    return { title: errorTitles[error.kind], detail: error.message };
  }
  return { title: errorMessage(error) };
}
