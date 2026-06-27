use super::parser::{parse_branch_header, parse_status_line};
use super::*;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

struct TestRepo {
    path: PathBuf,
}

impl Drop for TestRepo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn test_repo(name: &str) -> TestRepo {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!(
        "irodori-git-{name}-{}-{suffix}",
        std::process::id()
    ));
    fs::create_dir_all(&path).expect("create test repo dir");
    let output = Command::new("git")
        .arg("init")
        .current_dir(&path)
        .output()
        .expect("run git init");
    assert!(
        output.status.success(),
        "git init failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    TestRepo { path }
}

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

#[test]
fn discards_untracked_directories() {
    let repo = test_repo("discard-untracked-dir");
    let nested_file = repo.path.join("generated").join("snapshot.json");
    fs::create_dir_all(nested_file.parent().unwrap()).expect("create nested dir");
    fs::write(&nested_file, "{}").expect("write untracked file");

    git_discard_files(
        Some(path_to_string(&repo.path)),
        vec!["generated".to_string()],
    )
    .expect("discard untracked directory");

    assert!(
        !repo.path.join("generated").exists(),
        "untracked directory should be removed"
    );
}
