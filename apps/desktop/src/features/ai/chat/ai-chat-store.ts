import { create } from "zustand";
import { persist } from "zustand/middleware";

/** A query result the agent ran, rendered inline in the conversation. */
export type ChatResultView = {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
};

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Structured query results the agent produced for this turn. */
  results: ChatResultView[];
  /** Progress notes (e.g. "Running query…"). */
  steps: string[];
  /** Query errors surfaced during this turn. */
  errors: string[];
  /** True while tokens are still streaming in. */
  streaming: boolean;
};

type AiChatState = {
  turns: ChatTurn[];
  input: string;
  agentMode: boolean;
  /** The session id of the in-flight turn, or null when idle. */
  activeSessionId: string | null;

  setInput: (value: string) => void;
  setAgentMode: (value: boolean) => void;
  clear: () => void;
  /** Remove the last assistant turn (used by Regenerate). Returns the preceding
   * user message, if any, so the caller can resend it. */
  dropLastAssistant: () => string | null;

  pushUser: (content: string) => void;
  startAssistant: (id: string, sessionId: string) => void;
  appendToken: (id: string, text: string) => void;
  addResult: (id: string, result: ChatResultView) => void;
  addStep: (id: string, message: string) => void;
  addError: (id: string, message: string) => void;
  finishAssistant: (id: string) => void;
};

function patchTurn(
  turns: ChatTurn[],
  id: string,
  patch: (turn: ChatTurn) => ChatTurn,
): ChatTurn[] {
  return turns.map((turn) => (turn.id === id ? patch(turn) : turn));
}

export const useAiChatStore = create<AiChatState>()(
  persist(
    (set, get) => ({
  turns: [],
  input: "",
  agentMode: true,
  activeSessionId: null,

  setInput: (value) => set({ input: value }),
  setAgentMode: (value) => set({ agentMode: value }),
  clear: () => set({ turns: [], activeSessionId: null }),

  dropLastAssistant: () => {
    const turns = get().turns;
    let lastAssistant = -1;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === "assistant") {
        lastAssistant = i;
        break;
      }
    }
    if (lastAssistant === -1) return null;
    let user: string | null = null;
    for (let i = lastAssistant - 1; i >= 0; i--) {
      if (turns[i].role === "user") {
        user = turns[i].content;
        break;
      }
    }
    set({ turns: turns.slice(0, lastAssistant), activeSessionId: null });
    return user;
  },

  pushUser: (content) =>
    set((state) => ({
      turns: [
        ...state.turns,
        {
          id: `u-${state.turns.length}-${content.length}`,
          role: "user",
          content,
          results: [],
          steps: [],
          errors: [],
          streaming: false,
        },
      ],
    })),

  startAssistant: (id, sessionId) =>
    set((state) => ({
      activeSessionId: sessionId,
      turns: [
        ...state.turns,
        {
          id,
          role: "assistant",
          content: "",
          results: [],
          steps: [],
          errors: [],
          streaming: true,
        },
      ],
    })),

  appendToken: (id, text) =>
    set((state) => ({
      turns: patchTurn(state.turns, id, (turn) => ({
        ...turn,
        content: turn.content + text,
      })),
    })),

  addResult: (id, result) =>
    set((state) => ({
      turns: patchTurn(state.turns, id, (turn) => ({
        ...turn,
        results: [...turn.results, result],
      })),
    })),

  addStep: (id, message) =>
    set((state) => ({
      turns: patchTurn(state.turns, id, (turn) => ({
        ...turn,
        steps: [...turn.steps, message],
      })),
    })),

  addError: (id, message) =>
    set((state) => ({
      turns: patchTurn(state.turns, id, (turn) => ({
        ...turn,
        errors: [...turn.errors, message],
      })),
    })),

  finishAssistant: (id) =>
    set((state) => ({
      activeSessionId: null,
      turns: patchTurn(state.turns, id, (turn) => ({
        ...turn,
        streaming: false,
      })),
    })),
    }),
    {
      name: "irodori.aichat.v1",
      // Persist the conversation + agent toggle, but never the in-flight session
      // and never large result payloads (cap stored rows to keep localStorage small).
      partialize: (state) => ({
        agentMode: state.agentMode,
        turns: state.turns.map((turn) => ({
          ...turn,
          streaming: false,
          results: turn.results.map((r) => ({ ...r, rows: r.rows.slice(0, 20) })),
        })),
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<AiChatState>),
        // A persisted session id is stale on reload.
        activeSessionId: null,
      }),
    },
  ),
);
