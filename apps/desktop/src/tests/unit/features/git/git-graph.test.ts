import { describe, expect, it } from "vitest";
import type { GitCommitSummary } from "@/generated/irodori-api";
import {
  buildGitGraphRows,
  filterGraphCommits,
  nextGraphCommitHash,
  parseCommitFileSummary,
} from "@/features/git/git-graph";
import {
  formatCommitTime,
  gitAccentColor,
  localBranchNameFromRef,
  normalizeHexColor,
  providerDefaultColor,
  providerLabel,
  refKind,
  remoteBranchInfoFromRef,
  remoteCommitUrl,
} from "@/features/git/git-format";

function commit(
  hash: string,
  parents: string[],
  subject = hash,
  refs: string[] = [],
): GitCommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: "Hiro",
    timestampSeconds: 1n,
    subject,
    parents,
    refs,
  };
}

describe("git graph lane layout", () => {
  it("keeps a straight history on a single lane", () => {
    const rows = buildGitGraphRows([
      commit("c3", ["c2"]),
      commit("c2", ["c1"]),
      commit("c1", []),
    ]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.laneCount)).toEqual([1, 1, 1]);
  });

  it("expands and rejoins lanes for merge commits", () => {
    const rows = buildGitGraphRows([
      commit("merge", ["main-parent", "feature-parent"]),
      commit("main-parent", ["root"]),
      commit("feature-parent", ["root"]),
      commit("root", []),
    ]);
    expect(rows[0].lane).toBe(0);
    expect(rows[0].parentLanes).toEqual([0, 1]);
    expect(rows[1].laneCount).toBe(2);
    expect(rows[2].lane).toBe(1);
    expect(rows[3].lane).toBe(0);
  });

  it("filters by subject author hash and refs", () => {
    const commits = [
      commit("abc1234", [], "Add graph view", ["HEAD -> main"]),
      commit("def4567", [], "Release", ["tag: v1.0.0"]),
    ];
    expect(filterGraphCommits(commits, "graph")).toHaveLength(1);
    expect(filterGraphCommits(commits, "v1.0.0")[0].hash).toBe("def4567");
    expect(filterGraphCommits(commits, "hiro")).toHaveLength(2);
  });

  it("filters by branch remote and tag refs", () => {
    const remoteNames = new Set(["origin"]);
    const commits = [
      commit("a111111", [], "Main tip", ["HEAD -> main", "origin/main"]),
      // A local branch whose name contains a slash must count as a branch,
      // not a remote (#119).
      commit("b222222", [], "Feature tip", ["feature/login"]),
      commit("c333333", [], "Release", ["tag: v1.0.0"]),
      commit("d444444", [], "Plain"),
    ];

    expect(
      filterGraphCommits(commits, "", "branches", remoteNames).map(
        (item) => item.hash,
      ),
    ).toEqual(["a111111", "b222222"]);
    expect(
      filterGraphCommits(commits, "", "remotes", remoteNames).map(
        (item) => item.hash,
      ),
    ).toEqual(["a111111"]);
    expect(
      filterGraphCommits(commits, "", "tags", remoteNames).map(
        (item) => item.hash,
      ),
    ).toEqual(["c333333"]);
  });

  it("navigates filtered commits predictably", () => {
    const commits = [
      commit("a111111", []),
      commit("b222222", []),
      commit("c333333", []),
    ];

    expect(nextGraphCommitHash(commits, "b222222", "previous")).toBe("a111111");
    expect(nextGraphCommitHash(commits, "b222222", "next")).toBe("c333333");
    expect(nextGraphCommitHash(commits, "b222222", "first")).toBe("a111111");
    expect(nextGraphCommitHash(commits, "b222222", "last")).toBe("c333333");
    expect(nextGraphCommitHash(commits, "missing", "next")).toBe("b222222");
    expect(nextGraphCommitHash([], "missing", "next")).toBeNull();
  });
});

