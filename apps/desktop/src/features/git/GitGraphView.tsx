import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import {
  Copy,
  ExternalLink,
  GitBranch,
  GitBranchPlus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitDiffResult,
  GitRemoteSummary,
} from "../../generated/irodori-api";
import {
  buildGitGraphRows,
  filterGraphCommits,
  nextGraphCommitHash,
  parseCommitFileSummary,
  type GitGraphRefFilter,
  type GitGraphRow,
} from "./git-graph";
import {
  changeLabel,
  commitRefs,
  formatCommitTime,
  localBranchNameFromRef,
  refKind,
  refLabel,
  remoteBranchInfoFromRef,
  remoteCommitUrl,
} from "./git-format";

const graphLaneColors = [
  "#20a4f3",
  "#b877db",
  "#f59e0b",
  "#34c759",
  "#ff5d73",
  "#00b8a9",
];

const gitGraphRowHeight = 36;
const gitGraphOverscanRows = 8;

type LocalBranchRefAction = {
  branchName: string;
  current: boolean;
  kind: "local";
  refName: string;
};

type RemoteBranchRefAction = {
  branchName: string;
  current: boolean;
  kind: "remote";
  localExists: boolean;
  remoteName: string;
  refName: string;
  startPoint: string;
};

type BranchRefAction = LocalBranchRefAction | RemoteBranchRefAction;

function laneColor(lane: number) {
  return graphLaneColors[lane % graphLaneColors.length];
}

function GraphSvg({ row }: { row: GitGraphRow }) {
  const laneSpacing = 18;
  const rowHeight = 36;
  const left = 14;
  const midY = rowHeight / 2;
  const width = Math.max(78, row.laneCount * laneSpacing + left * 2);
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
          style={{ stroke: laneColor(lane) }}
        />
      ))}
      {row.after.map((hash, lane) => (
        <line
          key={`after-${hash}-${lane}`}
          x1={xForLane(lane)}
          y1={midY}
          x2={xForLane(lane)}
          y2={rowHeight}
          style={{ stroke: laneColor(lane) }}
        />
      ))}
      {parentLanes.map((lane) =>
        lane === row.lane ? null : (
          <path
            key={`parent-${lane}`}
            d={`M ${commitX} ${midY} C ${commitX} ${midY + 10}, ${xForLane(lane)} ${rowHeight - 10}, ${xForLane(lane)} ${rowHeight}`}
            style={{ stroke: laneColor(lane) }}
          />
        ),
      )}
      <circle
        cx={commitX}
        cy={midY}
        r="4.6"
        style={{ fill: laneColor(row.lane) }}
      />
    </svg>
  );
}

function RefBadge({ refName }: { refName: string }) {
  return (
    <em className={`git-ref-badge ${refKind(refName)}`}>{refLabel(refName)}</em>
  );
}

const GraphCommitRow = memo(function GraphCommitRow({
  row,
  rowIndex,
  rowCount,
  selected,
  showRemoteRefs,
  onSelect,
}: {
  row: GitGraphRow;
  rowIndex: number;
  rowCount: number;
  selected: boolean;
  showRemoteRefs: boolean;
  onSelect: () => void;
}) {
  const { commit } = row;
  const refs = visibleCommitRefs(commit, showRemoteRefs).slice(0, 5);
  return (
    <button
      id={`git-commit-${commit.hash}`}
      className={`git-graph-row ${selected ? "active" : ""}`}
      type="button"
      role="option"
      aria-selected={selected}
      aria-posinset={rowIndex + 1}
      aria-setsize={rowCount}
      onClick={onSelect}
      title={commit.hash}
    >
      <span className="git-graph-cell">
        <GraphSvg row={row} />
      </span>
      <span className="git-graph-description">
        <span className="git-graph-subject">
          <strong>{commit.subject}</strong>
          {refs.length ? (
            <span className="git-ref-list">
              {refs.map((refName) => (
                <RefBadge key={refName} refName={refName} />
              ))}
            </span>
          ) : null}
        </span>
      </span>
      <span className="git-graph-date">
        {formatCommitTime(commit.timestampSeconds)}
      </span>
      <span className="git-graph-author">{commit.author}</span>
      <code className="git-graph-hash">{commit.shortHash}</code>
    </button>
  );
});

