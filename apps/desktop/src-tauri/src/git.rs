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

    Ok(GitStatusSummary {
        repo_root: path_to_string(&repo_root),
        branch,
        upstream,
        ahead,
        behind,
        clean: files.is_empty(),
        files,
        recent_commits,
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

    let staged_output = run_git(&repo_root, &staged_args, &[0])?;
    let unstaged_output = run_git(&repo_root, &unstaged_args, &[0])?;
    let (staged, staged_truncated) = truncate_text(output_stdout(staged_output), DIFF_TEXT_LIMIT);
    let (unstaged, unstaged_truncated) =
        truncate_text(output_stdout(unstaged_output), DIFF_TEXT_LIMIT);

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
pub fn git_push(repo_path: Option<String>) -> IrodoriResult<GitCommandOutput> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let output = run_git(&repo_root, &["push"], &[0])?;
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

fn parse_branch_header(header: &str) -> (String, Option<String>, u32, u32) {
    let (name_part, marker_part) = header
        .split_once(" [")
        .map(|(name, marker)| (name, Some(marker.trim_end_matches(']'))))
        .unwrap_or((header, None));

    let (branch, upstream) = name_part
        .split_once("...")
        .map(|(left, right)| (left.to_string(), Some(right.to_string())))
        .unwrap_or_else(|| (name_part.to_string(), None));

    let mut ahead = 0;
    let mut behind = 0;
    if let Some(marker) = marker_part {
        for part in marker.split(',').map(str::trim) {
            if let Some(value) = part.strip_prefix("ahead ") {
                ahead = value.parse().unwrap_or(0);
            } else if let Some(value) = part.strip_prefix("behind ") {
                behind = value.parse().unwrap_or(0);
            }
        }
    }

    (branch, upstream, ahead, behind)
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
