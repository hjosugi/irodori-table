import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileDiff,
  GitBranch,
  RefreshCw,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useConfirm } from "@/components/ConfirmDialog";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
import { GitChangesView } from "./GitChangesView";
import { GitGraphView } from "./GitGraphView";
import { branchSummary, gitAccentColor, providerLabel } from "./git-format";
import { useGitStore } from "./git-store";

function ViewButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "active" : undefined}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

type GitPanelProps = {
  variant?: "drawer" | "sidebar";
  onClose?: () => void;
};

export function GitPanel({ variant = "drawer", onClose }: GitPanelProps) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const { confirm, confirmElement } = useConfirm();

  // Clicking the sidebar Git tab mounts this panel directly - it does not go
  // through openDrawer()/openGitPanel(), which were the only callers of
  // refresh(). Without this a cold start showed "No commits" with no error and
  // no sign that nothing had even been attempted (#123). Read the store
  // imperatively so a re-mount with data already loaded stays quiet.
  useEffect(() => {
    const { status: current, loading: busy } = useGitStore.getState();
    if (!current && !busy) {
      void useGitStore.getState().refresh();
    }
  }, []);
  const view = useGitStore((state) => state.view);
  const repoPath = useGitStore((state) => state.repoPath);
  const repoPathDraft = useGitStore((state) => state.repoPathDraft);
  const repoColors = useGitStore((state) => state.repoColors);
  const status = useGitStore((state) => state.status);
  const graphCommits = useGitStore((state) => state.graphCommits);
  const selectedCommitHash = useGitStore((state) => state.selectedCommitHash);
  const commitDiff = useGitStore((state) => state.commitDiff);
  const selectedCommitPath = useGitStore((state) => state.selectedCommitPath);
  const graphQuery = useGitStore((state) => state.graphQuery);
  const graphRefFilter = useGitStore((state) => state.graphRefFilter);
  const diff = useGitStore((state) => state.diff);
  const selectedPath = useGitStore((state) => state.selectedPath);
  const branchDraft = useGitStore((state) => state.branchDraft);
  const loading = useGitStore((state) => state.loading);
  const logLoading = useGitStore((state) => state.logLoading);
  const diffLoading = useGitStore((state) => state.diffLoading);
  const commitDiffLoading = useGitStore((state) => state.commitDiffLoading);
  const error = useGitStore((state) => state.error);
  const commandOutput = useGitStore((state) => state.commandOutput);
  const commitMessage = useGitStore((state) => state.commitMessage);
  const closeDrawer = useGitStore((state) => state.closeDrawer);
  const closePanel = onClose ?? closeDrawer;
  const refresh = useGitStore((state) => state.refresh);
  const setView = useGitStore((state) => state.setView);
  const setRepoPath = useGitStore((state) => state.setRepoPath);
  const setRepoPathDraft = useGitStore((state) => state.setRepoPathDraft);
  const setRepoColor = useGitStore((state) => state.setRepoColor);
  const setGraphQuery = useGitStore((state) => state.setGraphQuery);
  const setGraphRefFilter = useGitStore((state) => state.setGraphRefFilter);
  const selectCommit = useGitStore((state) => state.selectCommit);
  const selectCommitFile = useGitStore((state) => state.selectCommitFile);
  const selectFile = useGitStore((state) => state.selectFile);
  const setCommitMessage = useGitStore((state) => state.setCommitMessage);
  const setBranchDraft = useGitStore((state) => state.setBranchDraft);
  const commitAll = useGitStore((state) => state.commitAll);
  const commitStaged = useGitStore((state) => state.commitStaged);
  const fetch = useGitStore((state) => state.fetch);
  const pull = useGitStore((state) => state.pull);
  const push = useGitStore((state) => state.push);
  const stagePaths = useGitStore((state) => state.stagePaths);
  const unstagePaths = useGitStore((state) => state.unstagePaths);
  const discardPaths = useGitStore((state) => state.discardPaths);
  const checkoutBranch = useGitStore((state) => state.checkoutBranch);
  const createBranch = useGitStore((state) => state.createBranch);
  const deleteBranch = useGitStore((state) => state.deleteBranch);

  const files = status?.files ?? [];
  const hasChanges = files.length > 0;
  const selectedFile = selectedPath
    ? (files.find((file) => file.path === selectedPath) ?? null)
    : null;
  const selectedPaths = selectedPath ? [selectedPath] : [];
  const primaryRemote = status?.remotes[0];
  const accentColor = gitAccentColor(
    primaryRemote?.provider,
    status ? repoColors[status.repoRoot] : undefined,
  );
  const drawerStyle = { "--git-accent": accentColor } as CSSProperties;

  async function onCommit() {
    if (!hasChanges) {
      return;
    }
    if (
      !(await confirm({
        title: t("git.confirm.commitAll.title"),
        message: t("git.confirm.commitAll.message"),
        confirmLabel: t("git.actions.commit"),
      }))
    ) {
      return;
    }
    await commitAll();
  }

  async function onCommitStaged() {
    if (
      !(await confirm({
        title: t("git.confirm.commitStaged.title"),
        confirmLabel: t("git.actions.commit"),
      }))
    ) {
      return;
    }
    await commitStaged();
  }

  async function onPush() {
    if (
      !(await confirm({
        title: t("git.confirm.push.title"),
        message: t("git.confirm.push.message"),
        confirmLabel: t("git.actions.push"),
      }))
    ) {
      return;
    }
    await push();
  }

  async function onPull() {
    if (
      !(await confirm({
        title: t("git.confirm.pull.title"),
        message: t("git.confirm.pull.message"),
        confirmLabel: t("git.actions.pull"),
      }))
    ) {
      return;
    }
    await pull();
  }

  async function onDiscardSelected() {
    if (!selectedPath) {
      return;
    }
    if (
      !(await confirm({
        title: t("git.confirm.discard.title"),
        message: t("git.confirm.discard.message", { path: selectedPath }),
        confirmLabel: t("git.actions.discard"),
        tone: "danger",
      }))
    ) {
      return;
    }
    await discardPaths([selectedPath]);
  }

  async function onBrowseRepo() {
    const result = await openDialog({
      directory: true,
      multiple: false,
      title: t("git.selectRepository"),
    });
    if (typeof result === "string") {
      setRepoPath(result);
    }
  }

  async function onCheckoutBranch(branch: string) {
    if (!branch || branch === status?.branch) {
      return;
    }
    if (
      hasChanges &&
      !(await confirm({
        title: t("git.confirm.switchBranch.title", { branch }),
        message: t("git.confirm.localChangesCarry"),
        confirmLabel: t("git.actions.switch"),
      }))
    ) {
      return;
    }
    await checkoutBranch(branch);
  }

  async function onCreateBranch(branch: string, startPoint?: string) {
    const target = branch.trim();
    if (!target) {
      return;
    }
    if (
      hasChanges &&
      !(await confirm({
        title: t("git.confirm.createBranch.title", { branch: target }),
        message: t("git.confirm.localChangesCarry"),
        confirmLabel: t("git.actions.create"),
      }))
    ) {
      return;
    }
    await createBranch(target, startPoint);
  }

  async function onDeleteBranchName(branchName: string) {
    const branch = branchName.trim();
    if (!branch) {
      return;
    }
    if (branch === status?.branch) {
      await confirm({
        title: t("git.confirm.deleteCurrent.title"),
        message: t("git.confirm.deleteCurrent.message"),
        confirmLabel: t("common.ok"),
        hideCancel: true,
      });
      return;
    }
    if (
      !(await confirm({
        title: t("git.confirm.deleteBranch.title", { branch }),
        message: t("confirm.cannotUndo"),
        confirmLabel: t("common.delete"),
        tone: "danger",
      }))
    ) {
      return;
    }
    await deleteBranch(branch);
  }

  async function onDeleteBranchDraft() {
    await onDeleteBranchName(branchDraft);
  }

  return (
    <div
      className={`git-drawer git-panel-${variant} ${error ? "has-error" : ""}`}
      role={variant === "drawer" ? "dialog" : "region"}
      aria-label={t("git.integration")}
      style={drawerStyle}
    >
      <div className="git-drawer-header">
        <span>
          <GitBranch size={16} />
          <strong>Git</strong>
        </span>
        <div
          className="segmented-control git-view-switch"
          aria-label={t("git.view")}
        >
          <ViewButton
            active={view === "graph"}
            label={t("git.views.graph")}
            onClick={() => setView("graph")}
          />
          <ViewButton
            active={view === "changes"}
            label={t("git.views.changes")}
            onClick={() => setView("changes")}
          />
        </div>
        <button
          className="icon-button"
          type="button"
          title={t("git.refresh")}
          aria-label={t("git.refresh")}
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw size={14} />
        </button>
        <button
          className="icon-button"
          type="button"
          title={t("git.close")}
          aria-label={t("git.close")}
          onClick={closePanel}
        >
          <X size={14} />
        </button>
      </div>

      {/* Kept outside the status guard: when no repository resolves, status is
          null, and hiding the path controls inside it left no way to point the
          panel anywhere (#123). */}
      <div className="git-repo-row">
        <input
          value={repoPathDraft}
          aria-label={t("git.repoPathLabel")}
          placeholder={repoPath || status?.repoRoot || ""}
          onChange={(event) => setRepoPathDraft(event.currentTarget.value)}
        />
        <button
          className="text-button"
          type="button"
          onClick={() => setRepoPath(repoPathDraft)}
        >
          {t("git.actions.use")}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => void onBrowseRepo()}
        >
          {t("git.actions.browse")}
        </button>
      </div>

      {status ? (
        <div className="git-branch-card">
          <span>
            <strong>
              {branchSummary(
                status.branch,
                status.upstream,
                status.ahead,
                status.behind,
              )}
            </strong>
            <small title={status.repoRoot}>{status.repoRoot}</small>
          </span>
          <span
            className={`git-clean-badge ${status.clean ? "clean" : "dirty"}`}
          >
            {status.clean ? <CheckCircle2 size={13} /> : <FileDiff size={13} />}
            {status.clean
              ? t("git.clean")
              : t("git.changesCount", { count: status.files.length })}
          </span>
          <div className="git-provider-row">
            {status.remotes.length > 0 ? (
              status.remotes.map((remote) => (
                <span className="git-provider-badge" key={remote.name}>
                  <i
                    style={{
                      background: gitAccentColor(
                        remote.provider,
                        repoColors[status.repoRoot],
                      ),
                    }}
                  />
                  {providerLabel(remote.provider)}
                  <small>{remote.name}</small>
                  {remote.webUrl ? (
                    <a
                      href={remote.webUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={remote.webUrl}
                    >
                      <ExternalLink size={11} />
                    </a>
                  ) : null}
                </span>
              ))
            ) : (
              <span className="git-provider-badge">
                <i style={{ background: accentColor }} />
                {t("git.localGit")}
              </span>
            )}
            <label className="git-color-picker">
              <span>{t("git.color")}</span>
              <input
                type="color"
                value={accentColor}
                onChange={(event) =>
                  setRepoColor(status.repoRoot, event.currentTarget.value)
                }
              />
            </label>
          </div>
          <div className="git-branch-row">
            <select
              value={status.branch}
              aria-label={t("git.branchSelectLabel")}
              onChange={(event) =>
                void onCheckoutBranch(event.currentTarget.value)
              }
            >
              {status.branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                  {branch.upstream ? ` -> ${branch.upstream}` : ""}
                </option>
              ))}
            </select>
            <input
              value={branchDraft}
              placeholder="new-branch"
              aria-label={t("git.newBranchLabel")}
              onChange={(event) => setBranchDraft(event.currentTarget.value)}
            />
            <button
              className="text-button"
              type="button"
              onClick={() => void onCreateBranch(branchDraft)}
            >
              {t("git.actions.create")}
            </button>
            <button
              className="text-button danger"
              type="button"
              disabled={!branchDraft.trim()}
              onClick={() => void onDeleteBranchDraft()}
            >
              {t("common.delete")}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="inline-error git-error">
          <AlertTriangle size={13} />
          <span>{error}</span>
        </div>
      ) : null}

      <div
        className={`git-drawer-body ${view === "graph" ? "graph-mode" : ""}`}
      >
        {view === "graph" ? (
          <GitGraphView
            commits={graphCommits}
            query={graphQuery}
            refFilter={graphRefFilter}
            selectedCommitHash={selectedCommitHash}
            commitDiff={commitDiff}
            selectedCommitPath={selectedCommitPath}
            remotes={status?.remotes ?? []}
            branches={status?.branches ?? []}
            currentBranch={status?.branch ?? null}
            loading={logLoading}
            commitDiffLoading={commitDiffLoading}
            onQueryChange={setGraphQuery}
            onRefFilterChange={setGraphRefFilter}
            onSelectCommit={selectCommit}
            onSelectCommitFile={(path) => void selectCommitFile(path)}
            onCheckoutBranch={(branch) => void onCheckoutBranch(branch)}
            onCreateBranch={(branch, startPoint) =>
              void onCreateBranch(branch, startPoint)
            }
            onDeleteBranch={(branch) => void onDeleteBranchName(branch)}
            t={t}
          />
        ) : (
          <GitChangesView
            files={files}
            selectedPath={selectedPath}
            diff={diff}
            loading={loading}
            diffLoading={diffLoading}
            commitMessage={commitMessage}
            commandOutput={commandOutput}
            selectedFile={selectedFile}
            onSelectFile={(path) => void selectFile(path)}
            onCommitMessageChange={setCommitMessage}
            onCommit={() => void onCommit()}
            onCommitStaged={() => void onCommitStaged()}
            onFetch={() => void fetch()}
            onPull={() => void onPull()}
            onPush={() => void onPush()}
            onStageSelected={() => void stagePaths(selectedPaths)}
            onStageAll={() => void stagePaths(files.map((file) => file.path))}
            onUnstageSelected={() => void unstagePaths(selectedPaths)}
            onDiscardSelected={() => void onDiscardSelected()}
            t={t}
          />
        )}
      </div>
      {confirmElement}
    </div>
  );
}

export function GitDrawer() {
  const open = useGitStore((state) => state.open);
  if (!open) {
    return null;
  }
  return <GitPanel variant="drawer" />;
}
