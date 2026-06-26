import {
  AlertTriangle,
  CheckCircle2,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import type {
  GitChangeKind,
  GitCommitSummary,
  GitFileStatus,
} from "../../generated/irodori-api";
import { buildGitGraphRows, filterGraphCommits, type GitGraphRow } from "./git-graph";
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

function commitRefs(commit: GitCommitSummary) {
  return commit.refs ?? [];
}

function refKind(ref: string) {
  if (ref.startsWith("tag: ")) {
    return "tag";
  }
  if (ref.startsWith("HEAD -> ")) {
    return "head";
  }
  if (ref.includes("/")) {
    return "remote";
  }
  return "branch";
}

function refLabel(ref: string) {
  return ref.replace(/^tag: /, "").replace(/^HEAD -> /, "");
}

function GraphSvg({ row }: { row: GitGraphRow }) {
  const laneSpacing = 16;
  const rowHeight = 44;
  const left = 10;
  const midY = rowHeight / 2;
  const width = Math.max(44, row.laneCount * laneSpacing + left * 2);
  const commitX = left + row.lane * laneSpacing;
  const parentLanes = [...new Set(row.parentLanes)];

  const xForLane = (lane: number) => left + lane * laneSpacing;

  return (
    <svg
      className="git-graph-svg"
      viewBox={`0 0 ${width} ${rowHeight}`}
      width={width}
      height={rowHeight}
      aria-hidden="true"
    >
      {row.before.map((hash, lane) => (
        <line
          key={`before-${hash}-${lane}`}
          x1={xForLane(lane)}
          y1="0"
          x2={xForLane(lane)}
          y2={midY}
        />
      ))}
      {row.after.map((hash, lane) => (
        <line
          key={`after-${hash}-${lane}`}
          x1={xForLane(lane)}
          y1={midY}
          x2={xForLane(lane)}
          y2={rowHeight}
        />
      ))}
      {parentLanes.map((lane) =>
        lane === row.lane ? null : (
          <path
            key={`parent-${lane}`}
            d={`M ${commitX} ${midY} C ${commitX} ${midY + 10}, ${xForLane(lane)} ${rowHeight - 10}, ${xForLane(lane)} ${rowHeight}`}
          />
        ),
      )}
      <circle cx={commitX} cy={midY} r="4.5" />
    </svg>
  );
}

function RefBadge({ refName }: { refName: string }) {
  return <em className={`git-ref-badge ${refKind(refName)}`}>{refLabel(refName)}</em>;
}

function GraphCommitRow({
  row,
  selected,
  onSelect,
}: {
  row: GitGraphRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const { commit } = row;
  return (
    <button
      className={`git-graph-row ${selected ? "active" : ""}`}
      type="button"
      onClick={onSelect}
      title={commit.hash}
    >
      <span className="git-graph-cell">
        <GraphSvg row={row} />
      </span>
      <span className="git-graph-main">
        <span className="git-graph-subject">
          <strong>{commit.subject}</strong>
          {commitRefs(commit).length ? (
            <span className="git-ref-list">
              {commitRefs(commit).slice(0, 4).map((refName) => (
                <RefBadge key={refName} refName={refName} />
              ))}
            </span>
          ) : null}
        </span>
        <small>
          {commit.shortHash} · {commit.author} · {formatCommitTime(commit.timestampSeconds)}
        </small>
      </span>
    </button>
  );
}

function CommitDetail({ commit }: { commit: GitCommitSummary | null }) {
  if (!commit) {
    return <div className="empty-browser">Select a commit</div>;
  }

  return (
    <div className="git-commit-detail">
      <strong>{commit.subject}</strong>
      {commitRefs(commit).length ? (
        <div className="git-ref-list detail">
          {commitRefs(commit).map((refName) => (
            <RefBadge key={refName} refName={refName} />
          ))}
        </div>
      ) : null}
      <dl>
        <div>
          <dt>Hash</dt>
          <dd>{commit.hash}</dd>
        </div>
        <div>
          <dt>Author</dt>
          <dd>{commit.author}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatCommitTime(commit.timestampSeconds)}</dd>
        </div>
        <div>
          <dt>Parents</dt>
          <dd>
            {commit.parents.length
              ? commit.parents.map((hash) => hash.slice(0, 12)).join(", ")
              : "-"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

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

  const hasChanges = (status?.files.length ?? 0) > 0;
  const filteredCommits = filterGraphCommits(graphCommits, graphQuery);
  const graphRows = buildGitGraphRows(filteredCommits);
  const selectedCommit =
    filteredCommits.find((commit) => commit.hash === selectedCommitHash) ??
    filteredCommits[0] ??
    null;
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
          <section className="git-section git-graph-section">
            <div className="git-section-title">
              <strong>Graph</strong>
              <span>{filteredCommits.length}/{graphCommits.length}</span>
            </div>
            <label className="git-graph-search">
              <Search size={13} />
              <input
                value={graphQuery}
                placeholder="Search commits, refs, authors"
                onChange={(event) => setGraphQuery(event.currentTarget.value)}
              />
              {graphQuery ? (
                <button
                  type="button"
                  aria-label="Clear graph search"
                  onClick={() => setGraphQuery("")}
                >
                  <X size={12} />
                </button>
              ) : null}
            </label>
            <div className="git-graph-layout">
              <div className="git-graph-list">
                {graphRows.length ? (
                  graphRows.map((row) => (
                    <GraphCommitRow
                      key={row.commit.hash}
                      row={row}
                      selected={selectedCommitHash === row.commit.hash}
                      onSelect={() => selectCommit(row.commit.hash)}
                    />
                  ))
                ) : (
                  <div className="empty-browser">
                    {logLoading ? "Loading Git graph..." : "No commits found"}
                  </div>
                )}
              </div>
              <CommitDetail commit={selectedCommit} />
            </div>
          </section>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
