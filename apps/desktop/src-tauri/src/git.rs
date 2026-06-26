use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};

use irodori_core::{IrodoriError, IrodoriErrorKind, Result as IrodoriResult};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

const DIFF_TEXT_LIMIT: usize = 240_000;
const LOG_LIMIT_MAX: u32 = 120;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum GitChangeKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Unmerged,
    TypeChanged,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum GitRemoteProvider {
    Github,
    Gitlab,
    Bitbucket,
    AzureRepos,
    CodeCommit,
    Gitea,
    Generic,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub kind: GitChangeKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GitCommitSummary {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub timestamp_seconds: i64,
    pub subject: String,
    #[serde(default)]
    pub parents: Vec<String>,
    #[serde(default)]
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GitRemoteSummary {
    pub name: String,
    pub fetch_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub push_url: Option<String>,
    pub provider: GitRemoteProvider,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GitBranchSummary {
    pub name: String,
    pub current: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GitStatusSummary {
    pub repo_root: String,
    pub branch: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub clean: bool,
    pub files: Vec<GitFileStatus>,
    pub recent_commits: Vec<GitCommitSummary>,
    pub remotes: Vec<GitRemoteSummary>,
    pub branches: Vec<GitBranchSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub repo_root: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file_path: Option<String>,
    pub staged: String,
    pub unstaged: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct GitCommandOutput {
    pub repo_root: String,
    pub stdout: String,
    pub stderr: String,
    pub status_code: i32,
}

#[tauri::command]
pub fn git_status(repo_path: Option<String>) -> IrodoriResult<GitStatusSummary> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let output = run_git(&repo_root, &["status", "--porcelain=v1", "--branch"], &[0])?;
    let text = output_stdout(output);
    let (branch, upstream, ahead, behind, files) = parse_status(&text);
    let recent_commits = git_log_impl(&repo_root, 5).unwrap_or_default();
    let remotes = git_remotes_impl(&repo_root).unwrap_or_default();
    let branches = git_branches_impl(&repo_root).unwrap_or_default();

    Ok(GitStatusSummary {
        repo_root: path_to_string(&repo_root),
        branch,
        upstream,
        ahead,
        behind,
        clean: files.is_empty(),
        files,
        recent_commits,
        remotes,
        branches,
    })
}

#[tauri::command]
pub fn git_log(repo_path: Option<String>, limit: Option<u32>) -> IrodoriResult<Vec<GitCommitSummary>> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    git_log_impl(&repo_root, limit.unwrap_or(12).clamp(1, LOG_LIMIT_MAX))
}

#[tauri::command]
pub fn git_diff(
    repo_path: Option<String>,
    file_path: Option<String>,
) -> IrodoriResult<GitDiffResult> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let file = match file_path.as_deref().map(str::trim).filter(|path| !path.is_empty()) {
        Some(path) => Some(validate_relative_file_path(path)?),
        None => None,
    };

    let mut staged_args = vec!["diff", "--no-ext-diff", "--cached", "--"];
    let mut unstaged_args = vec!["diff", "--no-ext-diff", "--"];
    let file_string;
    if let Some(file) = &file {
        file_string = file.to_string_lossy().to_string();
        staged_args.push(&file_string);
        unstaged_args.push(&file_string);
    }

    let untracked_diff = match &file {
        Some(path) if file_is_untracked(&repo_root, path)? => {
            Some(build_untracked_diff(&repo_root, path)?)
        }
        _ => None,
    };

    let staged_output = run_git(&repo_root, &staged_args, &[0])?;
    let unstaged_output = run_git(&repo_root, &unstaged_args, &[0])?;
    let (staged, staged_truncated) = truncate_text(output_stdout(staged_output), DIFF_TEXT_LIMIT);
    let unstaged_text = untracked_diff.unwrap_or_else(|| output_stdout(unstaged_output));
    let (unstaged, unstaged_truncated) = truncate_text(unstaged_text, DIFF_TEXT_LIMIT);

    Ok(GitDiffResult {
        repo_root: path_to_string(&repo_root),
        file_path,
        staged,
        unstaged,
        truncated: staged_truncated || unstaged_truncated,
    })
}

#[tauri::command]
pub fn git_commit_all(repo_path: Option<String>, message: String) -> IrodoriResult<GitCommandOutput> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let message = message.trim();
    if message.is_empty() {
        return Err(IrodoriError::validation("commit message is required"));
    }

    run_git(&repo_root, &["add", "-A"], &[0])?;
    let output = run_git(&repo_root, &["commit", "-m", message], &[0])?;
    Ok(command_output(repo_root, output))
}

#[tauri::command]
pub fn git_commit_staged(
    repo_path: Option<String>,
    message: String,
) -> IrodoriResult<GitCommandOutput> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let message = message.trim();
    if message.is_empty() {
        return Err(IrodoriError::validation("commit message is required"));
    }

    let output = run_git(&repo_root, &["commit", "-m", message], &[0])?;
    Ok(command_output(repo_root, output))
}

