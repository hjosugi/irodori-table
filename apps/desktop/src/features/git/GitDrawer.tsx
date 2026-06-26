import {
  AlertTriangle,
  CheckCircle2,
  FileDiff,
  GitBranch,
  RefreshCw,
  X,
} from "lucide-react";
import { GitChangesView } from "./GitChangesView";
import { GitGraphView } from "./GitGraphView";
import { branchSummary } from "./git-format";
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
    <button className={active ? "active" : undefined} type="button" onClick={onClick}>
      {label}
    </button>
  );
}

export function GitDrawer() {
  const open = useGitStore((state) => state.open);
  const view = useGitStore((state) => state.view);
  const status = useGitStore((state) => state.status);
  const graphCommits = useGitStore((state) => state.graphCommits);
  const selectedCommitHash = useGitStore((state) => state.selectedCommitHash);
  const graphQuery = useGitStore((state) => state.graphQuery);
  const diff = useGitStore((state) => state.diff);
  const selectedPath = useGitStore((state) => state.selectedPath);
  const loading = useGitStore((state) => state.loading);
  const logLoading = useGitStore((state) => state.logLoading);
  const diffLoading = useGitStore((state) => state.diffLoading);
  const error = useGitStore((state) => state.error);
  const commandOutput = useGitStore((state) => state.commandOutput);
  const commitMessage = useGitStore((state) => state.commitMessage);
  const closeDrawer = useGitStore((state) => state.closeDrawer);
  const refresh = useGitStore((state) => state.refresh);
  const setView = useGitStore((state) => state.setView);
  const setGraphQuery = useGitStore((state) => state.setGraphQuery);
  const selectCommit = useGitStore((state) => state.selectCommit);
  const selectFile = useGitStore((state) => state.selectFile);
  const setCommitMessage = useGitStore((state) => state.setCommitMessage);
  const commitAll = useGitStore((state) => state.commitAll);
  const push = useGitStore((state) => state.push);

  if (!open) {
    return null;
  }

  const files = status?.files ?? [];
  const hasChanges = files.length > 0;

  async function onCommit() {
    if (!hasChanges) {
      return;
    }
    if (!window.confirm("Commit all current changes?")) {
      return;
    }
    await commitAll();
  }

  async function onPush() {
    if (!window.confirm("Push the current branch to its configured remote?")) {
      return;
    }
    await push();
  }

  return (
    <div
      className={`git-drawer ${error ? "has-error" : ""}`}
      role="dialog"
      aria-label="Git integration"
    >
      <div className="git-drawer-header">
        <span>
          <GitBranch size={16} />
          <strong>Git</strong>
        </span>
        <div className="segmented-control git-view-switch" aria-label="Git view">
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
          onClick={closeDrawer}
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
          <span className={`git-clean-badge ${status.clean ? "clean" : "dirty"}`}>
            {status.clean ? <CheckCircle2 size={13} /> : <FileDiff size={13} />}
            {status.clean ? "Clean" : `${status.files.length} changes`}
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="inline-error git-error">
          <AlertTriangle size={13} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className={`git-drawer-body ${view === "graph" ? "graph-mode" : ""}`}>
        {view === "graph" ? (
          <GitGraphView
            commits={graphCommits}
            query={graphQuery}
            selectedCommitHash={selectedCommitHash}
            loading={logLoading}
            onQueryChange={setGraphQuery}
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
            onSelectFile={(path) => void selectFile(path)}
            onCommitMessageChange={setCommitMessage}
            onCommit={() => void onCommit()}
            onPush={() => void onPush()}
          />
        )}
      </div>
    </div>
  );
}
