import type { GitChangeKind, GitCommitSummary } from "../../generated/irodori-api";

export function changeLabel(kind: GitChangeKind) {
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

export function formatCommitTime(value: bigint) {
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

export function branchSummary(
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

export function commitRefs(commit: GitCommitSummary) {
  return commit.refs ?? [];
}

export function refKind(ref: string) {
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

export function refLabel(ref: string) {
  return ref.replace(/^tag: /, "").replace(/^HEAD -> /, "");
}
