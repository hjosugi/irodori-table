import { describe, expect, it } from "vitest";
import { errorMessage, isIrodoriError } from "@/core/errors";

describe("errorMessage", () => {
  it("reads structured backend errors", () => {
    const error = {
      kind: "validation",
      message: "connection id is required",
      retryable: false,
    };

    expect(isIrodoriError(error)).toBe(true);
    expect(errorMessage(error)).toBe("connection id is required");
  });

  it("keeps native and string error messages", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain failure")).toBe("plain failure");
  });
});

// Tauri rejects with a plain IrodoriError object, not an Error instance — the
// Rust side returns IrodoriResult and the generated binding types it as
// { kind, message, retryable }. Nine call sites had inlined
// `e instanceof Error ? e.message : String(e)`, which takes the String branch
// on that object and renders "[object Object]" — so every extension install
// failure showed the user nothing but that.
describe("errorMessage against what the backend actually rejects with", () => {
  const rejected = {
    kind: "Internal",
    message: "extension install failed: checksum mismatch",
    retryable: false,
  };

  it("reads the message off a plain IrodoriError object", () => {
    expect(errorMessage(rejected)).toBe(
      "extension install failed: checksum mismatch",
    );
  });

  it("never renders the object placeholder", () => {
    expect(errorMessage(rejected)).not.toContain("[object Object]");
    expect(errorMessage({ kind: "Io", message: "", retryable: true })).not.toBe(
      "[object Object]",
    );
  });

  it("still handles Error, string and unknown", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(undefined)).toBeTypeOf("string");
  });
});