function CommitDetail({
  branches,
  commit,
  commitDiff,
  commitDiffLoading,
  currentBranch,
  remotes,
  selectedCommitPath,
  showRemoteRefs,
  onCheckoutBranch,
  onCreateBranch,
  onDeleteBranch,
  onSelectCommitFile,
}: {
  branches: GitBranchSummary[];
  commit: GitCommitSummary | null;
  commitDiff: GitDiffResult | null;
  commitDiffLoading: boolean;
  currentBranch: string | null;
  remotes: GitRemoteSummary[];
  selectedCommitPath: string | null;
  showRemoteRefs: boolean;
  onCheckoutBranch: (branch: string) => void;
  onCreateBranch: (branch: string, startPoint?: string) => void;
  onDeleteBranch: (branch: string) => void;
  onSelectCommitFile: (path: string | null) => void;
}) {
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  if (!commit) {
    return <div className="empty-browser">Select a commit</div>;
  }
  const refs = visibleCommitRefs(commit, showRemoteRefs);
  const remote = remotes.find((item) => item.webUrl);
  const commitUrl = remoteCommitUrl(remote, commit.hash);
  const commitFiles = parseCommitFileSummary(commitDiff?.staged ?? "");
  const localBranches = new Set(branches.map((branch) => branch.name));
  const branchActions: BranchRefAction[] = [];
  for (const refName of refs) {
    const localBranch = localBranchNameFromRef(refName, localBranches);
    if (localBranch) {
      branchActions.push({
        branchName: localBranch,
        current: localBranch === currentBranch,
        kind: "local",
        refName,
      });
      continue;
    }
    const remoteBranch = remoteBranchInfoFromRef(refName);
    if (!remoteBranch) {
      continue;
    }
    branchActions.push({
      branchName: remoteBranch.localBranchName,
      current: remoteBranch.localBranchName === currentBranch,
      kind: "remote",
      localExists: localBranches.has(remoteBranch.localBranchName),
      remoteName: remoteBranch.remoteName,
      refName,
      startPoint: remoteBranch.startPoint,
    });
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setActionMessage(`Copied ${label}`);
    } catch {
      setActionMessage(`Could not copy ${label}`);
    }
  }

  return (
    <div
      className="git-commit-detail"
      style={{ maxHeight: "min(460px, 48vh)" }}
    >
      <strong>{commit.subject}</strong>
      <div className="git-action-row" style={{ justifyContent: "flex-start" }}>
        <button
          className="text-button"
          type="button"
          onClick={() => void copyText(commit.hash, "hash")}
        >
          <Copy size={12} />
          Hash
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => void copyText(commit.subject, "subject")}
        >
          <Copy size={12} />
          Subject
        </button>
        {commitUrl ? (
          <a
            className="text-button"
            href={commitUrl}
            target="_blank"
            rel="noreferrer"
            title={commitUrl}
          >
            <ExternalLink size={12} />
            Remote
          </a>
        ) : (
          <button
            className="text-button"
            type="button"
            disabled
            title="No supported remote commit URL is available"
          >
            <ExternalLink size={12} />
            Remote
          </button>
        )}
        {actionMessage ? (
          <small aria-live="polite">{actionMessage}</small>
        ) : null}
      </div>
      {refs.length ? (
        <div className="git-ref-list detail">
          {refs.map((refName) => (
            <RefBadge key={refName} refName={refName} />
          ))}
        </div>
      ) : null}
      {branchActions.length ? (
        <div style={{ display: "grid", gap: 6 }}>
          {branchActions.map((action) => (
            <div
              className="git-branch-row"
              key={`${action.kind}-${action.refName}`}
            >
              <RefBadge refName={action.refName} />
              {action.kind === "local" ? (
                <>
                  <button
                    className="text-button"
                    type="button"
                    disabled={action.current}
                    onClick={() => onCheckoutBranch(action.branchName)}
                  >
                    <GitBranch size={12} />
                    Checkout
                  </button>
                  <button
                    className="text-button danger"
                    type="button"
                    disabled={action.current}
                    onClick={() => onDeleteBranch(action.branchName)}
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="text-button"
                    type="button"
                    disabled={action.localExists}
                    title={
                      action.localExists
                        ? `${action.branchName} already exists locally`
                        : `Create ${action.branchName} from ${action.refName}`
                    }
                    onClick={() =>
                      onCreateBranch(action.branchName, action.startPoint)
                    }
                  >
                    <GitBranchPlus size={12} />
                    Create
                  </button>
                  {action.localExists ? (
                    <button
                      className="text-button"
                      type="button"
                      disabled={action.current}
                      onClick={() => onCheckoutBranch(action.branchName)}
                    >
                      <GitBranch size={12} />
                      Checkout
                    </button>
                  ) : null}
                  <small>{action.remoteName}</small>
                </>
              )}
            </div>
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
      <div
        className="git-action-row"
        style={{ justifyContent: "space-between" }}
      >
        <strong>Files</strong>
        <button
          className="text-button"
          type="button"
          disabled={!selectedCommitPath}
          onClick={() => onSelectCommitFile(null)}
        >
          All Files
        </button>
      </div>
      {commitDiffLoading ? (
        <div className="empty-browser">Loading commit diff...</div>
      ) : commitFiles.length ? (
        <div style={{ display: "grid", gap: 4 }}>
          {commitFiles.map((file) => (
            <button
              className={`git-file-row ${file.kind} ${
                selectedCommitPath === file.path ? "active" : ""
              }`}
              key={`${file.status}-${file.originalPath ?? ""}-${file.path}`}
              type="button"
              onClick={() => onSelectCommitFile(file.path)}
            >
              <span className="git-file-kind">{changeLabel(file.kind)}</span>
              <span className="git-file-path">
                <span>{file.path}</span>
                {file.originalPath ? <small>{file.originalPath}</small> : null}
              </span>
              <small>{file.status}</small>
            </button>
          ))}
        </div>
      ) : (
        <small>No file summary available</small>
      )}
      <div className="git-diff">
        <pre style={{ maxHeight: 240 }}>
          {commitDiffLoading
            ? "Loading commit diff..."
            : commitDiff?.unstaged.trim() || "No commit diff available"}
        </pre>
      </div>
      {commitDiff?.truncated ? <small>Diff truncated</small> : null}
    </div>
  );
}

function visibleCommitRefs(commit: GitCommitSummary, showRemoteRefs: boolean) {
  const refs = commitRefs(commit);
  if (showRemoteRefs) {
    return refs;
  }
  return refs.filter((refName) => refKind(refName) !== "remote");
}

const refFilterOptions: Array<{
  value: GitGraphRefFilter;
  label: string;
}> = [
  { value: "all", label: "Show All" },
  { value: "branches", label: "Local Branches" },
  { value: "remotes", label: "Remote Branches" },
  { value: "tags", label: "Tags" },
];

export function GitGraphView({
  branches,
  commitDiff,
  commitDiffLoading,
  commits,
  currentBranch,
  query,
  refFilter,
  remotes,
  selectedCommitPath,
  selectedCommitHash,
  loading,
  onCheckoutBranch,
  onCreateBranch,
  onDeleteBranch,
  onQueryChange,
  onRefFilterChange,
  onSelectCommit,
  onSelectCommitFile,
}: {
  branches: GitBranchSummary[];
  commitDiff: GitDiffResult | null;
  commitDiffLoading: boolean;
  commits: GitCommitSummary[];
  currentBranch: string | null;
  query: string;
  refFilter: GitGraphRefFilter;
  remotes: GitRemoteSummary[];
  selectedCommitPath: string | null;
  selectedCommitHash: string | null;
  loading: boolean;
  onCheckoutBranch: (branch: string) => void;
  onCreateBranch: (branch: string, startPoint?: string) => void;
  onDeleteBranch: (branch: string) => void;
  onQueryChange: (query: string) => void;
  onRefFilterChange: (refFilter: GitGraphRefFilter) => void;
  onSelectCommit: (hash: string) => void;
  onSelectCommitFile: (path: string | null) => void;
}) {
  const [showRemoteRefs, setShowRemoteRefs] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const filteredCommits = useMemo(
    () => filterGraphCommits(commits, query, refFilter),
    [commits, query, refFilter],
  );
  const graphRows = useMemo(
    () => buildGitGraphRows(filteredCommits),
    [filteredCommits],
  );
  const selectedCommit = useMemo(
    () =>
      filteredCommits.find((commit) => commit.hash === selectedCommitHash) ??
      filteredCommits[0] ??
      null,
    [filteredCommits, selectedCommitHash],
  );
  const activeCommitHash = selectedCommit?.hash ?? null;
  const virtualWindow = useMemo(() => {
    const rowCount = graphRows.length;
    const measuredViewport = viewportHeight || gitGraphRowHeight * 24;
    const visibleRows = Math.ceil(measuredViewport / gitGraphRowHeight);
    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / gitGraphRowHeight) - gitGraphOverscanRows,
    );
    const endIndex = Math.min(
      rowCount,
      startIndex + visibleRows + gitGraphOverscanRows * 2,
    );
    return {
      endIndex,
      offsetTop: startIndex * gitGraphRowHeight,
      rows: graphRows.slice(startIndex, endIndex),
      startIndex,
      totalHeight: rowCount * gitGraphRowHeight,
    };
  }, [graphRows, scrollTop, viewportHeight]);
  const activeCommitRendered = virtualWindow.rows.some(
    (row) => row.commit.hash === activeCommitHash,
  );

  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    const updateViewportHeight = () => setViewportHeight(node.clientHeight);
    updateViewportHeight();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewportHeight);
      return () => window.removeEventListener("resize", updateViewportHeight);
    }
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = 0;
    setScrollTop(0);
  }, [query, refFilter]);

  useEffect(() => {
    if (!activeCommitHash) {
      return;
    }
    scrollCommitIntoView(activeCommitHash);
  }, [activeCommitHash, filteredCommits]);

  useEffect(() => {
    if (activeCommitHash && activeCommitHash !== selectedCommitHash) {
      onSelectCommit(activeCommitHash);
    }
  }, [activeCommitHash, onSelectCommit, selectedCommitHash]);

  function onGraphScroll(event: UIEvent<HTMLDivElement>) {
    setScrollTop(event.currentTarget.scrollTop);
  }

  function scrollCommitIntoView(hash: string) {
    const node = listRef.current;
    if (!node) {
      return;
    }
    const index = filteredCommits.findIndex((commit) => commit.hash === hash);
    if (index < 0) {
      return;
    }
    const rowTop = index * gitGraphRowHeight;
    const rowBottom = rowTop + gitGraphRowHeight;
    if (rowTop < node.scrollTop) {
      node.scrollTop = rowTop;
    } else if (rowBottom > node.scrollTop + node.clientHeight) {
      node.scrollTop = Math.max(0, rowBottom - node.clientHeight);
    }
  }

  function onGraphKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const navigation =
      event.key === "ArrowUp"
        ? "previous"
        : event.key === "ArrowDown"
          ? "next"
          : event.key === "Home"
            ? "first"
            : event.key === "End"
              ? "last"
              : null;
    if (!navigation) {
      return;
    }
    const nextHash = nextGraphCommitHash(
      filteredCommits,
      activeCommitHash,
      navigation,
    );
    if (!nextHash) {
      return;
    }
    event.preventDefault();
    onSelectCommit(nextHash);
    window.requestAnimationFrame(() => scrollCommitIntoView(nextHash));
  }

  return (
    <section className="git-section git-graph-section">
      <div className="git-graph-toolbar">
        <div className="git-section-title">
          <strong>Git Graph</strong>
          <span>
            {filteredCommits.length}/{commits.length}
          </span>
        </div>
        <label className="git-graph-filter">
          <span>Branches:</span>
          <select
            value={refFilter}
            onChange={(event) =>
              onRefFilterChange(event.currentTarget.value as GitGraphRefFilter)
            }
          >
            {refFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="git-graph-controls">
        <label className="git-graph-search">
          <Search size={13} />
          <input
            value={query}
            placeholder="Search commits, refs, authors"
            onChange={(event) => onQueryChange(event.currentTarget.value)}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear graph search"
              onClick={() => onQueryChange("")}
            >
              <X size={12} />
            </button>
          ) : null}
        </label>
        <label className="git-graph-remote-toggle">
          <input
            type="checkbox"
            checked={showRemoteRefs}
            onChange={(event) => setShowRemoteRefs(event.currentTarget.checked)}
          />
          <span>Show Remote Branches</span>
        </label>
      </div>
      <div className="git-graph-layout">
        <div className="git-graph-table">
          <div className="git-graph-header" aria-hidden="true">
            <span>Graph</span>
            <span>Description</span>
            <span>Date</span>
            <span>Author</span>
            <span>Commit</span>
          </div>
          <div
            className="git-graph-list"
            tabIndex={0}
            role="listbox"
            aria-label="Git commit graph"
            aria-activedescendant={
              activeCommitHash && activeCommitRendered
                ? `git-commit-${activeCommitHash}`
                : undefined
            }
            onKeyDown={onGraphKeyDown}
            onScroll={onGraphScroll}
            ref={listRef}
          >
            {graphRows.length ? (
              <div
                className="git-graph-virtual-space"
                style={{ height: virtualWindow.totalHeight }}
              >
                <div
                  className="git-graph-virtual-rows"
                  style={{
                    transform: `translateY(${virtualWindow.offsetTop}px)`,
                  }}
                >
                  {virtualWindow.rows.map((row, index) => {
                    const rowIndex = virtualWindow.startIndex + index;
                    return (
                      <GraphCommitRow
                        key={row.commit.hash}
                        row={row}
                        rowIndex={rowIndex}
                        rowCount={graphRows.length}
                        selected={activeCommitHash === row.commit.hash}
                        showRemoteRefs={showRemoteRefs}
                        onSelect={() => onSelectCommit(row.commit.hash)}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="empty-browser">
                {loading ? "Loading Git graph..." : "No commits found"}
              </div>
            )}
          </div>
        </div>
        <CommitDetail
          branches={branches}
          commit={selectedCommit}
          commitDiff={commitDiff}
          commitDiffLoading={commitDiffLoading}
          currentBranch={currentBranch}
          remotes={remotes}
          selectedCommitPath={selectedCommitPath}
          showRemoteRefs={showRemoteRefs}
          onCheckoutBranch={onCheckoutBranch}
          onCreateBranch={onCreateBranch}
          onDeleteBranch={onDeleteBranch}
          onSelectCommitFile={onSelectCommitFile}
        />
      </div>
    </section>
  );
}
