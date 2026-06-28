import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileDiff,
  GitBranch,
  RefreshCw,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { GitChangesView } from "./GitChangesView";
import { GitGraphView } from "./GitGraphView";
import { branchSummary, gitAccentColor, providerLabel } from "./git-format";
import { useGitStore } from "./git-store";

function ViewButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "active" : undefined}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

type GitPanelProps = {
  variant?: "drawer" | "sidebar";
  onClose?: () => void;
};

export function GitPanel({ variant = "drawer", onClose }: GitPanelProps) {
  const view = useGitStore((state) => state.view);
  const repoPath = useGitStore((state) => state.repoPath);
  const repoPathDraft = useGitStore((state) => state.repoPathDraft);
  const repoColors = useGitStore((state) => state.repoColors);
  const status = useGitStore((state) => state.status);
  const graphCommits = useGitStore((state) => state.graphCommits);
  const selectedCommitHash = useGitStore((state) => state.selectedCommitHash);
  const graphQuery = useGitStore((state) => state.graphQuery);
  const graphRefFilter = useGitStore((state) => state.graphRefFilter);
  const diff = useGitStore((state) => state.diff);
  const selectedPath = useGitStore((state) => state.selectedPath);
  const branchDraft = useGitStore((state) => state.branchDraft);
  const loading = useGitStore((state) => state.loading);
  const logLoading = useGitStore((state) => state.logLoading);
  const diffLoading = useGitStore((state) => state.diffLoading);
  const error = useGitStore((state) => state.error);
  const commandOutput = useGitStore((state) => state.commandOutput);
  const commitMessage = useGitStore((state) => state.commitMessage);
  const closeDrawer = useGitStore((state) => state.closeDrawer);
  const closePanel = onClose ?? closeDrawer;
  const refresh = useGitStore((state) => state.refresh);
  const setView = useGitStore((state) => state.setView);
  const setRepoPath = useGitStore((state) => state.setRepoPath);
  const setRepoPathDraft = useGitStore((state) => state.setRepoPathDraft);
  const setRepoColor = useGitStore((state) => state.setRepoColor);
  const setGraphQuery = useGitStore((state) => state.setGraphQuery);
  const setGraphRefFilter = useGitStore((state) => state.setGraphRefFilter);
  const selectCommit = useGitStore((state) => state.selectCommit);
  const selectFile = useGitStore((state) => state.selectFile);
  const setCommitMessage = useGitStore((state) => state.setCommitMessage);
  const setBranchDraft = useGitStore((state) => state.setBranchDraft);
  const commitAll = useGitStore((state) => state.commitAll);
  const commitStaged = useGitStore((state) => state.commitStaged);
  const fetch = useGitStore((state) => state.fetch);
  const pull = useGitStore((state) => state.pull);
  const push = useGitStore((state) => state.push);
  const stagePaths = useGitStore((state) => state.stagePaths);
  const unstagePaths = useGitStore((state) => state.unstagePaths);
  const discardPaths = useGitStore((state) => state.discardPaths);
  const checkoutBranch = useGitStore((state) => state.checkoutBranch);
  const createBranch = useGitStore((state) => state.createBranch);
  const deleteBranch = useGitStore((state) => state.deleteBranch);

  const files = status?.files ?? [];
  const hasChanges = files.length > 0;
  const selectedFile = selectedPath
    ? (files.find((file) => file.path === selectedPath) ?? null)
    : null;
  const selectedPaths = selectedPath ? [selectedPath] : [];
  const primaryRemote = status?.remotes[0];
  const accentColor = gitAccentColor(
    primaryRemote?.provider,
    status ? repoColors[status.repoRoot] : undefined,
  );
  const drawerStyle = { "--git-accent": accentColor } as CSSProperties;

  async function onCommit() {
    if (!hasChanges) {
      return;
    }
    if (!window.confirm("Commit all current changes?")) {
      return;
    }
    await commitAll();
  }

  async function onCommitStaged() {
    if (!window.confirm("Commit staged changes?")) {
      return;
    }
    await commitStaged();
  }

  async function onPush() {
    if (!window.confirm("Push the current branch to its configured remote?")) {
      return;
    }
    await push();
  }

  async function onPull() {
    if (!window.confirm("Pull with fast-forward only?")) {
      return;
    }
    await pull();
  }

  async function onDiscardSelected() {
    if (!selectedPath) {
      return;
    }
    if (
      !window.confirm(
        `Discard local changes in ${selectedPath}? This cannot be undone.`,
      )
    ) {
      return;
    }
    await discardPaths([selectedPath]);
  }

  async function onBrowseRepo() {
    const result = await openDialog({
      directory: true,
      multiple: false,
      title: "Select Git repository",
    });
    if (typeof result === "string") {
      setRepoPath(result);
    }
  }

  async function onCheckoutBranch(branch: string) {
    if (!branch || branch === status?.branch) {
      return;
    }
    if (
      hasChanges &&
      !window.confirm(`Switch to ${branch} with local changes present?`)
    ) {
      return;
    }
    await checkoutBranch(branch);
  }

  async function onDeleteBranchDraft() {
    const branch = branchDraft.trim();
    if (!branch) {
      return;
    }
    if (branch === status?.branch) {
      window.alert("Switch away from the branch before deleting it.");
      return;
    }
    if (!window.confirm(`Delete branch ${branch}?`)) {
      return;
    }
    await deleteBranch(branch);
  }

  return (
    <div
      className={`git-drawer git-panel-${variant} ${error ? "has-error" : ""}`}
      role={variant === "drawer" ? "dialog" : "region"}
      aria-label="Git integration"
      style={drawerStyle}
    >
      <div className="git-drawer-header">
        <span>
          <GitBranch size={16} />
          <strong>Git</strong>
        </span>
        <div
          className="segmented-control git-view-switch"
          aria-label="Git view"
        >
          <ViewButton
            active={view === "graph"}
            label="Graph"
            onClick={() => setView("graph")}
          />
          <ViewButton
            active={view === "changes"}
            label="Changes"
            onClick={() => setView("changes")}
          />
        </div>
        <button
          className="icon-button"
          type="button"
          title="Refresh Git status"
          aria-label="Refresh Git status"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw size={14} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Close Git panel"
          aria-label="Close Git panel"
          onClick={closePanel}
        >
          <X size={14} />
        </button>
      </div>

      {status ? (
        <div className="git-branch-card">
          <span>
            <strong>
              {branchSummary(
                status.branch,
                status.upstream,
                status.ahead,
                status.behind,
              )}
            </strong>
            <small title={status.repoRoot}>{status.repoRoot}</small>
          </span>
          <span
            className={`git-clean-badge ${status.clean ? "clean" : "dirty"}`}
          >
            {status.clean ? <CheckCircle2 size={13} /> : <FileDiff size={13} />}
            {status.clean ? "Clean" : `${status.files.length} changes`}
          </span>
          <div className="git-provider-row">
            {status.remotes.length > 0 ? (
              status.remotes.map((remote) => (
                <span className="git-provider-badge" key={remote.name}>
                  <i
                    style={{
                      background: gitAccentColor(
                        remote.provider,
                        repoColors[status.repoRoot],
                      ),
                    }}
                  />
                  {providerLabel(remote.provider)}
                  <small>{remote.name}</small>
                  {remote.webUrl ? (
                    <a
                      href={remote.webUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={remote.webUrl}
                    >
                      <ExternalLink size={11} />
                    </a>
                  ) : null}
                </span>
              ))
            ) : (
              <span className="git-provider-badge">
                <i style={{ background: accentColor }} />
                Local Git
              </span>
            )}
            <label className="git-color-picker">
              <span>Color</span>
              <input
                type="color"
                value={accentColor}
                onChange={(event) =>
                  setRepoColor(status.repoRoot, event.currentTarget.value)
                }
              />
            </label>
          </div>
          <div className="git-repo-row">
            <input
              value={repoPathDraft}
              placeholder={repoPath || status.repoRoot}
              onChange={(event) => setRepoPathDraft(event.currentTarget.value)}
            />
            <button
              className="text-button"
              type="button"
              onClick={() => setRepoPath(repoPathDraft)}
            >
              Use
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => void onBrowseRepo()}
            >
              Browse
            </button>
          </div>
          <div className="git-branch-row">
            <select
              value={status.branch}
              onChange={(event) =>
                void onCheckoutBranch(event.currentTarget.value)
              }
            >
              {status.branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                  {branch.upstream ? ` -> ${branch.upstream}` : ""}
                </option>
              ))}
            </select>
            <input
              value={branchDraft}
              placeholder="new-branch"
              onChange={(event) => setBranchDraft(event.currentTarget.value)}
            />
            <button
              className="text-button"
              type="button"
              onClick={() => void createBranch(branchDraft)}
            >
              Create
            </button>
            <button
              className="text-button danger"
              type="button"
              disabled={!branchDraft.trim()}
              onClick={() => void onDeleteBranchDraft()}
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="inline-error git-error">
          <AlertTriangle size={13} />
          <span>{error}</span>
        </div>
      ) : null}

      <div
        className={`git-drawer-body ${view === "graph" ? "graph-mode" : ""}`}
      >
        {view === "graph" ? (
          <GitGraphView
            commits={graphCommits}
            query={graphQuery}
            refFilter={graphRefFilter}
            selectedCommitHash={selectedCommitHash}
            loading={logLoading}
            onQueryChange={setGraphQuery}
            onRefFilterChange={setGraphRefFilter}
            onSelectCommit={selectCommit}
          />
        ) : (
          <GitChangesView
            files={files}
            selectedPath={selectedPath}
            diff={diff}
            loading={loading}
            diffLoading={diffLoading}
            commitMessage={commitMessage}
            commandOutput={commandOutput}
            selectedFile={selectedFile}
            onSelectFile={(path) => void selectFile(path)}
            onCommitMessageChange={setCommitMessage}
            onCommit={() => void onCommit()}
            onCommitStaged={() => void onCommitStaged()}
            onFetch={() => void fetch()}
            onPull={() => void onPull()}
            onPush={() => void onPush()}
            onStageSelected={() => void stagePaths(selectedPaths)}
            onStageAll={() => void stagePaths(files.map((file) => file.path))}
            onUnstageSelected={() => void unstagePaths(selectedPaths)}
            onDiscardSelected={() => void onDiscardSelected()}
          />
        )}
      </div>
    </div>
  );
}

export function GitDrawer() {
  const open = useGitStore((state) => state.open);
  if (!open) {
    return null;
  }
  return <GitPanel variant="drawer" />;
}