#[tauri::command]
pub fn git_push(repo_path: Option<String>) -> IrodoriResult<GitCommandOutput> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let output = run_git(&repo_root, &["push"], &[0])?;
    Ok(command_output(repo_root, output))
}

#[tauri::command]
pub fn git_fetch(repo_path: Option<String>) -> IrodoriResult<GitCommandOutput> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let output = run_git(&repo_root, &["fetch", "--all", "--prune"], &[0])?;
    Ok(command_output(repo_root, output))
}

#[tauri::command]
pub fn git_pull(repo_path: Option<String>) -> IrodoriResult<GitCommandOutput> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let output = run_git(&repo_root, &["pull", "--ff-only"], &[0])?;
    Ok(command_output(repo_root, output))
}

#[tauri::command]
pub fn git_stage_files(
    repo_path: Option<String>,
    paths: Vec<String>,
) -> IrodoriResult<GitCommandOutput> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let paths = validate_relative_file_paths(paths)?;
    let output = run_git_with_paths(&repo_root, &["add"], &paths, &[0])?;
    Ok(command_output(repo_root, output))
}

#[tauri::command]
pub fn git_unstage_files(
    repo_path: Option<String>,
    paths: Vec<String>,
) -> IrodoriResult<GitCommandOutput> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let paths = validate_relative_file_paths(paths)?;
    let output = run_git_with_paths(&repo_root, &["restore", "--staged"], &paths, &[0])?;
    Ok(command_output(repo_root, output))
}

#[tauri::command]
pub fn git_discard_files(
    repo_path: Option<String>,
    paths: Vec<String>,
) -> IrodoriResult<GitCommandOutput> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let paths = validate_relative_file_paths(paths)?;
    let mut tracked = Vec::new();
    let mut untracked = Vec::new();
    for path in paths {
        if file_is_untracked(&repo_root, Path::new(&path))? {
            untracked.push(path);
        } else {
            tracked.push(path);
        }
    }

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut status_code = 0;
    if !tracked.is_empty() {
        let output =
            run_git_with_paths(&repo_root, &["restore", "--staged", "--worktree"], &tracked, &[0])?;
        stdout.push_str(&String::from_utf8_lossy(&output.stdout));
        stderr.push_str(&String::from_utf8_lossy(&output.stderr));
        status_code = output.status.code().unwrap_or(status_code);
    }
    if !untracked.is_empty() {
        let output = run_git_with_paths(&repo_root, &["clean", "-f"], &untracked, &[0])?;
        stdout.push_str(&String::from_utf8_lossy(&output.stdout));
        stderr.push_str(&String::from_utf8_lossy(&output.stderr));
        status_code = output.status.code().unwrap_or(status_code);
    }

    Ok(GitCommandOutput {
        repo_root: path_to_string(&repo_root),
        stdout,
        stderr,
        status_code,
    })
}

#[tauri::command]
pub fn git_checkout_branch(
    repo_path: Option<String>,
    branch: String,
    create: Option<bool>,
) -> IrodoriResult<GitCommandOutput> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let branch = validate_branch_name(&repo_root, branch)?;
    let output = if create.unwrap_or(false) {
        run_git_owned(&repo_root, vec!["switch".into(), "-c".into(), branch], &[0])?
    } else {
        run_git_owned(&repo_root, vec!["switch".into(), branch], &[0])?
    };
    Ok(command_output(repo_root, output))
}

