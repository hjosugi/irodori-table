import { useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import type { GitCommitSummary } from "../../generated/irodori-api";
import {
  buildGitGraphRows,
  filterGraphCommits,
  nextGraphCommitHash,
  type GitGraphRefFilter,
  type GitGraphRow,
} from "./git-graph";
import { commitRefs, formatCommitTime, refKind, refLabel } from "./git-format";

const graphLaneColors = [
  "#20a4f3",
  "#b877db",
  "#f59e0b",
  "#34c759",
  "#ff5d73",
  "#00b8a9",
];

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
      <circle cx={commitX} cy={midY} r="4.6" style={{ fill: laneColor(row.lane) }} />
    </svg>
  );
}

function RefBadge({ refName }: { refName: string }) {
  return <em className={`git-ref-badge ${refKind(refName)}`}>{refLabel(refName)}</em>;
}

function GraphCommitRow({
  row,
  selected,
  showRemoteRefs,
  onSelect,
}: {
  row: GitGraphRow;
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
      <span className="git-graph-date">{formatCommitTime(commit.timestampSeconds)}</span>
      <span className="git-graph-author">{commit.author}</span>
      <code className="git-graph-hash">{commit.shortHash}</code>
    </button>
  );
}

function CommitDetail({
  commit,
  showRemoteRefs,
}: {
  commit: GitCommitSummary | null;
  showRemoteRefs: boolean;
}) {
  if (!commit) {
    return <div className="empty-browser">Select a commit</div>;
  }
  const refs = visibleCommitRefs(commit, showRemoteRefs);

  return (
    <div className="git-commit-detail">
      <strong>{commit.subject}</strong>
      {refs.length ? (
        <div className="git-ref-list detail">
          {refs.map((refName) => (
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
  const [showRemoteRefs, setShowRemoteRefs] = useState(true);
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
      <div className="git-graph-toolbar">
        <div className="git-section-title">
          <strong>Git Graph</strong>
          <span>{filteredCommits.length}/{commits.length}</span>
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
                  showRemoteRefs={showRemoteRefs}
                  onSelect={() => onSelectCommit(row.commit.hash)}
                />
              ))
            ) : (
              <div className="empty-browser">
                {loading ? "Loading Git graph..." : "No commits found"}
              </div>
            )}
          </div>
        </div>
        <CommitDetail commit={selectedCommit} showRemoteRefs={showRemoteRefs} />
      </div>
    </section>
  );
}