describe("git commit detail helpers", () => {
  it("parses name-status summaries for commit file lists", () => {
    expect(
      parseCommitFileSummary(
        [
          "M\tapps/desktop/src/features/git/GitGraphView.tsx",
          "A\tapps/desktop/src/features/git/new-file.ts",
          "R100\told/path.ts\tnew/path.ts",
        ].join("\n"),
      ),
    ).toEqual([
      {
        kind: "modified",
        path: "apps/desktop/src/features/git/GitGraphView.tsx",
        status: "M",
      },
      {
        kind: "added",
        path: "apps/desktop/src/features/git/new-file.ts",
        status: "A",
      },
      {
        kind: "renamed",
        originalPath: "old/path.ts",
        path: "new/path.ts",
        status: "R100",
      },
    ]);
  });

  it("classifies refs as remote only when the first segment names a remote", () => {
    const remoteNames = new Set(["origin", "upstream"]);
    expect(refKind("origin/main", remoteNames)).toBe("remote");
    expect(refKind("upstream/feature/login", remoteNames)).toBe("remote");
    // Bare local branches may contain slashes; `%D` never prefixes them.
    expect(refKind("feature/login", remoteNames)).toBe("branch");
    expect(refKind("main", remoteNames)).toBe("branch");
    expect(refKind("tag: v1.0.0", remoteNames)).toBe("tag");
    expect(refKind("HEAD -> main", remoteNames)).toBe("head");
    // Without a known remote set nothing is guessed from the slash alone.
    expect(refKind("origin/main")).toBe("branch");
  });

  it("derives local and remote branch actions from graph refs", () => {
    const remoteNames = new Set(["origin"]);
    expect(localBranchNameFromRef("HEAD -> main")).toBe("main");
    expect(
      localBranchNameFromRef("feature/git-actions", ["feature/git-actions"]),
    ).toBe("feature/git-actions");
    // A slash-named local branch resolves even when the local-branch list
    // has not loaded, as long as its first segment is not a remote (#119).
    expect(localBranchNameFromRef("feature/login", [], remoteNames)).toBe(
      "feature/login",
    );
    expect(localBranchNameFromRef("origin/main", [], remoteNames)).toBeNull();
    expect(
      remoteBranchInfoFromRef("origin/feature/git-actions", remoteNames),
    ).toEqual({
      branchName: "feature/git-actions",
      localBranchName: "feature/git-actions",
      remoteName: "origin",
      startPoint: "origin/feature/git-actions",
    });
    expect(
      remoteBranchInfoFromRef("origin/HEAD -> origin/main", remoteNames),
    ).toBeNull();
    expect(remoteBranchInfoFromRef("feature/login", remoteNames)).toBeNull();
  });

  it("builds provider-specific remote commit URLs", () => {
    expect(
      remoteCommitUrl(
        { provider: "github", webUrl: "https://github.com/hjosugi/repo" },
        "abc123",
      ),
    ).toBe("https://github.com/hjosugi/repo/commit/abc123");
    expect(
      remoteCommitUrl(
        { provider: "gitlab", webUrl: "https://gitlab.com/hjosugi/repo/" },
        "abc123",
      ),
    ).toBe("https://gitlab.com/hjosugi/repo/-/commit/abc123");
    expect(
      remoteCommitUrl({ provider: "generic", webUrl: undefined }, "abc123"),
    ).toBeNull();
  });
});

describe("commit time formatting", () => {
  // Midday UTC so no timezone can shift the calendar date across a year edge.
  const march2023 = BigInt(Date.UTC(2023, 2, 5, 12, 0, 0) / 1000);

  it("adds the year to commits from previous years", () => {
    expect(
      formatCommitTime(march2023, "en", new Date(Date.UTC(2026, 6, 1, 12))),
    ).toContain("2023");
    expect(
      formatCommitTime(march2023, "en", new Date(Date.UTC(2023, 6, 1, 12))),
    ).not.toContain("2023");
  });

  it("formats in the app locale rather than the OS locale", () => {
    const now = new Date(Date.UTC(2026, 6, 1, 12));
    expect(formatCommitTime(march2023, "ja", now)).not.toBe(
      formatCommitTime(march2023, "en-US", now),
    );
  });

  it("keeps the invalid-timestamp fallback", () => {
    expect(formatCommitTime(BigInt("9999999999999999"), "en")).toBe("-");
  });
});

describe("git provider formatting", () => {
  it("labels known providers and uses provider colors as defaults", () => {
    expect(providerLabel("github")).toBe("GitHub");
    expect(providerLabel("codeCommit")).toBe("AWS CodeCommit");
    expect(providerDefaultColor("gitlab")).toBe("#fc6d26");
  });

  it("lets custom repo colors override provider defaults", () => {
    expect(gitAccentColor("github", "#0F8")).toBe("#00ff88");
    expect(gitAccentColor("github", "bad")).toBe("#24292f");
    expect(normalizeHexColor("#ABCDEF")).toBe("#abcdef");
  });
});
