import { describe, expect, it } from "vitest";
import { detectMacPlatform } from "@/core/platform";

describe("detectMacPlatform", () => {
  it("prefers userAgentData.platform when present", () => {
    expect(detectMacPlatform({ userAgentData: { platform: "macOS" } })).toBe(
      true,
    );
    expect(
      detectMacPlatform({
        userAgentData: { platform: "Windows" },
        // A stale mac-looking legacy surface must not override the
        // standards-track answer.
        platform: "MacIntel",
      }),
    ).toBe(false);
  });

  it("falls back to navigator.platform", () => {
    expect(detectMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(detectMacPlatform({ platform: "iPhone" })).toBe(true);
    expect(detectMacPlatform({ platform: "Win32" })).toBe(false);
    expect(detectMacPlatform({ platform: "Linux x86_64" })).toBe(false);
  });

  it("falls back to the user agent when platform is empty", () => {
    // The spec allows navigator.platform to be "" — the case the old
    // platform-only detection silently got wrong (it reported non-mac and
    // flipped every Cmd binding to Ctrl).
    expect(
      detectMacPlatform({
        platform: "",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      }),
    ).toBe(true);
    expect(
      detectMacPlatform({
        platform: "",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      }),
    ).toBe(false);
  });

  it("reports non-mac without a navigator (SSR, workers)", () => {
    expect(detectMacPlatform(undefined)).toBe(false);
    expect(detectMacPlatform({})).toBe(false);
  });
});
