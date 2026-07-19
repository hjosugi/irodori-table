import type {
  GitChangeKind,
  GitCommitSummary,
  GitRemoteProvider,
  GitRemoteSummary,
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

export type RemoteNames = ReadonlySet<string> | readonly string[];

/**
 * Classify a `%D` decoration ref. Local branches are emitted bare (including
 * names containing `/`, e.g. `feature/login`), while remote-tracking refs are
 * prefixed with the remote name (`origin/main`) — so a ref is remote iff its
 * first path segment is a known remote name, not merely because it has a `/`.
 */
export function refKind(ref: string, remoteNames: RemoteNames = []) {
  if (ref.startsWith("tag: ")) {
    return "tag";
  }
  if (ref.startsWith("HEAD -> ")) {
    return "head";
  }
  const separator = ref.indexOf("/");
  if (separator > 0 && hasName(remoteNames, ref.slice(0, separator))) {
    return "remote";
  }
  return "branch";
}

export function refLabel(ref: string) {
  return ref.replace(/^tag: /, "").replace(/^HEAD -> /, "");
}

export function localBranchNameFromRef(
  ref: string,
  localBranches: ReadonlySet<string> | readonly string[] = [],
  remoteNames: RemoteNames = [],
) {
  const label = refLabel(ref).trim();
  if (label && hasName(localBranches, label)) {
    return label;
  }
  const kind = refKind(ref, remoteNames);
  if (kind !== "head" && kind !== "branch") {
    return null;
  }
  return label && !label.includes(" -> ") ? label : null;
}

export function remoteBranchInfoFromRef(
  ref: string,
  remoteNames: RemoteNames = [],
) {
  if (refKind(ref, remoteNames) !== "remote") {
    return null;
  }
  const label = refLabel(ref).trim();
  if (!label || label.includes(" -> ")) {
    return null;
  }
  const [remoteName, ...branchParts] = label.split("/");
  const branchName = branchParts.join("/");
  if (!remoteName || !branchName) {
    return null;
  }
  return {
    branchName,
    localBranchName: branchName,
    remoteName,
    startPoint: label,
  };
}

export function remoteCommitUrl(
  remote: Pick<GitRemoteSummary, "provider" | "webUrl"> | null | undefined,
  hash: string | null | undefined,
) {
  const webUrl = remote?.webUrl?.trim();
  const provider = remote?.provider;
  const commitHash = hash?.trim();
  if (!webUrl || !provider || !commitHash) {
    return null;
  }

  switch (provider) {
    case "github":
    case "azureRepos":
    case "gitea":
      return appendRemotePath(webUrl, `commit/${commitHash}`);
    case "gitlab":
      return appendRemotePath(webUrl, `-/commit/${commitHash}`);
    case "bitbucket":
      return appendRemotePath(webUrl, `commits/${commitHash}`);
    case "codeCommit":
      return appendRemotePath(webUrl, `commit/${commitHash}`);
    default:
      return null;
  }
}

function appendRemotePath(webUrl: string, suffix: string) {
  try {
    const url = new URL(webUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
    return url.toString();
  } catch {
    const [base, query = ""] = webUrl.split("?", 2);
    return `${base.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}${
      query ? `?${query}` : ""
    }`;
  }
}

function hasName(names: ReadonlySet<string> | readonly string[], name: string) {
  if ("has" in names) {
    return names.has(name);
  }
  return names.includes(name);
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
