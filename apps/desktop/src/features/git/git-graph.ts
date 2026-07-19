import type {
  GitChangeKind,
  GitCommitSummary,
} from "../../generated/irodori-api";
import { refKind, type RemoteNames } from "./git-format";

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

export type GitCommitFileSummary = {
  path: string;
  originalPath?: string;
  status: string;
  kind: GitChangeKind;
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
  remoteNames: RemoteNames = [],
): GitCommitSummary[] {
  const normalized = query.trim().toLowerCase();
  return commits.filter(
    (commit) =>
      matchesRefFilter(commit, refFilter, remoteNames) &&
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

  const selectedIndex = commits.findIndex(
    (commit) => commit.hash === selectedHash,
  );
  const currentIndex = selectedIndex < 0 ? 0 : selectedIndex;
  const nextIndex = graphNavigationIndex(
    currentIndex,
    commits.length,
    navigation,
  );
  return commits[nextIndex]?.hash ?? null;
}

export function parseCommitFileSummary(text: string): GitCommitFileSummary[] {
  return text
    .split(/\r?\n/)
    .map((line) => parseNameStatusLine(line))
    .filter((file): file is GitCommitFileSummary => file !== null);
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

function parseNameStatusLine(line: string): GitCommitFileSummary | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("[diff truncated]")) {
    return null;
  }
  const [status = "", firstPath = "", secondPath = ""] = trimmed.split("\t");
  const statusKind = status.charAt(0);
  const renamedOrCopied = statusKind === "R" || statusKind === "C";
  const path = renamedOrCopied ? secondPath : firstPath;
  if (!status || !path) {
    return null;
  }
  const summary: GitCommitFileSummary = {
    path,
    status,
    kind: nameStatusKind(statusKind),
  };
  if (renamedOrCopied && firstPath) {
    summary.originalPath = firstPath;
  }
  return summary;
}

function nameStatusKind(status: string): GitChangeKind {
  switch (status) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "unmerged";
    case "T":
      return "typeChanged";
    case "M":
      return "modified";
    default:
      return "unknown";
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
  remoteNames: RemoteNames,
): boolean {
  if (refFilter === "all") {
    return true;
  }

  const kinds = (commit.refs ?? []).map((ref) => refKind(ref, remoteNames));
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
