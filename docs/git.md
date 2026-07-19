# Git

A commit graph, a working-tree changes view, and branch controls, driven by the
`git` binary on your PATH. Everything runs through Tauri commands in
`apps/desktop/src-tauri/src/git/mod.rs`; there is no bundled git implementation.

> **Read this first if the panel looks empty.** The panel does not load itself
> when you open it from the sidebar, and its repository controls are hidden
> until a repository has been resolved. That combination makes a first-time
> panel look broken. The [Getting the panel to load](#getting-the-panel-to-load)
> section below is the workaround; the underlying bug is
> [issue #123](https://github.com/hjosugi/irodori-table/issues/123).

## Opening it

| Route | Loads data on open? |
| --- | --- |
| **View ▸ Open Git Panel** | Yes |
| Command palette (`Mod+Shift+P`) ▸ **Open Git Panel** | Yes |
| Clicking the **Git** tab in the sidebar rail | **No** |
| Panel restored on startup because it was open last session | **No** |

There is no default keyboard shortcut for `git.open`. You can assign one in
**Settings ▸ Keyboard Shortcuts**.

## Getting the panel to load

Only the `git.open` command calls the store's `refresh()`. Selecting the Git tab
in the sidebar calls `setActiveSidebarView` instead, which changes which panel is
visible and nothing else — so the panel mounts with its initial empty state: no
branch card, no commits, no error.

If you are looking at an empty Git panel:

1. Click the **refresh** button (circular-arrows icon) in the panel header. It
   is always visible, and it runs the same load the menu command does.
2. Or close the panel and reopen it from **View ▸ Open Git Panel**.

Either one populates the branch card, the commit graph, and the changes list —
provided a repository can be resolved. That is the second half of the problem.

## Which repository the panel uses

`refresh()` sends the stored repository path, or nothing at all when it is
empty. The Rust side resolves it like this:

1. If a path was supplied, use it. A non-repository path fails with
   `<path> is not a readable git repository: …`.
2. Otherwise, try the directory Irodori Table was **launched from**. If that
   directory is inside a work tree, its root is used.
3. Otherwise, fall back to a path baked in at compile time
   (`CARGO_MANIFEST_DIR/../../..`, the source workspace of the machine that
   built the binary). On an installed build this directory does not exist, and
   the call fails with `default workspace is not a git repository`.

So the panel works out of the box when you start the app from a terminal inside
a repository — which is what `make desktop-dev` and `make run-dev` do. Launched
from a desktop launcher or dock icon, the working directory is usually your home
directory or `/`, step 2 fails, step 3 fails, and you get the error banner.

**And this is the gap:** the repository path input, its **Use** button, and its
**Browse** button all live inside the branch card, which is only rendered once a
repository has been resolved. When resolution fails there is nothing on screen to
point the panel somewhere else.

Until [#123](https://github.com/hjosugi/irodori-table/issues/123) is fixed, the
options are:

- **Launch from inside the repository.** Start Irodori Table from a terminal
  whose working directory is in the work tree you want.
- **Resolve once, then re-point.** If any repository resolves, the branch card
  appears — type or **Browse** to another path and press **Use**. The choice is
  persisted (localStorage key `irodori.git.repoPath.v1`) and reused on the next
  launch regardless of working directory.

`git` must also be on the PATH of the process. If it is not, every call fails
with `git is not available: …`.

## Graph view

The default view. Loads the most recent **80** commits — the limit is fixed and
not exposed in the UI.

- **Search commits** filters the loaded commits client-side. It does not reach
  further back than those 80.
- The ref filter selects **All refs**, **Branches**, **Remotes**, or **Tags**.
- Selecting a commit loads its diff. Selecting a file within the commit narrows
  the diff to that file.
- Branch actions are available from the graph: check out, create from a commit,
  and delete.

## Changes view

The working tree. Select a file to see its staged and unstaged diff side by
side.

| Action | Applies to |
| --- | --- |
| **Stage** | The selected file |
| **Stage all** | Every changed file |
| **Unstage** | The selected file |
| **Discard** | The selected file — confirmation required, cannot be undone |
| **Commit all** | Every visible change, using the message box |
| **Commit staged** | Only what is staged |
| **Fetch** / **Pull** / **Push** | The current branch |

Commit, push, pull, and discard each open a confirmation dialog first. A commit
message is required — committing with an empty box sets the error
`Commit message is required` and does nothing.

Output from the last command is shown below the diff, so you can see what git
actually printed.

## Branches

In the branch card:

- The dropdown lists local branches with their upstreams and switches branch on
  selection. If the work tree is dirty you are warned that local changes carry
  over.
- The text box plus **Create** creates and checks out a branch.
- **Delete** removes the branch named in that same text box. Deleting the
  current branch is refused with an explanatory dialog.

Diffs are truncated past a fixed byte limit; the response carries a `truncated`
flag and the view says so rather than silently cutting.

## Remotes and colour

Detected remotes are shown as badges with the provider name (GitHub, GitLab, and
so on) and a link to the web URL where one can be derived. With no remotes the
badge reads **Local Git**.

The **Color** picker sets an accent colour per repository root, stored locally
(`irodori.git.repoColors.v1`). It is cosmetic — it tints the panel so multiple
repositories are visually distinguishable.

## Gaps

- **The panel does not load on mount, and the repo-path controls are hidden
  until it has** — [#123](https://github.com/hjosugi/irodori-table/issues/123).
  Described above.
- **No repository picker before first resolution.** There is no "open
  repository" affordance outside the branch card.
- **The commit limit is fixed at 80** with no paging or "load more".
- **No staging by hunk or line**, and no multi-select: **Stage** and **Discard**
  act on exactly one selected file. Only **Stage all** is a bulk action.
- **No merge, rebase, cherry-pick, stash, tag, or remote management.**
- **No credential prompt.** Fetch, pull, and push run with
  `GIT_TERMINAL_PROMPT=0`, so an operation needing interactive credentials fails
  rather than asking. Configure a credential helper or an SSH agent outside the
  app.
- **No conflict resolution UI.** A pull that conflicts reports git's output; you
  resolve it elsewhere.
