import { create } from "zustand";
import {
  gitCommitAll,
  gitDiff,
  gitLog,
  gitPush,
  gitStatus,
  type GitCommandOutput,
  type GitCommitSummary,
  type GitDiffResult,
  type GitStatusSummary,
} from "../../generated/irodori-api";

export type GitDrawerView = "graph" | "changes";

type GitState = {
  open: boolean;
  view: GitDrawerView;
  status: GitStatusSummary | null;
  graphCommits: GitCommitSummary[];
  selectedCommitHash: string | null;
  graphQuery: string;
  diff: GitDiffResult | null;
  selectedPath: string | null;
  loading: boolean;
  logLoading: boolean;
  diffLoading: boolean;
  error: string | null;
  commandOutput: GitCommandOutput | null;
  commitMessage: string;
  openDrawer: () => void;
  closeDrawer: () => void;
  setView: (view: GitDrawerView) => void;
  setGraphQuery: (query: string) => void;
  selectCommit: (hash: string) => void;
  setCommitMessage: (message: string) => void;
  refresh: () => Promise<void>;
  selectFile: (path: string | null) => Promise<void>;
  commitAll: () => Promise<boolean>;
  push: () => Promise<boolean>;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}

export const useGitStore = create<GitState>((set, get) => ({
  open: false,
  view: "graph",
  status: null,
  graphCommits: [],
  selectedCommitHash: null,
  graphQuery: "",
  diff: null,
  selectedPath: null,
  loading: false,
  logLoading: false,
  diffLoading: false,
  error: null,
  commandOutput: null,
  commitMessage: "",
  openDrawer: () => {
    set({ open: true });
    void get().refresh();
  },
  closeDrawer: () => set({ open: false }),
  setView: (view) => set({ view }),
  setGraphQuery: (graphQuery) => set({ graphQuery }),
  selectCommit: (selectedCommitHash) => set({ selectedCommitHash }),
  setCommitMessage: (commitMessage) => set({ commitMessage }),
  refresh: async () => {
    set({ loading: true, logLoading: true, error: null });
    try {
      const [status, graphCommits] = await Promise.all([
        gitStatus(),
        gitLog(undefined, 80),
      ]);
      const selectedPath =
        get().selectedPath && status.files.some((file) => file.path === get().selectedPath)
          ? get().selectedPath
          : status.files[0]?.path ?? null;
      const selectedCommitHash =
        get().selectedCommitHash &&
        graphCommits.some((commit) => commit.hash === get().selectedCommitHash)
          ? get().selectedCommitHash
          : graphCommits[0]?.hash ?? null;
      set({
        status,
        graphCommits,
        selectedCommitHash,
        selectedPath,
        loading: false,
        logLoading: false,
      });
      await get().selectFile(selectedPath);
    } catch (error) {
      set({ error: errorMessage(error), loading: false, logLoading: false });
    }
  },
  selectFile: async (selectedPath) => {
    set({ selectedPath, diffLoading: true, error: null });
    try {
      const diff = await gitDiff(undefined, selectedPath ?? undefined);
      set({ diff, diffLoading: false });
    } catch (error) {
      set({ error: errorMessage(error), diffLoading: false });
    }
  },
  commitAll: async () => {
    const message = get().commitMessage.trim();
    if (!message) {
      set({ error: "Commit message is required" });
      return false;
    }
    set({ loading: true, error: null, commandOutput: null });
    try {
      const commandOutput = await gitCommitAll(message);
      set({ commandOutput, commitMessage: "", loading: false });
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      return false;
    }
  },
  push: async () => {
    set({ loading: true, error: null, commandOutput: null });
    try {
      const commandOutput = await gitPush();
      set({ commandOutput, loading: false });
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      return false;
    }
  },
}));
