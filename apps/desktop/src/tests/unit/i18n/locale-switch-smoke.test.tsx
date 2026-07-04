import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/app/CommandPalette";
import { ErrorDetails } from "@/components/ErrorDetails";
import { usePreferencesStore } from "@/features/preferences";

let container: HTMLDivElement;
let root: Root;

function renderSmokeSurface() {
  flushSync(() =>
    root.render(
      <>
        <CommandPalette
          query=""
          commands={[]}
          keymap={{}}
          onQueryChange={vi.fn()}
          onRunCommand={vi.fn()}
          onClose={vi.fn()}
        />
        <ErrorDetails
          error={{
            kind: "timeout",
            message: "connect timed out after 30s",
            code: "ETIMEDOUT",
            retryable: true,
          }}
        />
      </>,
    ),
  );
}

beforeEach(() => {
  usePreferencesStore.setState({ locale: "en" });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  usePreferencesStore.setState({ locale: "en" });
});

describe("locale switch smoke", () => {
  it("walks shell and backend-error surfaces when switching to Japanese", () => {
    renderSmokeSurface();

    expect(
      container.querySelector<HTMLInputElement>(".palette-input")?.placeholder,
    ).toBe("Search commands");
    expect(container.textContent).toContain("No commands match");
    expect(container.textContent).toContain("Timed out");
    expect(container.textContent).toContain("Details");

    flushSync(() => {
      usePreferencesStore.getState().setLocale("ja");
    });

    expect(
      container.querySelector<HTMLInputElement>(".palette-input")?.placeholder,
    ).toBe("コマンドを検索");
    expect(container.textContent).toContain("一致するコマンドはありません");
    expect(container.textContent).toContain("タイムアウトしました");
    expect(container.textContent).toContain("詳細");
  });
});