#[tauri::command]
pub fn git_delete_branch(
    repo_path: Option<String>,
    branch: String,
    force: Option<bool>,
) -> IrodoriResult<GitCommandOutput> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let branch = validate_branch_name(&repo_root, branch)?;
    let flag = if force.unwrap_or(false) { "-D" } else { "-d" };
    let output = run_git_owned(&repo_root, vec!["branch".into(), flag.into(), branch], &[0])?;
    Ok(command_output(repo_root, output))
}

fn git_log_impl(repo_root: &Path, limit: u32) -> IrodoriResult<Vec<GitCommitSummary>> {
    let count = limit.clamp(1, LOG_LIMIT_MAX).to_string();
    let format = "%H%x1f%h%x1f%an%x1f%at%x1f%s%x1f%P%x1f%D";
    let output = run_git(
        repo_root,
        &[
            "log",
            "--date-order",
            "--decorate=short",
            &format!("--max-count={count}"),
            &format!("--format={format}"),
        ],
        &[0, 128],
    )?;
    let stdout = output_stdout(output);
    Ok(stdout.lines().filter_map(parse_commit_line).collect())
}

fn git_remotes_impl(repo_root: &Path) -> IrodoriResult<Vec<GitRemoteSummary>> {
    let output = run_git(repo_root, &["remote", "-v"], &[0])?;
    Ok(parse_remotes(&output_stdout(output)))
}

fn git_branches_impl(repo_root: &Path) -> IrodoriResult<Vec<GitBranchSummary>> {
    let output = run_git(
        repo_root,
        &[
            "branch",
            "--format=%(refname:short)%x1f%(HEAD)%x1f%(upstream:short)%x1f%(upstream:track)",
        ],
        &[0],
    )?;
    Ok(output_stdout(output)
        .lines()
        .filter_map(parse_branch_line)
        .collect())
}

fn resolve_repo_root(repo_path: Option<&str>) -> IrodoriResult<PathBuf> {
    if let Some(raw) = repo_path.map(str::trim).filter(|path| !path.is_empty()) {
        return try_repo_root(Path::new(raw)).map_err(|message| {
            IrodoriError::validation(format!("{raw} is not a readable git repository: {message}"))
        });
    }

    if let Ok(current_dir) = std::env::current_dir() {
        if let Ok(root) = try_repo_root(&current_dir) {
            return Ok(root);
        }
    }

    let manifest_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    try_repo_root(&manifest_root).map_err(|message| {
        IrodoriError::validation(format!("default workspace is not a git repository: {message}"))
    })
}

fn try_repo_root(path: &Path) -> Result<PathBuf, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["rev-parse", "--show-toplevel"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| format!("git is not available: {error}"))?;
    if !output.status.success() {
        return Err(output_stderr(output));
    }
    let root = output_stdout(output).trim().to_string();
    if root.is_empty() {
        return Err("git returned an empty repository root".into());
    }
    Ok(PathBuf::from(root))
}

fn run_git(repo_root: &Path, args: &[&str], success_codes: &[i32]) -> IrodoriResult<Output> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| {
            IrodoriError::new(
                IrodoriErrorKind::Transport,
                format!("git is not available: {error}"),
            )
            .with_code("git.spawn")
        })?;

    let code = output.status.code().unwrap_or(-1);
    if success_codes.contains(&code) {
        return Ok(output);
    }

    Err(IrodoriError::new(
        IrodoriErrorKind::Internal,
        output_stderr(output),
    )
    .with_code(format!("git.exit.{code}")))
}

fn run_git_owned(
    repo_root: &Path,
    args: Vec<String>,
    success_codes: &[i32],
) -> IrodoriResult<Output> {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_git(repo_root, &refs, success_codes)
}

