import { create } from "zustand";
import {
  gitCommitAll,
  gitDiff,
  gitPush,
  gitStatus,
  type GitCommandOutput,
  type GitDiffResult,
  type GitStatusSummary,
} from "../../generated/irodori-api";

type GitState = {
  open: boolean;
  status: GitStatusSummary | null;
  diff: GitDiffResult | null;
  selectedPath: string | null;
  loading: boolean;
  diffLoading: boolean;
  error: string | null;
  commandOutput: GitCommandOutput | null;
  commitMessage: string;
  openDrawer: () => void;
  closeDrawer: () => void;
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
  status: null,
  diff: null,
  selectedPath: null,
  loading: false,
  diffLoading: false,
  error: null,
  commandOutput: null,
  commitMessage: "",
  openDrawer: () => {
    set({ open: true });
    void get().refresh();
  },
  closeDrawer: () => set({ open: false }),
  setCommitMessage: (commitMessage) => set({ commitMessage }),
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const status = await gitStatus();
      const selectedPath =
        get().selectedPath && status.files.some((file) => file.path === get().selectedPath)
          ? get().selectedPath
          : status.files[0]?.path ?? null;
      set({ status, selectedPath, loading: false });
      await get().selectFile(selectedPath);
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
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
