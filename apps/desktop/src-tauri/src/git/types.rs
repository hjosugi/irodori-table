use serde::{Deserialize, Serialize};
use ts_rs::TS;

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
