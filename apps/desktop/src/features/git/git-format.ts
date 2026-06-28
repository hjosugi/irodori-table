import type {
  GitChangeKind,
  GitCommitSummary,
  GitRemoteProvider,
} from "../../generated/irodori-api";

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

export function providerLabel(provider: GitRemoteProvider | undefined) {
  switch (provider) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    case "azureRepos":
      return "Azure Repos";
    case "codeCommit":
      return "AWS CodeCommit";
    case "gitea":
      return "Gitea";
    default:
      return "Git";
  }
}

export function providerDefaultColor(provider: GitRemoteProvider | undefined) {
  switch (provider) {
    case "github":
      return "#24292f";
    case "gitlab":
      return "#fc6d26";
    case "bitbucket":
      return "#0052cc";
    case "azureRepos":
      return "#0078d4";
    case "codeCommit":
      return "#ff9900";
    case "gitea":
      return "#609926";
    default:
      return "#6b7280";
  }
}

export function normalizeHexColor(
  value: string | undefined,
  fallback = "#6b7280",
) {
  const raw = (value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toLowerCase();
  }
  const short = /^#([0-9a-fA-F]{3})$/.exec(raw);
  if (short) {
    return `#${short[1]
      .split("")
      .map((char) => char + char)
      .join("")}`.toLowerCase();
  }
  return fallback;
}

export function gitAccentColor(
  provider: GitRemoteProvider | undefined,
  customColor: string | undefined,
) {
  return normalizeHexColor(customColor, providerDefaultColor(provider));
}
