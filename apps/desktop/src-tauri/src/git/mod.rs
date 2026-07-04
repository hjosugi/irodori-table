use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};

use irodori_core::{IrodoriError, IrodoriErrorKind, Result as IrodoriResult};
mod parser;
mod types;

pub use types::{
    GitBranchSummary, GitChangeKind, GitCommandOutput, GitCommitSummary, GitDiffResult,
    GitFileStatus, GitRemoteProvider, GitRemoteSummary, GitStatusSummary,
};

use parser::{parse_branch_line, parse_commit_line, parse_remotes, parse_status};

const DIFF_TEXT_LIMIT: usize = 240_000;
const LOG_LIMIT_MAX: u32 = 120;

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
pub fn git_log(
    repo_path: Option<String>,
    limit: Option<u32>,
) -> IrodoriResult<Vec<GitCommitSummary>> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    git_log_impl(&repo_root, limit.unwrap_or(12).clamp(1, LOG_LIMIT_MAX))
}

#[tauri::command]
pub fn git_diff(
    repo_path: Option<String>,
    file_path: Option<String>,
    commit: Option<String>,
) -> IrodoriResult<GitDiffResult> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let file = match file_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        Some(path) => Some(validate_relative_file_path(path)?),
        None => None,
    };

    if let Some(commit) = commit
        .as_deref()
        .map(str::trim)
        .filter(|commit| !commit.is_empty())
    {
        return git_commit_diff(&repo_root, file, commit.to_string());
    }

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
pub fn git_commit_all(
    repo_path: Option<String>,
    message: String,
) -> IrodoriResult<GitCommandOutput> {
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
        let output = run_git_with_paths(
            &repo_root,
            &["restore", "--staged", "--worktree"],
            &tracked,
            &[0],
        )?;
        stdout.push_str(&String::from_utf8_lossy(&output.stdout));
        stderr.push_str(&String::from_utf8_lossy(&output.stderr));
        status_code = output.status.code().unwrap_or(status_code);
    }
    if !untracked.is_empty() {
        let output = run_git_with_paths(&repo_root, &["clean", "-fd"], &untracked, &[0])?;
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
    start_point: Option<String>,
) -> IrodoriResult<GitCommandOutput> {
    let repo_root = resolve_repo_root(repo_path.as_deref())?;
    let branch = validate_branch_name(&repo_root, branch)?;
    let output = if create.unwrap_or(false) {
        let mut args = vec!["switch".into(), "-c".into(), branch];
        if let Some(start_point) = start_point
            .as_deref()
            .map(str::trim)
            .filter(|start_point| !start_point.is_empty())
        {
            args.push(validate_git_commit_ref(
                &repo_root,
                start_point.to_string(),
                "git branch start point",
            )?);
        }
        run_git_owned(&repo_root, args, &[0])?
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

fn git_commit_diff(
    repo_root: &Path,
    file: Option<PathBuf>,
    commit: String,
) -> IrodoriResult<GitDiffResult> {
    let commit = validate_git_commit_ref(repo_root, commit, "git commit")?;
    let file_path = file.as_ref().map(|path| path_to_string(path));
    let file_string = file.as_ref().map(|path| path.to_string_lossy().to_string());

    let mut summary_args = vec![
        "show".into(),
        "--format=".into(),
        "--name-status".into(),
        "--find-renames".into(),
        "--find-copies".into(),
        commit.clone(),
        "--".into(),
    ];
    if let Some(file_string) = &file_string {
        summary_args.push(file_string.clone());
    }

    let mut diff_args = vec![
        "show".into(),
        "--format=".into(),
        "--patch".into(),
        "--stat".into(),
        "--find-renames".into(),
        "--find-copies".into(),
        "--no-ext-diff".into(),
        commit,
        "--".into(),
    ];
    if let Some(file_string) = &file_string {
        diff_args.push(file_string.clone());
    }

    let summary_output = run_git_owned(repo_root, summary_args, &[0])?;
    let diff_output = run_git_owned(repo_root, diff_args, &[0])?;
    let (staged, staged_truncated) = truncate_text(output_stdout(summary_output), DIFF_TEXT_LIMIT);
    let (unstaged, unstaged_truncated) = truncate_text(output_stdout(diff_output), DIFF_TEXT_LIMIT);

    Ok(GitDiffResult {
        repo_root: path_to_string(repo_root),
        file_path,
        staged,
        unstaged,
        truncated: staged_truncated || unstaged_truncated,
    })
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
        IrodoriError::validation(format!(
            "default workspace is not a git repository: {message}"
        ))
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

    Err(
        IrodoriError::new(IrodoriErrorKind::Internal, output_stderr(output))
            .with_code(format!("git.exit.{code}")),
    )
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
        return Err(IrodoriError::validation(
            "at least one git file path is required",
        ));
    }
    let mut args: Vec<String> = base_args.iter().map(|arg| (*arg).to_string()).collect();
    args.push("--".into());
    args.extend(paths.iter().cloned());
    run_git_owned(repo_root, args, success_codes)
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
        return Err(IrodoriError::validation(
            "at least one git file path is required",
        ));
    }
    paths
        .iter()
        .map(|path| {
            validate_relative_file_path(path).map(|path| path.to_string_lossy().to_string())
        })
        .collect()
}

fn validate_branch_name(repo_root: &Path, branch: String) -> IrodoriResult<String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err(IrodoriError::validation("git branch name is required"));
    }
    if branch.starts_with('-') {
        return Err(IrodoriError::validation(
            "git branch name cannot start with '-'",
        ));
    }
    run_git(repo_root, &["check-ref-format", "--branch", branch], &[0])?;
    Ok(branch.to_string())
}

fn validate_git_commit_ref(repo_root: &Path, value: String, label: &str) -> IrodoriResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(IrodoriError::validation(format!("{label} is required")));
    }
    if value.starts_with('-') {
        return Err(IrodoriError::validation(format!(
            "{label} cannot start with '-'",
        )));
    }
    if value.chars().any(char::is_control) {
        return Err(IrodoriError::validation(format!(
            "{label} cannot contain control characters",
        )));
    }
    let rev = format!("{value}^{{commit}}");
    run_git(repo_root, &["rev-parse", "--verify", "--quiet", &rev], &[0])?;
    Ok(value.to_string())
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
        &[
            "diff",
            "--no-ext-diff",
            "--no-index",
            "--",
            "/dev/null",
            &path_string,
        ],
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
mod tests;
