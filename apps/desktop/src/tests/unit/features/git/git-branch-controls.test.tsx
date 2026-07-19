// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitPanel } from "@/features/git/GitDrawer";
import { useGitStore } from "@/features/git/git-store";
import { renderUi } from "../../../helpers/render";

// #141: the branch switcher <select> and the new-branch draft input rendered
// with no accessible name — the select announced only its current value, and
// the input fell back to its "new-branch" placeholder. The sibling repo-path
// input got its label in #157; these two are the stragglers.
describe("git branch controls", () => {
  const initial = useGitStore.getState();

  beforeEach(() => {
    useGitStore.setState({
      ...initial,
      loading: false,
      error: undefined,
      refresh: vi.fn().mockResolvedValue(undefined),
      // The full GitStatusSummary shape from the generated bindings — the
      // component indexes remotes/files/branches directly.
      status: {
        repoRoot: "/tmp/repo",
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        clean: true,
        files: [],
        recentCommits: [],
        remotes: [],
        branches: [{ name: "main", upstream: "origin/main" }],
      } as never,
    });
  });

  afterEach(() => {
    useGitStore.setState(initial, true);
  });

  it("names the branch switcher select", () => {
    renderUi(<GitPanel variant="sidebar" />);

    expect(screen.getByRole("combobox", { name: "Switch branch" })).toHaveValue(
      "main",
    );
  });

  it("names the new-branch input beyond its placeholder", () => {
    renderUi(<GitPanel variant="sidebar" />);

    const input = screen.getByRole("textbox", { name: "New branch name" });
    expect(input).toHaveAttribute("placeholder", "new-branch");
  });
});
