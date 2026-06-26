import { describe, expect, it } from "vitest";
import { errorMessage, isIrodoriError } from "@/errors";

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
