import { Copy, Info, Settings } from "lucide-react";

export function AboutDialog({
  appName,
  appVersion,
  appIdentifier,
  runtimeLabel,
  activeConnectionLabel,
  onClose,
  onOpenSettings,
  onCopyDiagnostics,
}: {
  appName: string;
  appVersion: string;
  appIdentifier: string;
  runtimeLabel: string;
  activeConnectionLabel: string;
  onClose: () => void;
  onOpenSettings: () => void;
  onCopyDiagnostics: () => void;
}) {
  return (
    <div className="palette-overlay" onClick={onClose} role="presentation">
      <div
        className="data-dialog about-dialog"
        role="dialog"
        aria-label={`About ${appName}`}
        onClick={(event) => event.stopPropagation()}
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
              Use Connection Manager for saved database profiles, Settings for
              editor/keymap/JSON configuration, and the workspace menu for
              support diagnostics.
            </span>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="text-button" type="button" onClick={onOpenSettings}>
            <Settings size={13} />
            Settings
          </button>
          <button
            className="text-button"
            type="button"
            onClick={onCopyDiagnostics}
          >
            <Copy size={13} />
            Copy diagnostics
          </button>
        </div>
      </div>
    </div>
  );
}
