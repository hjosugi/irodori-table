import { describe, expect, it } from "vitest";
import type { GitCommitSummary } from "@/generated/irodori-api";
import {
  buildGitGraphRows,
  filterGraphCommits,
  nextGraphCommitHash,
} from "@/features/git/git-graph";
import {
  gitAccentColor,
  normalizeHexColor,
  providerDefaultColor,
  providerLabel,
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
    const commits = [
      commit("a111111", [], "Main tip", ["HEAD -> main", "origin/main"]),
      commit("b222222", [], "Feature tip", ["feature"]),
      commit("c333333", [], "Release", ["tag: v1.0.0"]),
      commit("d444444", [], "Plain"),
    ];

    expect(filterGraphCommits(commits, "", "branches").map((item) => item.hash))
      .toEqual(["a111111", "b222222"]);
    expect(filterGraphCommits(commits, "", "remotes").map((item) => item.hash))
      .toEqual(["a111111"]);
    expect(filterGraphCommits(commits, "", "tags").map((item) => item.hash))
      .toEqual(["c333333"]);
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
