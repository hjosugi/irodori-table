import { Channel, invoke } from "@tauri-apps/api/core";
import type { DbEngine } from "@/generated/irodori-api";

/** A turn in the conversation sent to the backend. */
export type ChatMessageDto = {
  role: "user" | "assistant";
  content: string;
};

/**
 * Events streamed back from `ai_chat` over a Tauri channel. Mirrors the Rust
 * `ChatEvent` enum (serde `tag = "type"`, camelCase).
 */
export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "sql"; sql: string }
  | { type: "queryStart"; sql: string; queryId: string }
  | {
      type: "queryResult";
      columns: string[];
      rows: unknown[][];
      rowCount: number;
      truncated: boolean;
      elapsedMs: number;
    }
  | { type: "queryError"; message: string }
  | { type: "step"; message: string }
  | { type: "done"; model: string; tokensIn: number; tokensOut: number }
  | { type: "error"; message: string };

export type AiChatParams = {
  sessionId: string;
  messages: ChatMessageDto[];
  connectionId?: string;
  engine?: DbEngine;
  agentMode: boolean;
};

/**
 * Hold a streaming chat turn. Tokens, generated SQL, and (in agent mode) query
 * results arrive on `onEvent`. Resolves when the turn is fully done. Use
 * {@link aiChatCancel} with the same `sessionId` to stop it — that also cancels
 * any database query the agent started, so the connection is never left running.
 */
export function aiChat(
  params: AiChatParams,
  onEvent: (event: ChatEvent) => void,
): Promise<void> {
  const channel = new Channel<ChatEvent>();
  channel.onmessage = onEvent;
  return invoke<void>("ai_chat", {
    sessionId: params.sessionId,
    messages: params.messages,
    connectionId: params.connectionId,
    engine: params.engine,
    agentMode: params.agentMode,
    onEvent: channel,
  });
}

/** Stop a running chat session and abort any in-flight agent query. */
export function aiChatCancel(sessionId: string): Promise<void> {
  return invoke("ai_chat_cancel", { sessionId });
}

/** A unique-enough session id for one chat run. */
export function newChatSessionId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Unload the embedded local model from memory (frees RAM; reloads on next use). */
export function aiUnloadLocal(): Promise<void> {
  return invoke("ai_unload_local");
}

/** Delete the embedded local model file from disk (frees storage). */
export function aiDeleteLocalModel(): Promise<void> {
  return invoke("ai_delete_local_model");
}
