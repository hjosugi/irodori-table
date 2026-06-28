import { createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import SqlEditor, {
  type SqlEditorHandle,
} from "@/features/query-editor/SqlEditor";
import { lightTheme } from "@/theme";

function renderSqlEditor({
  value,
  vimMode = false,
  onChange = () => undefined,
}: {
  value: string;
  vimMode?: boolean;
  onChange?: (next: string) => void;
}) {
  const host = document.createElement("div");
  host.style.height = "320px";
  document.body.append(host);

  const editorRef = createRef<SqlEditorHandle>();
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      <SqlEditor
        ref={editorRef}
        value={value}
        onChange={onChange}
        engine="postgres"
        snippets={[]}
        theme={lightTheme}
        vimMode={vimMode}
        formatter="sql-formatter"
        linter="disabled"
      />,
    ),
  );

  return { host, root, editorRef };
}

async function waitForEditor(host: HTMLElement) {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const content = host.querySelector(".cm-content");
  expect(content).toBeInstanceOf(HTMLElement);
  return content as HTMLElement;
}

describe("SQL editor browser shortcuts", () => {
  it("keeps Mod+A as editor select-all when Vim mode is enabled", async () => {
    const sql = "select 1;\nselect 2;";
    const { host, root, editorRef } = renderSqlEditor({
      value: sql,
      vimMode: true,
    });
    const content = await waitForEditor(host);

    const event = new KeyboardEvent("keydown", {
      key: "a",
      code: "KeyA",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    content?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editorRef.current?.getSelection()).toEqual({
      from: 0,
      to: sql.length,
    });
    expect(editorRef.current?.getSelections()).toEqual([
      { from: 0, to: sql.length },
    ]);

    root.unmount();
    host.remove();
  });

  it("uses Ctrl+Shift+C and Ctrl+Shift+V for clipboard in Vim mode", async () => {
    const sql = "select alpha;";
    let changed = sql;
    const clipboard = {
      writeText: vi.fn(async () => undefined),
      readText: vi.fn(async () => " where beta = 1"),
    };
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
    const { host, root, editorRef } = renderSqlEditor({
      value: sql,
      vimMode: true,
      onChange: (next) => {
        changed = next;
      },
    });
    const content = await waitForEditor(host);

    editorRef.current?.revealRange({ from: 0, to: 6 });
    const copyEvent = new KeyboardEvent("keydown", {
      key: "C",
      code: "KeyC",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(copyEvent);

    expect(copyEvent.defaultPrevented).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith("select");

    editorRef.current?.revealRange({ from: sql.length, to: sql.length });
    const pasteEvent = new KeyboardEvent("keydown", {
      key: "V",
      code: "KeyV",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(pasteEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(changed).toBe("select alpha; where beta = 1");

    root.unmount();
    host.remove();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
  });

  it("inserts completion text at every cursor", async () => {
    const sql = "select 1;\nselect 2;";
    let changed = sql;
    const { host, root, editorRef } = renderSqlEditor({
      value: sql,
      onChange: (next) => {
        changed = next;
      },
    });
    const content = await waitForEditor(host);
    content.focus();

    const addCursor = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      code: "ArrowDown",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(addCursor);

    expect(addCursor.defaultPrevented).toBe(true);
    expect(editorRef.current?.getSelections()).toHaveLength(2);

    editorRef.current?.insertText("-- ");

    expect(changed).toBe("-- select 1;\n-- select 2;");

    root.unmount();
    host.remove();
  });

  it("transforms the line at every cursor", async () => {
    const sql = "select 1;\nselect 2;";
    let changed = sql;
    const { host, root, editorRef } = renderSqlEditor({
      value: sql,
      onChange: (next) => {
        changed = next;
      },
    });
    const content = await waitForEditor(host);
    content.focus();

    content.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        code: "ArrowDown",
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(editorRef.current?.getSelections()).toHaveLength(2);
    expect(editorRef.current?.transformSelection("uppercase")).toBe(true);
    expect(changed).toBe("SELECT 1;\nSELECT 2;");

    root.unmount();
    host.remove();
  });

  it("indents and outdents the current line through the editor handle", async () => {
    const sql = "select 1;";
    let changed = sql;
    const { host, root, editorRef } = renderSqlEditor({
      value: sql,
      onChange: (next) => {
        changed = next;
      },
    });
    await waitForEditor(host);

    editorRef.current?.revealRange({ from: 0, to: 0 });

    expect(editorRef.current?.indentSelection()).toBe(true);
    expect(changed).toMatch(/^\s+select 1;$/);

    expect(editorRef.current?.outdentSelection()).toBe(true);
    expect(changed).toBe(sql);

    root.unmount();
    host.remove();
  });

  it("reports empty format as a no-op instead of success", async () => {
    const { host, root, editorRef } = renderSqlEditor({ value: "   \n" });
    await waitForEditor(host);

    await expect(editorRef.current?.format()).resolves.toEqual({
      error: null,
      changed: false,
      skipped: "empty",
    });

    root.unmount();
    host.remove();
  });
});
