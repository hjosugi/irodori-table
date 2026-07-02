import { BookOpen, Bug, Copy, ExternalLink, Info } from "lucide-react";
import { DialogShell } from "@/components/DialogShell";
import { openExternalUrl } from "@/features/settings/tabs/shared";

const DOCS_URL = "https://hjosugi.github.io/irodori-docs/";
const REPO_URL = "https://github.com/hjosugi/irodori-table";
const ISSUES_URL = "https://github.com/hjosugi/irodori-table/issues";

export function AboutDialog({
  appName,
  appVersion,
  appIdentifier,
  runtimeLabel,
  activeConnectionLabel,
  onClose,
  onCopyDiagnostics,
}: {
  appName: string;
  appVersion: string;
  appIdentifier: string;
  runtimeLabel: string;
  activeConnectionLabel: string;
  onClose: () => void;
  onCopyDiagnostics: () => void;
}) {
  return (
    <DialogShell
      className="data-dialog about-dialog"
      label={`About ${appName}`}
      onClose={onClose}
    >
      <div className="dialog-header">
        <strong>About {appName}</strong>
        <span>Version and support information</span>
        <button className="text-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="about-body">
        <div className="about-mark">
          <img className="about-icon" src="/irodori-icon.svg" alt="" />
          <span>
            <strong>{appName}</strong>
            <small>Database workbench</small>
          </span>
        </div>
        <dl className="about-grid">
          <div>
            <dt>Version</dt>
            <dd>{appVersion}</dd>
          </div>
          <div>
            <dt>Identifier</dt>
            <dd>{appIdentifier}</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>{runtimeLabel}</dd>
          </div>
          <div>
            <dt>Active connection</dt>
            <dd>{activeConnectionLabel}</dd>
          </div>
        </dl>
        <div className="about-help">
          <Info size={16} />
          <span>
            Use Connection Manager for saved database profiles, and copy
            diagnostics when sharing runtime details for support.
          </span>
        </div>
        <div className="about-links">
          <button
            className="text-button"
            type="button"
            onClick={() => openExternalUrl(DOCS_URL)}
          >
            <BookOpen size={13} />
            Documentation
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => openExternalUrl(REPO_URL)}
          >
            <ExternalLink size={13} />
            GitHub
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => openExternalUrl(ISSUES_URL)}
          >
            <Bug size={13} />
            Report an issue
          </button>
        </div>
      </div>
      <div className="dialog-footer">
        <button
          className="text-button"
          type="button"
          onClick={onCopyDiagnostics}
        >
          <Copy size={13} />
          Copy diagnostics
        </button>
      </div>
    </DialogShell>
  );
}
