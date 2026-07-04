import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiEngineStatus,
  aiGetProvider,
  aiSetProvider,
} from "@/generated/irodori-api";
import { ProviderPicker } from "@/features/ai/chat/ProviderPicker";
import { cloudProviderConsentStorageKey } from "@/features/ai/provider-disclosure";

vi.mock("@/generated/irodori-api", () => ({
  aiEngineStatus: vi.fn(),
  aiGetProvider: vi.fn(),
  aiSetProvider: vi.fn(),
}));

vi.mock("@/features/ai/chat/chat-bridge", () => ({
  aiDeleteLocalModel: vi.fn(),
  aiUnloadLocal: vi.fn(),
}));

const mockAiEngineStatus = vi.mocked(aiEngineStatus);
const mockAiGetProvider = vi.mocked(aiGetProvider);
const mockAiSetProvider = vi.mocked(aiSetProvider);

let container: HTMLDivElement;
let root: Root;
let localStorageStore: Record<string, string>;

beforeEach(() => {
  localStorageStore = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: vi.fn(() => {
        localStorageStore = {};
      }),
      getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
      removeItem: vi.fn((key: string) => {
        delete localStorageStore[key];
      }),
      setItem: vi.fn((key: string, value: string) => {
        localStorageStore[key] = value;
      }),
    },
  });
  window.localStorage.clear();
  mockAiEngineStatus.mockResolvedValue({
    compiled: true,
    modelPresent: true,
    modelFile: "model.gguf",
    modelPath: "/tmp/model.gguf",
    loaded: false,
  });
  mockAiGetProvider.mockResolvedValue({
    kind: "local",
    model: "",
    program: "",
    args: [],
  });
  mockAiSetProvider.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    flushSync(() => root.unmount());
  }
  container?.remove();
  vi.clearAllMocks();
});

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function renderPicker() {
  flushSync(() => root.render(<ProviderPicker />));
}

describe("ProviderPicker", () => {
  it("requires one-time disclosure before saving a cloud provider", async () => {
    renderPicker();
    await flushEffects();

    const presetSelect = container.querySelector<HTMLSelectElement>(
      ".aichat-provider-select select",
    );
    expect(presetSelect).not.toBeNull();

    flushSync(() => {
      presetSelect!.value = "openai";
      presetSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.textContent).toContain("Cloud provider disclosure");
    expect(container.textContent).toContain("api.openai.com");

    const saveButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Use this model");
    expect(saveButton?.disabled).toBe(true);

    const acceptButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "I understand");
    flushSync(() => acceptButton?.click());

    expect(window.localStorage.getItem(cloudProviderConsentStorageKey)).toBe(
      "accepted",
    );
    expect(saveButton?.disabled).toBe(false);

    flushSync(() => saveButton?.click());
    await flushEffects();

    expect(mockAiSetProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "openaiCompat",
        endpoint: "https://api.openai.com",
        model: "gpt-4o-mini",
      }),
    );
  });
});
