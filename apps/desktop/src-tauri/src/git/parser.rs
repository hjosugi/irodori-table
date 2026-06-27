use super::{
    GitBranchSummary, GitChangeKind, GitCommitSummary, GitFileStatus, GitRemoteProvider,
    GitRemoteSummary,
};

pub(super) fn parse_status(text: &str) -> (String, Option<String>, u32, u32, Vec<GitFileStatus>) {
    let mut branch = "unknown".to_string();
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut files = Vec::new();

    for line in text.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            let parsed = parse_branch_header(header);
            branch = parsed.0;
            upstream = parsed.1;
            ahead = parsed.2;
            behind = parsed.3;
            continue;
        }

        if let Some(file) = parse_status_line(line) {
            files.push(file);
        }
    }

    (branch, upstream, ahead, behind, files)
}

pub(super) fn parse_remotes(text: &str) -> Vec<GitRemoteSummary> {
    let mut remotes: Vec<GitRemoteSummary> = Vec::new();
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let Some(name) = parts.next() else {
            continue;
        };
        let Some(url) = parts.next() else {
            continue;
        };
        let kind = parts.next().unwrap_or_default();
        let existing = remotes.iter_mut().find(|remote| remote.name == name);
        match existing {
            Some(remote) => {
                if kind == "(fetch)" {
                    remote.fetch_url = url.to_string();
                    remote.provider = remote_provider(url);
                    remote.web_url = remote_web_url(url);
                } else if kind == "(push)" {
                    remote.push_url = Some(url.to_string());
                }
            }
            None => {
                remotes.push(GitRemoteSummary {
                    name: name.to_string(),
                    fetch_url: url.to_string(),
                    push_url: (kind == "(push)").then(|| url.to_string()),
                    provider: remote_provider(url),
                    web_url: remote_web_url(url),
                });
            }
        }
    }
    remotes
}

pub(super) fn remote_provider(url: &str) -> GitRemoteProvider {
    let normalized = url.to_lowercase();
    if normalized.contains("github.com") {
        GitRemoteProvider::Github
    } else if normalized.contains("gitlab.") || normalized.contains("gitlab.com") {
        GitRemoteProvider::Gitlab
    } else if normalized.contains("bitbucket.") || normalized.contains("bitbucket.org") {
        GitRemoteProvider::Bitbucket
    } else if normalized.contains("dev.azure.com") || normalized.contains("visualstudio.com") {
        GitRemoteProvider::AzureRepos
    } else if normalized.contains("codecommit") || normalized.contains("git-codecommit") {
        GitRemoteProvider::CodeCommit
    } else if normalized.contains("gitea") {
        GitRemoteProvider::Gitea
    } else {
        GitRemoteProvider::Generic
    }
}

pub(super) fn remote_web_url(url: &str) -> Option<String> {
    let provider = remote_provider(url);
    match provider {
        GitRemoteProvider::CodeCommit => codecommit_web_url(url),
        GitRemoteProvider::AzureRepos => azure_repos_web_url(url),
        _ => generic_git_web_url(url),
    }
}

pub(super) fn generic_git_web_url(url: &str) -> Option<String> {
    let normalized = strip_git_suffix(&strip_credentials(url.trim()));
    if normalized.starts_with("http://") || normalized.starts_with("https://") {
        return Some(normalized);
    }

    if let Some((user_host, path)) = normalized.split_once(':') {
        if user_host.contains('@') && !path.starts_with('/') {
            let host = user_host.rsplit('@').next()?.trim();
            if !host.is_empty() && !path.is_empty() {
                return Some(format!("https://{host}/{}", path.trim_start_matches('/')));
            }
        }
    }

    if let Some(rest) = normalized.strip_prefix("ssh://") {
        let rest = rest.split('@').next_back().unwrap_or(rest);
        let rest = rest.trim_start_matches('/');
        if !rest.is_empty() {
            return Some(format!("https://{rest}"));
        }
    }

    None
}

pub(super) fn azure_repos_web_url(url: &str) -> Option<String> {
    let normalized = strip_git_suffix(&strip_credentials(url.trim()));
    if normalized.starts_with("http://") || normalized.starts_with("https://") {
        return Some(normalized);
    }
    if let Some(path) = normalized.strip_prefix("git@ssh.dev.azure.com:v3/") {
        let mut parts = path.split('/');
        let org = parts.next()?;
        let project = parts.next()?;
        let repo = parts.next()?;
        return Some(format!("https://dev.azure.com/{org}/{project}/_git/{repo}"));
    }
    None
}

