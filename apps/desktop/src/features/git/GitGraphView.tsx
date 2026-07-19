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
import type { Translator } from "@/i18n";
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
  type RemoteNames,
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

function RefBadge({
  refName,
  remoteNames,
}: {
  refName: string;
  remoteNames: RemoteNames;
}) {
  return (
    <em className={`git-ref-badge ${refKind(refName, remoteNames)}`}>
      {refLabel(refName)}
    </em>
  );
}

const GraphCommitRow = memo(function GraphCommitRow({
  row,
  rowIndex,
  rowCount,
  selected,
  showRemoteRefs,
  remoteNames,
  onSelect,
}: {
  row: GitGraphRow;
  rowIndex: number;
  rowCount: number;
  selected: boolean;
  showRemoteRefs: boolean;
  remoteNames: RemoteNames;
  onSelect: () => void;
}) {
  const { commit } = row;
  const refs = visibleCommitRefs(commit, showRemoteRefs, remoteNames).slice(
    0,
    5,
  );
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
                <RefBadge
                  key={refName}
                  refName={refName}
                  remoteNames={remoteNames}
                />
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
  t,
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
  t: Translator["t"];
}) {
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  if (!commit) {
    return <div className="empty-browser">{t("git.selectCommit")}</div>;
  }
  const remoteNames = new Set(remotes.map((item) => item.name));
  const refs = visibleCommitRefs(commit, showRemoteRefs, remoteNames);
  const remote = remotes.find((item) => item.webUrl);
  const commitUrl = remoteCommitUrl(remote, commit.hash);
  const commitFiles = parseCommitFileSummary(commitDiff?.staged ?? "");
  const localBranches = new Set(branches.map((branch) => branch.name));
  const branchActions: BranchRefAction[] = [];
  for (const refName of refs) {
    const localBranch = localBranchNameFromRef(
      refName,
      localBranches,
      remoteNames,
    );
    if (localBranch) {
      branchActions.push({
        branchName: localBranch,
        current: localBranch === currentBranch,
        kind: "local",
        refName,
      });
      continue;
    }
    const remoteBranch = remoteBranchInfoFromRef(refName, remoteNames);
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
      setActionMessage(t("git.copied", { label }));
    } catch {
      setActionMessage(t("git.copyFailed", { label }));
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
          onClick={() => void copyText(commit.hash, t("git.hash"))}
        >
          <Copy size={12} />
          {t("git.hash")}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => void copyText(commit.subject, t("git.subject"))}
        >
          <Copy size={12} />
          {t("git.subject")}
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
            {t("git.remote")}
          </a>
        ) : (
          <button
            className="text-button"
            type="button"
            disabled
            title={t("git.noRemoteCommitUrl")}
          >
            <ExternalLink size={12} />
            {t("git.remote")}
          </button>
        )}
        {actionMessage ? (
          <small aria-live="polite">{actionMessage}</small>
        ) : null}
      </div>
      {refs.length ? (
        <div className="git-ref-list detail">
          {refs.map((refName) => (
            <RefBadge
              key={refName}
              refName={refName}
              remoteNames={remoteNames}
            />
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
              <RefBadge refName={action.refName} remoteNames={remoteNames} />
              {action.kind === "local" ? (
                <>
                  <button
                    className="text-button"
                    type="button"
                    disabled={action.current}
                    onClick={() => onCheckoutBranch(action.branchName)}
                  >
                    <GitBranch size={12} />
                    {t("git.actions.checkout")}
                  </button>
                  <button
                    className="text-button danger"
                    type="button"
                    disabled={action.current}
                    onClick={() => onDeleteBranch(action.branchName)}
                  >
                    <Trash2 size={12} />
                    {t("common.delete")}
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
                        ? t("git.localBranchExists", {
                            branch: action.branchName,
                          })
                        : t("git.createBranchFrom", {
                            branch: action.branchName,
                            ref: action.refName,
                          })
                    }
                    onClick={() =>
                      onCreateBranch(action.branchName, action.startPoint)
                    }
                  >
                    <GitBranchPlus size={12} />
                    {t("git.actions.create")}
                  </button>
                  {action.localExists ? (
                    <button
                      className="text-button"
                      type="button"
                      disabled={action.current}
                      onClick={() => onCheckoutBranch(action.branchName)}
                    >
                      <GitBranch size={12} />
                      {t("git.actions.checkout")}
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
          <dt>{t("git.hash")}</dt>
          <dd>{commit.hash}</dd>
        </div>
        <div>
          <dt>{t("git.author")}</dt>
          <dd>{commit.author}</dd>
        </div>
        <div>
          <dt>{t("git.date")}</dt>
          <dd>{formatCommitTime(commit.timestampSeconds)}</dd>
        </div>
        <div>
          <dt>{t("git.parents")}</dt>
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
        <strong>{t("git.files")}</strong>
        <button
          className="text-button"
          type="button"
          disabled={!selectedCommitPath}
          onClick={() => onSelectCommitFile(null)}
        >
          {t("git.allFiles")}
        </button>
      </div>
      {commitDiffLoading ? (
        <div className="empty-browser">{t("git.loadingCommitDiff")}</div>
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
        <small>{t("git.noFileSummary")}</small>
      )}
      <div className="git-diff">
        <pre style={{ maxHeight: 240 }}>
          {commitDiffLoading
            ? t("git.loadingCommitDiff")
            : commitDiff?.unstaged.trim() || t("git.noCommitDiff")}
        </pre>
      </div>
      {commitDiff?.truncated ? <small>{t("git.diffTruncated")}</small> : null}
    </div>
  );
}

function visibleCommitRefs(
  commit: GitCommitSummary,
  showRemoteRefs: boolean,
  remoteNames: RemoteNames,
) {
  const refs = commitRefs(commit);
  if (showRemoteRefs) {
    return refs;
  }
  return refs.filter((refName) => refKind(refName, remoteNames) !== "remote");
}

const refFilterOptions: Array<{
  value: GitGraphRefFilter;
}> = [
  { value: "all" },
  { value: "branches" },
  { value: "remotes" },
  { value: "tags" },
];

const refFilterLabelKeys: Record<
  GitGraphRefFilter,
  Parameters<Translator["t"]>[0]
> = {
  all: "git.refFilter.all",
  branches: "git.refFilter.branches",
  remotes: "git.refFilter.remotes",
  tags: "git.refFilter.tags",
};

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
  t,
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
  t: Translator["t"];
}) {
  const [showRemoteRefs, setShowRemoteRefs] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const remoteNames = useMemo(
    () => new Set(remotes.map((remote) => remote.name)),
    [remotes],
  );
  const filteredCommits = useMemo(
    () => filterGraphCommits(commits, query, refFilter, remoteNames),
    [commits, query, refFilter, remoteNames],
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
          <strong>{t("git.graph")}</strong>
          <span>
            {filteredCommits.length}/{commits.length}
          </span>
        </div>
        <label className="git-graph-filter">
          <span>{t("git.branches")}:</span>
          <select
            value={refFilter}
            onChange={(event) =>
              onRefFilterChange(event.currentTarget.value as GitGraphRefFilter)
            }
          >
            {refFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(refFilterLabelKeys[option.value])}
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
            placeholder={t("git.searchPlaceholder")}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
          />
          {query ? (
            <button
              type="button"
              aria-label={t("git.clearGraphSearch")}
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
          <span>{t("git.showRemoteBranches")}</span>
        </label>
      </div>
      <div className="git-graph-layout">
        <div className="git-graph-table">
          <div className="git-graph-header" aria-hidden="true">
            <span>{t("git.graph")}</span>
            <span>{t("git.description")}</span>
            <span>{t("git.date")}</span>
            <span>{t("git.author")}</span>
            <span>{t("git.commit")}</span>
          </div>
          <div
            className="git-graph-list"
            tabIndex={0}
            role="listbox"
            aria-label={t("git.commitGraph")}
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
                        remoteNames={remoteNames}
                        onSelect={() => onSelectCommit(row.commit.hash)}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="empty-browser">
                {loading ? t("git.loadingGraph") : t("git.noCommits")}
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
          t={t}
        />
      </div>
    </section>
  );
}
