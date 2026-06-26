import { GitCommitHorizontal, Upload } from "lucide-react";
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
  onSelectFile,
  onCommitMessageChange,
  onCommit,
  onPush,
}: {
  files: GitFileStatus[];
  selectedPath: string | null;
  diff: GitDiffResult | null;
  loading: boolean;
  diffLoading: boolean;
  commitMessage: string;
  commandOutput: GitCommandOutput | null;
  onSelectFile: (path: string) => void;
  onCommitMessageChange: (message: string) => void;
  onCommit: () => void;
  onPush: () => void;
}) {
  const hasChanges = files.length > 0;
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
