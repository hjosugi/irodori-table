import type { KeyboardEvent } from "react";
import { GitBranch, GitFork, Search, Tag, X } from "lucide-react";
import type { GitCommitSummary } from "../../generated/irodori-api";
import {
  buildGitGraphRows,
  filterGraphCommits,
  nextGraphCommitHash,
  type GitGraphRefFilter,
  type GitGraphRow,
} from "./git-graph";
import { commitRefs, formatCommitTime, refKind, refLabel } from "./git-format";

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
      id={`git-commit-${commit.hash}`}
      className={`git-graph-row ${selected ? "active" : ""}`}
      type="button"
      role="option"
      aria-selected={selected}
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

const refFilterOptions: Array<{
  value: GitGraphRefFilter;
  label: string;
  icon: typeof GitFork;
}> = [
  { value: "all", label: "All", icon: GitFork },
  { value: "branches", label: "Branches", icon: GitBranch },
  { value: "remotes", label: "Remotes", icon: GitFork },
  { value: "tags", label: "Tags", icon: Tag },
];

export function GitGraphView({
  commits,
  query,
  refFilter,
  selectedCommitHash,
  loading,
  onQueryChange,
  onRefFilterChange,
  onSelectCommit,
}: {
  commits: GitCommitSummary[];
  query: string;
  refFilter: GitGraphRefFilter;
  selectedCommitHash: string | null;
  loading: boolean;
  onQueryChange: (query: string) => void;
  onRefFilterChange: (refFilter: GitGraphRefFilter) => void;
  onSelectCommit: (hash: string) => void;
}) {
  const filteredCommits = filterGraphCommits(commits, query, refFilter);
  const graphRows = buildGitGraphRows(filteredCommits);
  const selectedCommit =
    filteredCommits.find((commit) => commit.hash === selectedCommitHash) ??
    filteredCommits[0] ??
    null;
  const activeCommitHash = selectedCommit?.hash ?? null;

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
  }

  return (
    <section className="git-section git-graph-section">
      <div className="git-section-title">
        <strong>Graph</strong>
        <span>{filteredCommits.length}/{commits.length}</span>
      </div>
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
      <div className="segmented-control git-ref-filter" aria-label="Git ref filter">
        {refFilterOptions.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              className={refFilter === option.value ? "active" : undefined}
              type="button"
              title={`Show ${option.label.toLowerCase()} commits`}
              aria-pressed={refFilter === option.value}
              onClick={() => onRefFilterChange(option.value)}
            >
              <Icon size={13} />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
      <div className="git-graph-layout">
        <div
          className="git-graph-list"
          tabIndex={0}
          role="listbox"
          aria-label="Git commit graph"
          aria-activedescendant={
            activeCommitHash ? `git-commit-${activeCommitHash}` : undefined
          }
          onKeyDown={onGraphKeyDown}
        >
          {graphRows.length ? (
            graphRows.map((row) => (
              <GraphCommitRow
                key={row.commit.hash}
                row={row}
                selected={activeCommitHash === row.commit.hash}
                onSelect={() => onSelectCommit(row.commit.hash)}
              />
            ))
          ) : (
            <div className="empty-browser">
              {loading ? "Loading Git graph..." : "No commits found"}
            </div>
          )}
        </div>
        <CommitDetail commit={selectedCommit} />
      </div>
    </section>
  );
}
