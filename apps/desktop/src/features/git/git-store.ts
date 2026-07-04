import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  gitCheckoutBranch,
  gitCommitAll,
  gitCommitStaged,
  gitDeleteBranch,
  gitDiff,
  gitDiscardFiles,
  gitFetch,
  gitLog,
  gitPull,
  gitPush,
  gitStageFiles,
  gitStatus,
  gitUnstageFiles,
  type GitCommandOutput,
  type GitCommitSummary,
  type GitDiffResult,
  type GitStatusSummary,
} from "../../generated/irodori-api";
import type { GitGraphRefFilter } from "./git-graph";
import { normalizeHexColor } from "./git-format";

export type GitDrawerView = "graph" | "changes";

const repoPathStorageKey = "irodori.git.repoPath.v1";
const repoColorsStorageKey = "irodori.git.repoColors.v1";

type GitState = {
  open: boolean;
  view: GitDrawerView;
  repoPath: string;
  repoPathDraft: string;
  repoColors: Record<string, string>;
  status: GitStatusSummary | null;
  graphCommits: GitCommitSummary[];
  selectedCommitHash: string | null;
  commitDiff: GitDiffResult | null;
  selectedCommitPath: string | null;
  graphQuery: string;
  graphRefFilter: GitGraphRefFilter;
  diff: GitDiffResult | null;
  selectedPath: string | null;
  branchDraft: string;
  loading: boolean;
  logLoading: boolean;
  diffLoading: boolean;
  commitDiffLoading: boolean;
  error: string | null;
  commandOutput: GitCommandOutput | null;
  commitMessage: string;
  openDrawer: () => void;
  closeDrawer: () => void;
  setView: (view: GitDrawerView) => void;
  setRepoPathDraft: (repoPathDraft: string) => void;
  setRepoPath: (repoPath: string) => void;
  setRepoColor: (repoRoot: string, color: string) => void;
  setGraphQuery: (query: string) => void;
  setGraphRefFilter: (refFilter: GitGraphRefFilter) => void;
  selectCommit: (hash: string) => void;
  selectCommitFile: (path: string | null) => Promise<void>;
  setCommitMessage: (message: string) => void;
  setBranchDraft: (branchDraft: string) => void;
  refresh: () => Promise<void>;
  selectFile: (path: string | null) => Promise<void>;
  commitAll: () => Promise<boolean>;
  commitStaged: () => Promise<boolean>;
  fetch: () => Promise<boolean>;
  pull: () => Promise<boolean>;
  push: () => Promise<boolean>;
  stagePaths: (paths: string[]) => Promise<boolean>;
  unstagePaths: (paths: string[]) => Promise<boolean>;
  discardPaths: (paths: string[]) => Promise<boolean>;
  checkoutBranch: (branch: string) => Promise<boolean>;
  createBranch: (branch: string, startPoint?: string) => Promise<boolean>;
  deleteBranch: (branch: string, force?: boolean) => Promise<boolean>;
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

function loadRepoPath() {
  return window.localStorage.getItem(repoPathStorageKey) ?? "";
}

function loadRepoColors() {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(repoColorsStorageKey) ?? "{}",
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([repoRoot, color]) => [
        repoRoot,
        normalizeHexColor(String(color)),
      ]),
    );
  } catch {
    return {};
  }
}

function repoArg(state: GitState) {
  return state.repoPath.trim() || undefined;
}

function selectedPaths(paths: string[]) {
  return paths.map((path) => path.trim()).filter(Boolean);
}

function gitCommitDiff(
  repoPath: string | undefined,
  commit: string,
  filePath?: string,
) {
  return invoke<GitDiffResult>("git_diff", { repoPath, filePath, commit });
}

function gitCheckoutBranchFromStartPoint(
  branch: string,
  create: boolean,
  repoPath: string | undefined,
  startPoint?: string,
) {
  return invoke<GitCommandOutput>("git_checkout_branch", {
    branch,
    create,
    repoPath,
    startPoint,
  });
}

