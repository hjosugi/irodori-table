import type { IrodoriError } from "./generated/irodori-api";

export function isIrodoriError(value: unknown): value is IrodoriError {
  if (!value || typeof value !== "object") {
    return false;
  }
  const maybe = value as { kind?: unknown; message?: unknown };
  return typeof maybe.kind === "string" && typeof maybe.message === "string";
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
