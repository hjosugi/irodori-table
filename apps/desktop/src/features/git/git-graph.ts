import type { GitCommitSummary } from "../../generated/irodori-api";

export type GitGraphRow = {
  commit: GitCommitSummary;
  lane: number;
  before: string[];
  after: string[];
  parentLanes: number[];
  laneCount: number;
};

export function buildGitGraphRows(commits: GitCommitSummary[]): GitGraphRow[] {
  let lanes: string[] = [];

  return commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) {
      lane = lanes.length;
      lanes = [...lanes, commit.hash];
    }

    const before = [...lanes];
    const parents = commit.parents ?? [];
    const next = [...lanes];

    if (parents.length === 0) {
      next.splice(lane, 1);
    } else {
      next[lane] = parents[0];
      let insertAt = lane + 1;
      for (const parent of parents.slice(1)) {
        if (!next.includes(parent)) {
          next.splice(insertAt, 0, parent);
          insertAt += 1;
        }
      }
      dedupeLanes(next);
    }

    const after = [...next];
    const parentLanes = parents
      .map((parent) => after.indexOf(parent))
      .filter((index) => index >= 0);
    const laneCount = Math.max(before.length, after.length, lane + 1, 1);
    lanes = next;

    return {
      commit,
      lane,
      before,
      after,
      parentLanes,
      laneCount,
    };
  });
}

export function filterGraphCommits(
  commits: GitCommitSummary[],
  query: string,
): GitCommitSummary[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return commits;
  }
  return commits.filter((commit) =>
    [
      commit.hash,
      commit.shortHash,
      commit.author,
      commit.subject,
      ...(commit.refs ?? []),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

function dedupeLanes(lanes: string[]) {
  for (let index = 0; index < lanes.length; index += 1) {
    const first = lanes.indexOf(lanes[index]);
    if (first !== index) {
      lanes.splice(index, 1);
      index -= 1;
    }
  }
}