fn run_git_with_paths(
    repo_root: &Path,
    base_args: &[&str],
    paths: &[String],
    success_codes: &[i32],
) -> IrodoriResult<Output> {
    if paths.is_empty() {
        return Err(IrodoriError::validation("at least one git file path is required"));
    }
    let mut args: Vec<String> = base_args.iter().map(|arg| (*arg).to_string()).collect();
    args.push("--".into());
    args.extend(paths.iter().cloned());
    run_git_owned(repo_root, args, success_codes)
}

fn parse_status(text: &str) -> (String, Option<String>, u32, u32, Vec<GitFileStatus>) {
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

fn parse_remotes(text: &str) -> Vec<GitRemoteSummary> {
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

fn remote_provider(url: &str) -> GitRemoteProvider {
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

fn remote_web_url(url: &str) -> Option<String> {
    let provider = remote_provider(url);
    match provider {
        GitRemoteProvider::CodeCommit => codecommit_web_url(url),
        GitRemoteProvider::AzureRepos => azure_repos_web_url(url),
        _ => generic_git_web_url(url),
    }
}

fn generic_git_web_url(url: &str) -> Option<String> {
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

fn azure_repos_web_url(url: &str) -> Option<String> {
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

fn codecommit_web_url(url: &str) -> Option<String> {
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

fn strip_credentials(url: &str) -> String {
    if let Some((scheme, rest)) = url.split_once("://") {
        if let Some((_, after_at)) = rest.split_once('@') {
            return format!("{scheme}://{after_at}");
        }
    }
    url.to_string()
}

fn strip_git_suffix(url: &str) -> String {
    url.strip_suffix(".git").unwrap_or(url).to_string()
}

fn parse_branch_line(line: &str) -> Option<GitBranchSummary> {
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

fn parse_branch_header(header: &str) -> (String, Option<String>, u32, u32) {
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

fn parse_track_counts(marker: &str) -> (u32, u32) {
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

fn parse_status_line(line: &str) -> Option<GitFileStatus> {
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

fn change_kind(index: char, worktree: char) -> GitChangeKind {
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

fn parse_commit_line(line: &str) -> Option<GitCommitSummary> {
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

fn validate_relative_file_path(path: &str) -> IrodoriResult<PathBuf> {
    let path = path.trim();
    if path.is_empty() {
        return Err(IrodoriError::validation("git file path cannot be empty"));
    }
    let path = Path::new(path);
    if path.is_absolute() {
        return Err(IrodoriError::validation("git file path must be relative"));
    }
    for component in path.components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) {
            return Err(IrodoriError::validation(
                "git file path cannot leave the repository",
            ));
        }
    }
    Ok(path.to_path_buf())
}

fn validate_relative_file_paths(paths: Vec<String>) -> IrodoriResult<Vec<String>> {
    if paths.is_empty() {
        return Err(IrodoriError::validation("at least one git file path is required"));
    }
    paths
        .iter()
        .map(|path| {
            validate_relative_file_path(path)
                .map(|path| path.to_string_lossy().to_string())
        })
        .collect()
}

fn validate_branch_name(repo_root: &Path, branch: String) -> IrodoriResult<String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(IrodoriError::validation("git branch name is required"));
    }
    if branch.starts_with('-') {
        return Err(IrodoriError::validation("git branch name cannot start with '-'"));
    }
    run_git(repo_root, &["check-ref-format", "--branch", branch], &[0])?;
    Ok(branch.to_string())
}

fn file_is_untracked(repo_root: &Path, path: &Path) -> IrodoriResult<bool> {
    let path_string = path.to_string_lossy().to_string();
    let output = run_git(
        repo_root,
        &["status", "--porcelain=v1", "--", &path_string],
        &[0],
    )?;
    Ok(output_stdout(output)
        .lines()
        .any(|line| line.starts_with("?? ")))
}

fn build_untracked_diff(repo_root: &Path, path: &Path) -> IrodoriResult<String> {
    let absolute = repo_root.join(path);
    if absolute.is_dir() {
        return Ok(format!(
            "Untracked directory: {}\nStage it to include its contents in a commit.",
            path.to_string_lossy()
        ));
    }
    let path_string = absolute.to_string_lossy().to_string();
    let output = run_git(
        repo_root,
        &["diff", "--no-ext-diff", "--no-index", "--", "/dev/null", &path_string],
        &[0, 1],
    )?;
    Ok(output_stdout(output))
}

fn truncate_text(text: String, limit: usize) -> (String, bool) {
    if text.len() <= limit {
        return (text, false);
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (format!("{}\n\n[diff truncated]", &text[..end]), true)
}

fn command_output(repo_root: PathBuf, output: Output) -> GitCommandOutput {
    let status_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    GitCommandOutput {
        repo_root: path_to_string(&repo_root),
        stdout,
        stderr,
        status_code,
    }
}

fn output_stdout(output: Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn output_stderr(output: Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    } else {
        stderr
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_header_with_upstream_counts() {
        let (branch, upstream, ahead, behind) =
            parse_branch_header("main...origin/main [ahead 2, behind 1]");
        assert_eq!(branch, "main");
        assert_eq!(upstream.as_deref(), Some("origin/main"));
        assert_eq!(ahead, 2);
        assert_eq!(behind, 1);
    }

    #[test]
    fn parses_branch_lines_with_tracking_counts() {
        let branch = parse_branch_line("feature\x1f*\x1forigin/feature\x1f[ahead 3]").unwrap();
        assert_eq!(branch.name, "feature");
        assert!(branch.current);
        assert_eq!(branch.upstream.as_deref(), Some("origin/feature"));
        assert_eq!(branch.ahead, 3);
        assert_eq!(branch.behind, 0);
    }

    #[test]
    fn detects_remote_providers_and_web_urls() {
        let remotes = parse_remotes(
            "\
origin\tgit@github.com:hjosugi/irodori-table.git (fetch)
origin\tgit@github.com:hjosugi/irodori-table.git (push)
gitlab\thttps://gitlab.com/group/project.git (fetch)
bb\tgit@bitbucket.org:team/repo.git (fetch)
azure\tgit@ssh.dev.azure.com:v3/org/project/repo (fetch)
aws\tssh://git-codecommit.us-east-1.amazonaws.com/v1/repos/my-repo (fetch)",
        );
        assert_eq!(remotes[0].provider, GitRemoteProvider::Github);
        assert_eq!(
            remotes[0].web_url.as_deref(),
            Some("https://github.com/hjosugi/irodori-table")
        );
        assert_eq!(remotes[1].provider, GitRemoteProvider::Gitlab);
        assert_eq!(remotes[2].provider, GitRemoteProvider::Bitbucket);
        assert_eq!(remotes[3].provider, GitRemoteProvider::AzureRepos);
        assert_eq!(
            remotes[3].web_url.as_deref(),
            Some("https://dev.azure.com/org/project/_git/repo")
        );
        assert_eq!(remotes[4].provider, GitRemoteProvider::CodeCommit);
        assert_eq!(
            remotes[4].web_url.as_deref(),
            Some("https://us-east-1.console.aws.amazon.com/codesuite/codecommit/repositories/my-repo/browse?region=us-east-1")
        );
    }

    #[test]
    fn parses_porcelain_status_lines() {
        let file = parse_status_line(" M apps/desktop/src/App.tsx").unwrap();
        assert_eq!(file.path, "apps/desktop/src/App.tsx");
        assert!(matches!(file.kind, GitChangeKind::Modified));

        let rename = parse_status_line("R  old.sql -> new.sql").unwrap();
        assert_eq!(rename.path, "new.sql");
        assert_eq!(rename.original_path.as_deref(), Some("old.sql"));
        assert!(matches!(rename.kind, GitChangeKind::Renamed));
    }

    #[test]
    fn parses_commit_line_with_parents_and_refs() {
        let commit = parse_commit_line(
            "abcd1234\x1fabcd123\x1fHiro\x1f1761300000\x1fMerge branch feature\x1fparent1 parent2\x1fHEAD -> main, tag: v1.0.0, origin/main",
        )
        .unwrap();
        assert_eq!(commit.hash, "abcd1234");
        assert_eq!(commit.short_hash, "abcd123");
        assert_eq!(commit.parents, vec!["parent1", "parent2"]);
        assert_eq!(
            commit.refs,
            vec!["HEAD -> main", "tag: v1.0.0", "origin/main"]
        );
    }
}