export const useGitStore = create<GitState>((set, get) => ({
  open: false,
  view: "graph",
  repoPath: loadRepoPath(),
  repoPathDraft: loadRepoPath(),
  repoColors: loadRepoColors(),
  status: null,
  graphCommits: [],
  selectedCommitHash: null,
  commitDiff: null,
  selectedCommitPath: null,
  graphQuery: "",
  graphRefFilter: "all",
  diff: null,
  selectedPath: null,
  branchDraft: "",
  loading: false,
  logLoading: false,
  diffLoading: false,
  commitDiffLoading: false,
  error: null,
  commandOutput: null,
  commitMessage: "",
  openDrawer: () => {
    set({ open: true });
    void get().refresh();
  },
  closeDrawer: () => set({ open: false }),
  setView: (view) => set({ view }),
  setRepoPathDraft: (repoPathDraft) => set({ repoPathDraft }),
  setRepoPath: (repoPath) => {
    const next = repoPath.trim();
    window.localStorage.setItem(repoPathStorageKey, next);
    set({
      repoPath: next,
      repoPathDraft: next,
      status: null,
      graphCommits: [],
      selectedCommitHash: null,
      commitDiff: null,
      selectedCommitPath: null,
      selectedPath: null,
      graphRefFilter: "all",
      diff: null,
      error: null,
    });
    void get().refresh();
  },
  setRepoColor: (repoRoot, color) =>
    set((state) => {
      const next = {
        ...state.repoColors,
        [repoRoot]: normalizeHexColor(color),
      };
      window.localStorage.setItem(repoColorsStorageKey, JSON.stringify(next));
      return { repoColors: next };
    }),
  setGraphQuery: (graphQuery) => set({ graphQuery }),
  setGraphRefFilter: (graphRefFilter) => set({ graphRefFilter }),
  selectCommit: (selectedCommitHash) => {
    set({ selectedCommitHash, selectedCommitPath: null, commitDiff: null });
    void get().selectCommitFile(null);
  },
  selectCommitFile: async (path) => {
    const selectedCommitHash = get().selectedCommitHash;
    const selectedCommitPath = path?.trim() || null;
    if (!selectedCommitHash) {
      set({
        commitDiff: null,
        commitDiffLoading: false,
        selectedCommitPath: null,
      });
      return;
    }
    set({
      selectedCommitPath,
      commitDiff: null,
      commitDiffLoading: true,
      error: null,
    });
    try {
      const commitDiff = await gitCommitDiff(
        repoArg(get()),
        selectedCommitHash,
        selectedCommitPath ?? undefined,
      );
      if (
        get().selectedCommitHash === selectedCommitHash &&
        get().selectedCommitPath === selectedCommitPath
      ) {
        set({ commitDiff, commitDiffLoading: false });
      }
    } catch (error) {
      if (
        get().selectedCommitHash === selectedCommitHash &&
        get().selectedCommitPath === selectedCommitPath
      ) {
        set({ error: errorMessage(error), commitDiffLoading: false });
      }
    }
  },
  setCommitMessage: (commitMessage) => set({ commitMessage }),
  setBranchDraft: (branchDraft) => set({ branchDraft }),
  refresh: async () => {
    set({ loading: true, logLoading: true, error: null });
    try {
      const repoPath = repoArg(get());
      const [status, graphCommits] = await Promise.all([
        gitStatus(repoPath),
        gitLog(repoPath, 80),
      ]);
      const selectedPath =
        get().selectedPath &&
        status.files.some((file) => file.path === get().selectedPath)
          ? get().selectedPath
          : (status.files[0]?.path ?? null);
      const selectedCommitHash =
        get().selectedCommitHash &&
        graphCommits.some((commit) => commit.hash === get().selectedCommitHash)
          ? get().selectedCommitHash
          : (graphCommits[0]?.hash ?? null);
      set({
        status,
        graphCommits,
        selectedCommitHash,
        selectedPath,
        loading: false,
        logLoading: false,
      });
      await Promise.all([
        get().selectFile(selectedPath),
        get().selectCommitFile(null),
      ]);
    } catch (error) {
      set({ error: errorMessage(error), loading: false, logLoading: false });
    }
  },
  selectFile: async (selectedPath) => {
    set({ selectedPath, diffLoading: true, error: null });
    try {
      const diff = await gitDiff(repoArg(get()), selectedPath ?? undefined);
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
      const commandOutput = await gitCommitAll(message, repoArg(get()));
      set({ commandOutput, commitMessage: "", loading: false });
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      return false;
    }
  },
  commitStaged: async () => {
    const message = get().commitMessage.trim();
    if (!message) {
      set({ error: "Commit message is required" });
      return false;
    }
    set({ loading: true, error: null, commandOutput: null });
    try {
      const commandOutput = await gitCommitStaged(message, repoArg(get()));
      set({ commandOutput, commitMessage: "", loading: false });
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      return false;
    }
  },
  fetch: async () => {
    set({ loading: true, error: null, commandOutput: null });
    try {
      const commandOutput = await gitFetch(repoArg(get()));
      set({ commandOutput, loading: false });
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      return false;
    }
  },
  pull: async () => {
    set({ loading: true, error: null, commandOutput: null });
    try {
      const commandOutput = await gitPull(repoArg(get()));
      set({ commandOutput, loading: false });
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
      const commandOutput = await gitPush(repoArg(get()));
      set({ commandOutput, loading: false });
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      return false;
    }
  },
  stagePaths: async (paths) => {
    const targetPaths = selectedPaths(paths);
    if (targetPaths.length === 0) {
      set({ error: "Select at least one file to stage" });
      return false;
    }
    set({ loading: true, error: null, commandOutput: null });
    try {
      const commandOutput = await gitStageFiles(targetPaths, repoArg(get()));
      set({ commandOutput, loading: false });
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      return false;
    }
  },
  unstagePaths: async (paths) => {
    const targetPaths = selectedPaths(paths);
    if (targetPaths.length === 0) {
      set({ error: "Select at least one file to unstage" });
      return false;
    }
    set({ loading: true, error: null, commandOutput: null });
    try {
      const commandOutput = await gitUnstageFiles(targetPaths, repoArg(get()));
      set({ commandOutput, loading: false });
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      return false;
    }
  },
  discardPaths: async (paths) => {
    const targetPaths = selectedPaths(paths);
    if (targetPaths.length === 0) {
      set({ error: "Select at least one file to discard" });
      return false;
    }
    set({ loading: true, error: null, commandOutput: null });
    try {
      const commandOutput = await gitDiscardFiles(targetPaths, repoArg(get()));
      set({ commandOutput, loading: false });
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      return false;
    }
  },
  checkoutBranch: async (branch) => {
    const target = branch.trim();
    if (!target) {
      set({ error: "Branch name is required" });
      return false;
    }
    set({ loading: true, error: null, commandOutput: null });
    try {
      const commandOutput = await gitCheckoutBranch(
        target,
        false,
        repoArg(get()),
      );
      set({ commandOutput, loading: false });
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      return false;
    }
  },
  createBranch: async (branch, startPoint) => {
    const target = branch.trim();
    if (!target) {
      set({ error: "Branch name is required" });
      return false;
    }
    set({ loading: true, error: null, commandOutput: null });
    try {
      const commandOutput = await gitCheckoutBranchFromStartPoint(
        target,
        true,
        repoArg(get()),
        startPoint?.trim() || undefined,
      );
      set({ commandOutput, branchDraft: "", loading: false });
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      return false;
    }
  },
  deleteBranch: async (branch, force = false) => {
    const target = branch.trim();
    if (!target) {
      set({ error: "Branch name is required" });
      return false;
    }
    set({ loading: true, error: null, commandOutput: null });
    try {
      const commandOutput = await gitDeleteBranch(
        target,
        force,
        repoArg(get()),
      );
      set({ commandOutput, loading: false });
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: errorMessage(error), loading: false });
      return false;
    }
  },
}));
