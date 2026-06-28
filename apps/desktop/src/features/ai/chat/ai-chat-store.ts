import { create } from "zustand";

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

export const useAiChatStore = create<AiChatState>((set) => ({
  turns: [],
  input: "",
  agentMode: true,
  activeSessionId: null,

  setInput: (value) => set({ input: value }),
  setAgentMode: (value) => set({ agentMode: value }),
  clear: () => set({ turns: [], activeSessionId: null }),

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
}));
