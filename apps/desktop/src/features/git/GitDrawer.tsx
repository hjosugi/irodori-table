import {
  AlertTriangle,
  CheckCircle2,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import type {
  GitChangeKind,
  GitCommitSummary,
  GitFileStatus,
} from "../../generated/irodori-api";
import { useGitStore } from "./git-store";

function changeLabel(kind: GitChangeKind) {
  switch (kind) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "?";
    case "unmerged":
      return "!";
    case "typeChanged":
      return "T";
    case "modified":
      return "M";
    default:
      return "?";
  }
}

function formatCommitTime(value: bigint) {
  const date = new Date(Number(value) * 1000);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function branchSummary(
  branch: string,
  upstream: string | undefined,
  ahead: number,
  behind: number,
) {
  const sync = [
    ahead > 0 ? `${ahead} ahead` : null,
    behind > 0 ? `${behind} behind` : null,
  ].filter(Boolean);
  return [branch, upstream ? `tracking ${upstream}` : null, ...sync]
    .filter(Boolean)
    .join(" · ");
}

function FileStatusRow({
  file,
  selected,
  onSelect,
}: {
  file: GitFileStatus;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`git-file-row ${selected ? "active" : ""} ${file.kind}`}
      type="button"
      title={file.originalPath ? `${file.originalPath} -> ${file.path}` : file.path}
      onClick={onSelect}
    >
      <span className="git-file-kind">{changeLabel(file.kind)}</span>
      <span className="git-file-path">
        {file.originalPath ? (
          <>
            <small>{file.originalPath}</small>
            {file.path}
          </>
        ) : (
          file.path
        )}
      </span>
      <small>
        {file.indexStatus.trim() || "-"}
        {file.worktreeStatus.trim() || "-"}
      </small>
    </button>
  );
}

function CommitRow({ commit }: { commit: GitCommitSummary }) {
  return (
    <div className="git-commit-row">
      <GitCommitHorizontal size={13} />
      <span>
        <strong>{commit.subject}</strong>
        <small>
          {commit.shortHash} · {commit.author} ·{" "}
          {formatCommitTime(commit.timestampSeconds)}
        </small>
      </span>
    </div>
  );
}

export function GitDrawer() {
  const open = useGitStore((state) => state.open);
  const status = useGitStore((state) => state.status);
  const diff = useGitStore((state) => state.diff);
  const selectedPath = useGitStore((state) => state.selectedPath);
  const loading = useGitStore((state) => state.loading);
  const diffLoading = useGitStore((state) => state.diffLoading);
  const error = useGitStore((state) => state.error);
  const commandOutput = useGitStore((state) => state.commandOutput);
  const commitMessage = useGitStore((state) => state.commitMessage);
  const closeDrawer = useGitStore((state) => state.closeDrawer);
  const refresh = useGitStore((state) => state.refresh);
  const selectFile = useGitStore((state) => state.selectFile);
  const setCommitMessage = useGitStore((state) => state.setCommitMessage);
  const commitAll = useGitStore((state) => state.commitAll);
  const push = useGitStore((state) => state.push);

  if (!open) {
    return null;
  }

  const hasChanges = (status?.files.length ?? 0) > 0;
  const diffText = [
    diff?.staged ? `# Staged\n${diff.staged}` : "",
    diff?.unstaged ? `# Unstaged\n${diff.unstaged}` : "",
  ]
    .filter(Boolean)
    .join("\n");

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
    <div className="git-drawer" role="dialog" aria-label="Git integration">
      <div className="git-drawer-header">
        <span>
          <GitBranch size={16} />
          <strong>Git</strong>
        </span>
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

      <div className="git-drawer-body">
        <section className="git-section git-files">
          <div className="git-section-title">
            <strong>Changes</strong>
            <span>{status?.files.length ?? 0}</span>
          </div>
          <div className="git-file-list">
            {status?.files.length ? (
              status.files.map((file) => (
                <FileStatusRow
                  key={`${file.originalPath ?? ""}:${file.path}`}
                  file={file}
                  selected={selectedPath === file.path}
                  onSelect={() => void selectFile(file.path)}
                />
              ))
            ) : (
              <div className="empty-browser">
                {loading ? "Loading Git status..." : "No local changes"}
              </div>
            )}
          </div>
        </section>

        <section className="git-section git-diff">
          <div className="git-section-title">
            <strong>{selectedPath ?? "Repository diff"}</strong>
            {diff?.truncated ? <span>truncated</span> : null}
          </div>
          <pre>{diffLoading ? "Loading diff..." : diffText || "No diff"}</pre>
        </section>

        <section className="git-section">
          <div className="git-section-title">
            <strong>Commit</strong>
          </div>
          <textarea
            value={commitMessage}
            placeholder="Commit message"
            spellCheck={true}
            onChange={(event) => setCommitMessage(event.currentTarget.value)}
          />
          <div className="git-action-row">
            <button
              className="primary-button"
              type="button"
              disabled={!hasChanges || loading || !commitMessage.trim()}
              onClick={() => void onCommit()}
            >
              <GitCommitHorizontal size={14} />
              Commit all
            </button>
            <button
              className="text-button"
              type="button"
              disabled={loading}
              onClick={() => void onPush()}
            >
              <Upload size={14} />
              Push
            </button>
          </div>
          {commandOutput ? (
            <pre className="git-command-output">
              {[commandOutput.stdout, commandOutput.stderr]
                .filter(Boolean)
                .join("\n") || `exit ${commandOutput.statusCode}`}
            </pre>
          ) : null}
        </section>

        <section className="git-section">
          <div className="git-section-title">
            <strong>Recent commits</strong>
          </div>
          <div className="git-commit-list">
            {status?.recentCommits.length ? (
              status.recentCommits.map((commit) => (
                <CommitRow key={commit.hash} commit={commit} />
              ))
            ) : (
              <div className="empty-browser">No commits found</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
