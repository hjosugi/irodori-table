import { describe, expect, it } from "vitest";
import type { GitCommitSummary } from "@/generated/irodori-api";
import { buildGitGraphRows, filterGraphCommits } from "@/features/git/git-graph";

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
});
