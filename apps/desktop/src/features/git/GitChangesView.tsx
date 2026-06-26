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
      title={file.originalPath ? `${file.originalPath} -> ${file.path}` : file.path}
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
          <strong>Changes</strong>
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
            Stage
          </button>
          <button
            className="text-button"
            type="button"
            disabled={!hasChanges || loading}
            onClick={onStageAll}
          >
            <Plus size={13} />
            Stage all
          </button>
          <button
            className="text-button"
            type="button"
            disabled={!canUnstageSelected || loading}
            onClick={onUnstageSelected}
          >
            <Undo2 size={13} />
            Unstage
          </button>
          <button
            className="text-button danger"
            type="button"
            disabled={!selectedFile || loading}
            onClick={onDiscardSelected}
          >
            <RotateCcw size={13} />
            Discard
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
              {loading ? "Loading Git status..." : "No local changes"}
            </div>
          )}
        </div>
      </section>

      <section className="git-section git-diff">
        <div className="git-section-title">
          <strong>{selectedPath ?? "Repository diff"}</strong>
          {diff?.truncated ? <span>truncated</span> : null}
        </div>
        <pre>{diffLoading ? "Loading diff..." : diffText || "No diff"}</pre>
      </section>

      <section className="git-section">
        <div className="git-section-title">
          <strong>Commit</strong>
        </div>
        <textarea
          value={commitMessage}
          placeholder="Commit message"
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
            Fetch
          </button>
          <button
            className="text-button"
            type="button"
            disabled={loading}
            onClick={onPull}
          >
            <Download size={14} />
            Pull
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!hasChanges || loading || !commitMessage.trim()}
            onClick={onCommit}
          >
            <GitCommitHorizontal size={14} />
            Commit all
          </button>
          <button
            className="text-button"
            type="button"
            disabled={!hasStagedChanges || loading || !commitMessage.trim()}
            onClick={onCommitStaged}
          >
            <GitCommitHorizontal size={14} />
            Commit staged
          </button>
          <button
            className="text-button"
            type="button"
            disabled={loading}
            onClick={onPush}
          >
            <Upload size={14} />
            Push
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
