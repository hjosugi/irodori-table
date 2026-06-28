import { useCallback, useEffect, useRef } from "react";
import { Bot, Copy, Database, Eraser, Plus, Send, Square, X } from "lucide-react";
import type { DbEngine } from "@/generated/irodori-api";
import {
  aiChat,
  aiChatCancel,
  newChatSessionId,
  type ChatEvent,
  type ChatMessageDto,
} from "./chat-bridge";
import { useAiChatStore, type ChatResultView } from "./ai-chat-store";
import { ProviderPicker } from "./ProviderPicker";
import "./ai-chat.css";

type Notify = (kind: "success" | "error", title: string, detail?: string) => void;

export type AiChatPanelProps = {
  activeConnectionId: string;
  activeConnectionName: string;
  activeConnectionOpen: boolean;
  engine: DbEngine;
  /** Insert a SQL snippet into the active editor. */
  onInsertSql: (sql: string) => void;
  onClose: () => void;
  notify?: Notify;
};

/** A segment of assistant text: prose or a fenced code block. */
type Segment = { kind: "text"; text: string } | { kind: "code"; text: string; lang: string };

function splitContent(content: string): Segment[] {
  const segments: Segment[] = [];
  let rest = content;
  while (true) {
    const open = rest.indexOf("```");
    if (open === -1) {
      if (rest) segments.push({ kind: "text", text: rest });
      break;
    }
    if (open > 0) segments.push({ kind: "text", text: rest.slice(0, open) });
    const afterOpen = rest.slice(open + 3);
    const close = afterOpen.indexOf("```");
    if (close === -1) {
      // Unterminated block (still streaming): show the remainder as code.
      const nl = afterOpen.indexOf("\n");
      const lang = nl === -1 ? "" : afterOpen.slice(0, nl).trim();
      const body = nl === -1 ? "" : afterOpen.slice(nl + 1);
      segments.push({ kind: "code", text: body, lang });
      break;
    }
    const block = afterOpen.slice(0, close);
    const nl = block.indexOf("\n");
    const lang = nl === -1 ? "" : block.slice(0, nl).trim();
    const body = nl === -1 ? block : block.slice(nl + 1);
    segments.push({ kind: "code", text: body.replace(/\n$/, ""), lang });
    rest = afterOpen.slice(close + 3);
  }
  return segments;
}

function isSqlLang(lang: string): boolean {
  return lang === "" || lang.toLowerCase() === "sql";
}

