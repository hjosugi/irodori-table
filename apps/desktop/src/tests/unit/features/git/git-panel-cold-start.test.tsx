// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitPanel } from "@/features/git/GitDrawer";
import { useGitStore } from "@/features/git/git-store";
import { renderUi } from "../../../helpers/render";

// The owner opened the Git tab, saw an empty commit list, and could not work
// out how to configure it (#123). Two causes, each pinned here:
//
// - Only openDrawer()/openGitPanel() called refresh(). Selecting the sidebar
//   tab mounts the panel without either, so nothing was ever fetched and the
//   panel showed "No commits" with no error.
// - The repo-path input and its Use/Browse buttons lived inside the
//   `{status ? … : null}` branch card, so they were hidden exactly when no
//   repository had resolved — the one moment they are needed.
describe("git panel cold start", () => {
  const initial = useGitStore.getState();

  beforeEach(() => {
    useGitStore.setState({
      ...initial,
      status: undefined,
      loading: false,
      error: undefined,
    });
  });

  afterEach(() => {
    useGitStore.setState(initial, true);
  });

  it("attempts a refresh when mounted with nothing loaded", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useGitStore.setState({ refresh });

    renderUi(<GitPanel variant="sidebar" />);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refetch when a status is already loaded", () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useGitStore.setState({
      refresh,
      // The full GitStatusSummary shape from the generated bindings - the
      // component indexes remotes/files/branches directly, so a partial fake
      // crashes the render instead of exercising the guard.
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
        branches: [],
      } as never,
    });

    renderUi(<GitPanel variant="sidebar" />);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the repository path controls when no repository resolved", () => {
    useGitStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) });

    const { getByRole } = renderUi(<GitPanel variant="sidebar" />);

    expect(getByRole("textbox", { name: "Repository path" })).toBeVisible();
    expect(getByRole("button", { name: "Use" })).toBeVisible();
    expect(getByRole("button", { name: "Browse" })).toBeVisible();
  });
});