pub(super) fn codecommit_web_url(url: &str) -> Option<String> {
    let normalized = strip_git_suffix(&strip_credentials(url.trim()));
    let region = normalized
        .split("git-codecommit.")
        .nth(1)
        .and_then(|tail| tail.split('.').next())
        .or_else(|| {
            normalized
                .split("codecommit.")
                .nth(1)
                .and_then(|tail| tail.split('.').next())
        })?;
    let repo = normalized
        .rsplit("/v1/repos/")
        .next()
        .filter(|value| !value.is_empty())?;
    Some(format!(
        "https://{region}.console.aws.amazon.com/codesuite/codecommit/repositories/{repo}/browse?region={region}"
    ))
}

pub(super) fn strip_credentials(url: &str) -> String {
    if let Some((scheme, rest)) = url.split_once("://") {
        if let Some((_, after_at)) = rest.split_once('@') {
            return format!("{scheme}://{after_at}");
        }
    }
    url.to_string()
}

pub(super) fn strip_git_suffix(url: &str) -> String {
    url.strip_suffix(".git").unwrap_or(url).to_string()
}

pub(super) fn parse_branch_line(line: &str) -> Option<GitBranchSummary> {
    let mut parts = line.splitn(4, '\x1f');
    let name = parts.next()?.trim();
    if name.is_empty() {
        return None;
    }
    let current = parts.next().unwrap_or_default().trim() == "*";
    let upstream = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let (ahead, behind) = parse_track_counts(parts.next().unwrap_or_default());
    Some(GitBranchSummary {
        name: name.to_string(),
        current,
        upstream,
        ahead,
        behind,
    })
}

pub(super) fn parse_branch_header(header: &str) -> (String, Option<String>, u32, u32) {
    let (name_part, marker_part) = header
        .split_once(" [")
        .map(|(name, marker)| (name, Some(marker.trim_end_matches(']'))))
        .unwrap_or((header, None));

    let (branch, upstream) = name_part
        .split_once("...")
        .map(|(left, right)| (left.to_string(), Some(right.to_string())))
        .unwrap_or_else(|| (name_part.to_string(), None));

    let (ahead, behind) = marker_part.map(parse_track_counts).unwrap_or((0, 0));

    (branch, upstream, ahead, behind)
}

pub(super) fn parse_track_counts(marker: &str) -> (u32, u32) {
    let marker = marker.trim().trim_start_matches('[').trim_end_matches(']');
    let mut ahead = 0;
    let mut behind = 0;
    for part in marker.split(',').map(str::trim) {
        if let Some(value) = part.strip_prefix("ahead ") {
            ahead = value.parse().unwrap_or(0);
        } else if let Some(value) = part.strip_prefix("behind ") {
            behind = value.parse().unwrap_or(0);
        }
    }
    (ahead, behind)
}

pub(super) fn parse_status_line(line: &str) -> Option<GitFileStatus> {
    if line.len() < 4 {
        return None;
    }
    let index = line.chars().next().unwrap_or(' ');
    let worktree = line.chars().nth(1).unwrap_or(' ');
    let path_text = line.get(3..)?.to_string();
    let (path, original_path) = path_text
        .split_once(" -> ")
        .map(|(from, to)| (to.to_string(), Some(from.to_string())))
        .unwrap_or((path_text, None));

    Some(GitFileStatus {
        path,
        original_path,
        index_status: index.to_string(),
        worktree_status: worktree.to_string(),
        kind: change_kind(index, worktree),
    })
}

pub(super) fn change_kind(index: char, worktree: char) -> GitChangeKind {
    let pair = [index, worktree];
    if index == '?' && worktree == '?' {
        GitChangeKind::Untracked
    } else if pair.contains(&'U') {
        GitChangeKind::Unmerged
    } else if pair.contains(&'R') {
        GitChangeKind::Renamed
    } else if pair.contains(&'C') {
        GitChangeKind::Copied
    } else if pair.contains(&'A') {
        GitChangeKind::Added
    } else if pair.contains(&'D') {
        GitChangeKind::Deleted
    } else if pair.contains(&'T') {
        GitChangeKind::TypeChanged
    } else if pair.contains(&'M') {
        GitChangeKind::Modified
    } else {
        GitChangeKind::Unknown
    }
}

pub(super) fn parse_commit_line(line: &str) -> Option<GitCommitSummary> {
    let mut parts = line.splitn(7, '\x1f');
    let hash = parts.next()?.to_string();
    let short_hash = parts.next()?.to_string();
    let author = parts.next()?.to_string();
    let timestamp_seconds = parts.next()?.parse().ok()?;
    let subject = parts.next()?.to_string();
    let parents = parts
        .next()
        .unwrap_or_default()
        .split_whitespace()
        .map(str::to_string)
        .collect();
    let refs = parts
        .next()
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect();
    Some(GitCommitSummary {
        hash,
        short_hash,
        author,
        timestamp_seconds,
        subject,
        parents,
        refs,
    })
}