function ResultTable({ result }: { result: ChatResultView }) {
  const previewRows = result.rows.slice(0, 20);
  return (
    <div className="aichat-result">
      <div className="aichat-result-meta">
        {result.rowCount} rows · {result.elapsedMs} ms
        {result.truncated ? " · truncated" : ""}
      </div>
      <div className="aichat-result-scroll">
        <table>
          <thead>
            <tr>
              {result.columns.map((col, i) => (
                <th key={i}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>{cell === null ? "NULL" : String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.rows.length > previewRows.length ? (
        <div className="aichat-result-meta">
          showing {previewRows.length} of {result.rows.length} fetched rows
        </div>
      ) : null}
    </div>
  );
}

export function AiChatPanel({
  activeConnectionId,
  activeConnectionName,
  activeConnectionOpen,
  engine,
  onInsertSql,
  onClose,
  notify,
}: AiChatPanelProps) {
  const turns = useAiChatStore((s) => s.turns);
  const input = useAiChatStore((s) => s.input);
  const agentMode = useAiChatStore((s) => s.agentMode);
  const activeSessionId = useAiChatStore((s) => s.activeSessionId);
  const setInput = useAiChatStore((s) => s.setInput);
  const setAgentMode = useAiChatStore((s) => s.setAgentMode);
  const clear = useAiChatStore((s) => s.clear);

  const scrollRef = useRef<HTMLDivElement>(null);
  const streaming = activeSessionId !== null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  // Leaving the panel mid-stream must not leave a query running on the database.
  useEffect(() => {
    return () => {
      const sessionId = useAiChatStore.getState().activeSessionId;
      if (sessionId) void aiChatCancel(sessionId);
    };
  }, []);

  const send = useCallback(async () => {
    const store = useAiChatStore.getState();
    const text = store.input.trim();
    if (!text || store.activeSessionId) return;

    const history: ChatMessageDto[] = store.turns
      .filter((t) => t.content.trim().length > 0)
      .map((t) => ({ role: t.role, content: t.content }));
    history.push({ role: "user", content: text });

    store.pushUser(text);
    store.setInput("");

    const sessionId = newChatSessionId();
    const assistantId = `a-${sessionId}`;
    store.startAssistant(assistantId, sessionId);

    const connectionId = activeConnectionId || undefined;
    try {
      await aiChat(
        {
          sessionId,
          messages: history,
          connectionId,
          engine: connectionId ? engine : undefined,
          agentMode: agentMode && activeConnectionOpen,
        },
        (event: ChatEvent) => handleEvent(assistantId, event, notify),
      );
    } catch (err) {
      useAiChatStore.getState().addError(assistantId, String(err));
    } finally {
      useAiChatStore.getState().finishAssistant(assistantId);
    }
  }, [activeConnectionId, activeConnectionOpen, agentMode, engine, notify]);

  const stop = useCallback(() => {
    const sessionId = useAiChatStore.getState().activeSessionId;
    if (sessionId) void aiChatCancel(sessionId);
  }, []);

  return (
    <section className="aichat-panel" aria-label="AI Chat">
      <header className="aichat-header">
        <span className="aichat-title">
          <Bot size={14} /> AI Chat
        </span>
        <div className="aichat-header-actions">
          <button type="button" title="Clear conversation" aria-label="Clear" onClick={clear}>
            <Eraser size={13} />
          </button>
          <button type="button" title="Close" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="aichat-subbar">
        <span className="aichat-connection" title={activeConnectionName}>
          <Database size={12} />
          {activeConnectionOpen ? activeConnectionName : "No active connection"}
        </span>
        <label className="aichat-agent-toggle" title="Let the assistant run read-only SELECT queries to answer with real data">
          <input
            type="checkbox"
            checked={agentMode}
            onChange={(e) => setAgentMode(e.target.checked)}
          />
          Agent (run queries)
        </label>
      </div>

      <ProviderPicker notify={notify} />

      <div className="aichat-messages" ref={scrollRef}>
        {turns.length === 0 ? (
          <div className="aichat-empty">
            Ask about your data. With <strong>Agent</strong> on, the assistant runs read-only
            SELECT queries against the connected database and answers from the results.
          </div>
        ) : null}
        {turns.map((turn) => (
          <div key={turn.id} className={`aichat-turn aichat-${turn.role}`}>
            {turn.role === "assistant" ? (
              <div className="aichat-turn-content">
                {splitContent(turn.content).map((seg, i) =>
                  seg.kind === "text" ? (
                    seg.text.trim() ? (
                      <p key={i} className="aichat-text">
                        {seg.text}
                      </p>
                    ) : null
                  ) : (
                    <div key={i} className="aichat-code">
                      <pre>{seg.text}</pre>
                      <div className="aichat-code-actions">
                        {isSqlLang(seg.lang) ? (
                          <button
                            type="button"
                            onClick={() => onInsertSql(seg.text)}
                            title="Insert into editor"
                          >
                            <Plus size={12} /> Insert
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard?.writeText(seg.text)}
                          title="Copy"
                        >
                          <Copy size={12} /> Copy
                        </button>
                      </div>
                    </div>
                  ),
                )}
                {turn.steps.map((step, i) => (
                  <div key={`s-${i}`} className="aichat-step">
                    {step}
                  </div>
                ))}
                {turn.results.map((result, i) => (
                  <ResultTable key={`r-${i}`} result={result} />
                ))}
                {turn.errors.map((err, i) => (
                  <div key={`e-${i}`} className="aichat-error">
                    {err}
                  </div>
                ))}
                {turn.streaming && !turn.content ? (
                  <span className="aichat-cursor">▍</span>
                ) : null}
              </div>
            ) : (
              <p className="aichat-text">{turn.content}</p>
            )}
          </div>
        ))}
      </div>

      <div className="aichat-input">
        <textarea
          value={input}
          rows={2}
          placeholder="Ask anything about your data…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {streaming ? (
          <button type="button" className="aichat-send aichat-stop" onClick={stop} title="Stop">
            <Square size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="aichat-send"
            onClick={() => void send()}
            disabled={!input.trim()}
            title="Send (Enter)"
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </section>
  );
}

function handleEvent(assistantId: string, event: ChatEvent, notify?: Notify) {
  const store = useAiChatStore.getState();
  switch (event.type) {
    case "token":
      store.appendToken(assistantId, event.text);
      break;
    case "sql":
      // The SQL is already rendered inline from the streamed text; no-op here,
      // kept so future UI (e.g. a dedicated "run" affordance) can hook in.
      break;
    case "queryStart":
      store.addStep(assistantId, "Running query…");
      break;
    case "queryResult":
      store.addResult(assistantId, {
        columns: event.columns,
        rows: event.rows,
        rowCount: event.rowCount,
        truncated: event.truncated,
        elapsedMs: event.elapsedMs,
      });
      break;
    case "queryError":
      store.addError(assistantId, `Query failed: ${event.message}`);
      break;
    case "step":
      store.addStep(assistantId, event.message);
      break;
    case "done":
      store.finishAssistant(assistantId);
      break;
    case "error":
      store.addError(assistantId, event.message);
      notify?.("error", "AI chat error", event.message);
      store.finishAssistant(assistantId);
      break;
  }
}
