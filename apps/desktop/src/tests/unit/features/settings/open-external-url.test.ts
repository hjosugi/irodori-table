import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openExternalUrl } from "@/features/settings/tabs/shared";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}));

const mockOpenUrl = vi.mocked(openUrl);

let windowOpen: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  windowOpen = vi
    .spyOn(window, "open")
    .mockImplementation(() => null) as ReturnType<typeof vi.spyOn>;
});

afterEach(() => {
  windowOpen.mockRestore();
  vi.clearAllMocks();
});

describe("openExternalUrl", () => {
  it("routes through the opener plugin, not window.open", async () => {
    mockOpenUrl.mockResolvedValue(undefined);

    await openExternalUrl("https://example.com/docs");

    expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com/docs");
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("falls back to window.open when the Tauri runtime is absent", async () => {
    mockOpenUrl.mockRejectedValue(new Error("no tauri runtime"));

    await openExternalUrl("https://example.com/docs");

    expect(windowOpen).toHaveBeenCalledWith(
      "https://example.com/docs",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
