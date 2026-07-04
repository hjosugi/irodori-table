import {
  Download,
  GitCommitHorizontal,
  Plus,
  RotateCcw,
  Undo2,
  Upload,
} from "lucide-react";
import type {
  GitDiffResult,
  GitFileStatus,
  GitCommandOutput,
} from "../../generated/irodori-api";
import type { Translator } from "@/i18n";
import { changeLabel } from "./git-format";

function FileStatusRow({
  file,
  selected,
  onSelect,
}: {
  file: GitFileStatus;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`git-file-row ${selected ? "active" : ""} ${file.kind}`}
      type="button"
      title={
        file.originalPath ? `${file.originalPath} -> ${file.path}` : file.path
      }
      onClick={onSelect}
    >
      <span className="git-file-kind">{changeLabel(file.kind)}</span>
      <span className="git-file-path">
        {file.originalPath ? (
          <>
            <small>{file.originalPath}</small>
            {file.path}
          </>
        ) : (
          file.path
        )}
      </span>
      <small>
        {file.indexStatus.trim() || "-"}
        {file.worktreeStatus.trim() || "-"}
      </small>
    </button>
  );
}

export function GitChangesView({
  files,
  selectedPath,
  diff,
  loading,
  diffLoading,
  commitMessage,
  commandOutput,
  selectedFile,
  onSelectFile,
  onCommitMessageChange,
  onCommit,
  onCommitStaged,
  onFetch,
  onPull,
  onPush,
  onStageSelected,
  onStageAll,
  onUnstageSelected,
  onDiscardSelected,
  t,
}: {
  files: GitFileStatus[];
  selectedPath: string | null;
  diff: GitDiffResult | null;
  loading: boolean;
  diffLoading: boolean;
  commitMessage: string;
  commandOutput: GitCommandOutput | null;
  selectedFile: GitFileStatus | null;
  onSelectFile: (path: string) => void;
  onCommitMessageChange: (message: string) => void;
  onCommit: () => void;
  onCommitStaged: () => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onStageSelected: () => void;
  onStageAll: () => void;
  onUnstageSelected: () => void;
  onDiscardSelected: () => void;
  t: Translator["t"];
}) {
  const hasChanges = files.length > 0;
  const hasStagedChanges = files.some(
    (file) => file.indexStatus.trim() && file.indexStatus !== "?",
  );
  const canStageSelected = selectedFile !== null;
  const canUnstageSelected =
    selectedFile !== null &&
    selectedFile.indexStatus.trim().length > 0 &&
    selectedFile.indexStatus !== "?";
  const diffText = [
    diff?.staged ? `# Staged\n${diff.staged}` : "",
    diff?.unstaged ? `# Unstaged\n${diff.unstaged}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <>
      <section className="git-section git-files">
        <div className="git-section-title">
          <strong>{t("git.views.changes")}</strong>
          <span>{files.length}</span>
        </div>
        <div className="git-file-actions">
          <button
            className="text-button"
            type="button"
            disabled={!canStageSelected || loading}
            onClick={onStageSelected}
          >
            <Plus size={13} />
            {t("git.actions.stage")}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={!hasChanges || loading}
            onClick={onStageAll}
          >
            <Plus size={13} />
            {t("git.actions.stageAll")}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={!canUnstageSelected || loading}
            onClick={onUnstageSelected}
          >
            <Undo2 size={13} />
            {t("git.actions.unstage")}
          </button>
          <button
            className="text-button danger"
            type="button"
            disabled={!selectedFile || loading}
            onClick={onDiscardSelected}
          >
            <RotateCcw size={13} />
            {t("git.actions.discard")}
          </button>
        </div>
        <div className="git-file-list">
          {files.length ? (
            files.map((file) => (
              <FileStatusRow
                key={`${file.originalPath ?? ""}:${file.path}`}
                file={file}
                selected={selectedPath === file.path}
                onSelect={() => onSelectFile(file.path)}
              />
            ))
          ) : (
            <div className="empty-browser">
              {loading ? t("git.loadingStatus") : t("git.noLocalChanges")}
            </div>
          )}
        </div>
      </section>

      <section className="git-section git-diff">
        <div className="git-section-title">
          <strong>{selectedPath ?? t("git.repositoryDiff")}</strong>
          {diff?.truncated ? <span>{t("git.truncated")}</span> : null}
        </div>
        <pre>
          {diffLoading ? t("git.loadingDiff") : diffText || t("git.noDiff")}
        </pre>
      </section>

      <section className="git-section">
        <div className="git-section-title">
          <strong>{t("git.commit")}</strong>
        </div>
        <textarea
          value={commitMessage}
          placeholder={t("git.commitMessage")}
          spellCheck={true}
          onChange={(event) => onCommitMessageChange(event.currentTarget.value)}
        />
        <div className="git-action-row">
          <button
            className="text-button"
            type="button"
            disabled={loading}
            onClick={onFetch}
          >
            <Download size={14} />
            {t("git.actions.fetch")}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={loading}
            onClick={onPull}
          >
            <Download size={14} />
            {t("git.actions.pull")}
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!hasChanges || loading || !commitMessage.trim()}
            onClick={onCommit}
          >
            <GitCommitHorizontal size={14} />
            {t("git.actions.commitAll")}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={!hasStagedChanges || loading || !commitMessage.trim()}
            onClick={onCommitStaged}
          >
            <GitCommitHorizontal size={14} />
            {t("git.actions.commitStaged")}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={loading}
            onClick={onPush}
          >
            <Upload size={14} />
            {t("git.actions.push")}
          </button>
        </div>
        {commandOutput ? (
          <pre className="git-command-output">
            {[commandOutput.stdout, commandOutput.stderr]
              .filter(Boolean)
              .join("\n") || `exit ${commandOutput.statusCode}`}
          </pre>
        ) : null}
      </section>
    </>
  );
}
