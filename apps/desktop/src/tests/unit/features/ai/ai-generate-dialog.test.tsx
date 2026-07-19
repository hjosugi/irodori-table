import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiEngineStatus,
  aiGetProvider,
  type DbEngine,
} from "@/generated/irodori-api";
import { AiGenerateDialog } from "@/features/ai/AiGenerateDialog";

vi.mock("@/generated/irodori-api", () => ({
  aiEngineStatus: vi.fn(),
  aiGenerateSql: vi.fn(),
  aiGetProvider: vi.fn(),
  aiSetProvider: vi.fn(),
}));

const mockAiEngineStatus = vi.mocked(aiEngineStatus);
const mockAiGetProvider = vi.mocked(aiGetProvider);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mockAiEngineStatus.mockResolvedValue({
    compiled: false,
    modelPresent: false,
    modelFile: "",
    modelPath: "",
    loaded: false,
  });
  mockAiGetProvider.mockResolvedValue({
    kind: "local",
    model: "",
    program: "",
    args: [],
  });
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

describe("AiGenerateDialog", () => {
  it("renders the not-compiled notice as one readable sentence", async () => {
    flushSync(() =>
      root.render(
        <AiGenerateDialog
          open
          onClose={() => {}}
          connectionId="c1"
          engine={"postgres" as DbEngine}
          onInsert={() => {}}
          notify={() => {}}
        />,
      ),
    );
    await flushEffects();

    // Regression: the sentence was split across two locale keys and a <code>
    // element, and JSX whitespace trimming rendered it glued together as
    // "into this--features llamabuild.".
    expect(container.textContent).toContain(
      "AI generation is not compiled into this --features llama build.",
    );
  });
});
