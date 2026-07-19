// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type {
  GitCommitSummary,
  GitRemoteSummary,
} from "@/generated/irodori-api";
import { GitGraphView } from "@/features/git/GitGraphView";
import { createTranslator } from "@/i18n";
import { renderUi } from "../../../helpers/render";

// Local branches containing "/" were classified as remote because the old
// refKind treated any slash as a remote prefix (#119). A ref is remote iff its
// first segment names a known remote, so `feature/login` must survive the
// "Show remote branches" toggle and wear the local-branch badge styling.

const origin: GitRemoteSummary = {
  name: "origin",
  fetchUrl: "git@github.com:hjosugi/repo.git",
  provider: "github",
  webUrl: "https://github.com/hjosugi/repo",
};

function commit(
  hash: string,
  refs: string[],
  parents: string[] = [],
): GitCommitSummary {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: "Hiro",
    timestampSeconds: 1n,
    subject: `subject ${hash}`,
    parents,
    refs,
  };
}

function renderGraph() {
  return renderUi(
    <GitGraphView
      branches={[]}
      commitDiff={null}
      commitDiffLoading={false}
      commits={[
        commit("a111111", ["HEAD -> main", "origin/main", "feature/login"]),
      ]}
      currentBranch="main"
      query=""
      refFilter="all"
      remotes={[origin]}
      selectedCommitPath={null}
      selectedCommitHash={null}
      loading={false}
      onCheckoutBranch={vi.fn()}
      onCreateBranch={vi.fn()}
      onDeleteBranch={vi.fn()}
      onQueryChange={vi.fn()}
      onRefFilterChange={vi.fn()}
      onSelectCommit={vi.fn()}
      onSelectCommitFile={vi.fn()}
      t={createTranslator("en").t}
    />,
  );
}

describe("GitGraphView remote-ref handling", () => {
  it("keeps slash-named local branches visible when remote refs are hidden", async () => {
    const { user } = renderGraph();

    expect(screen.getAllByText("feature/login").length).toBeGreaterThan(0);
    expect(screen.getAllByText("origin/main").length).toBeGreaterThan(0);

    await user.click(screen.getByLabelText("Show remote branches"));

    expect(screen.getAllByText("feature/login").length).toBeGreaterThan(0);
    expect(screen.queryByText("origin/main")).toBeNull();
  });

  it("styles badges by remote membership, not by slashes", () => {
    renderGraph();

    const [localBadge] = screen.getAllByText("feature/login");
    const [remoteBadge] = screen.getAllByText("origin/main");
    expect(localBadge.className).toContain("branch");
    expect(localBadge.className).not.toContain("remote");
    expect(remoteBadge.className).toContain("remote");
  });
});
