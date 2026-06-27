import type { GitCommitSummary } from "../../generated/irodori-api";
import { refKind } from "./git-format";

export type GitGraphRefFilter = "all" | "branches" | "remotes" | "tags";

export type GitGraphNavigation = "previous" | "next" | "first" | "last";

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
  refFilter: GitGraphRefFilter = "all",
): GitCommitSummary[] {
  const normalized = query.trim().toLowerCase();
  return commits.filter(
    (commit) =>
      matchesRefFilter(commit, refFilter) &&
      (!normalized || searchableCommitText(commit).includes(normalized)),
  );
}

export function nextGraphCommitHash(
  commits: readonly GitCommitSummary[],
  selectedHash: string | null,
  navigation: GitGraphNavigation,
): string | null {
  if (commits.length === 0) {
    return null;
  }

  const selectedIndex = commits.findIndex((commit) => commit.hash === selectedHash);
  const currentIndex = selectedIndex < 0 ? 0 : selectedIndex;
  const nextIndex = graphNavigationIndex(
    currentIndex,
    commits.length,
    navigation,
  );
  return commits[nextIndex]?.hash ?? null;
}

function graphNavigationIndex(
  currentIndex: number,
  count: number,
  navigation: GitGraphNavigation,
): number {
  switch (navigation) {
    case "first":
      return 0;
    case "last":
      return count - 1;
    case "previous":
      return Math.max(0, currentIndex - 1);
    case "next":
      return Math.min(count - 1, currentIndex + 1);
  }
}

function searchableCommitText(commit: GitCommitSummary): string {
  return [
    commit.hash,
    commit.shortHash,
    commit.author,
    commit.subject,
    ...(commit.refs ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function matchesRefFilter(
  commit: GitCommitSummary,
  refFilter: GitGraphRefFilter,
): boolean {
  if (refFilter === "all") {
    return true;
  }

  const kinds = (commit.refs ?? []).map(refKind);
  if (refFilter === "branches") {
    return kinds.some((kind) => kind === "head" || kind === "branch");
  }
  if (refFilter === "remotes") {
    return kinds.includes("remote");
  }
  return kinds.includes("tag");
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
