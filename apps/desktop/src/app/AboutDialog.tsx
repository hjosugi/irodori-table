import { useEffect, useState } from "react";
import { BookOpen, Bug, Copy, ExternalLink, Info } from "lucide-react";
import { DialogShell } from "@/components/DialogShell";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
import { openExternalUrl } from "@/features/settings/tabs/shared";
import {
  crashReportStatus,
  type CrashReportStatus,
} from "@/generated/irodori-api";

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
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const [crashReport, setCrashReport] = useState<CrashReportStatus | null>(
    null,
  );
  const [crashPathCopyStatus, setCrashPathCopyStatus] = useState<
    "idle" | "copied" | "failed"
  >("idle");

  // Show copy feedback briefly, then return the button to its resting label.
  useEffect(() => {
    if (crashPathCopyStatus === "idle") {
      return;
    }
    const handle = window.setTimeout(
      () => setCrashPathCopyStatus("idle"),
      2000,
    );
    return () => window.clearTimeout(handle);
  }, [crashPathCopyStatus]);

  useEffect(() => {
    let cancelled = false;
    void crashReportStatus()
      .then((status) => {
        if (!cancelled) {
          setCrashReport(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCrashReport(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyCrashReportPath() {
    const path = crashReport?.latestBundleDir;
    if (!path) {
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      setCrashPathCopyStatus("copied");
    } catch {
      setCrashPathCopyStatus("failed");
    }
  }

  return (
    <DialogShell
      className="data-dialog about-dialog"
      label={t("about.title", { name: appName })}
      onClose={onClose}
    >
      <div className="dialog-header">
        <strong>{t("about.title", { name: appName })}</strong>
        <span>{t("about.subtitle")}</span>
        <button className="text-button" type="button" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
      <div className="about-body">
        <div className="about-mark">
          <img className="about-icon" src="/irodori-icon.svg" alt="" />
          <span>
            <strong>{appName}</strong>
            <small>{t("about.tagline")}</small>
          </span>
        </div>
        <dl className="about-grid">
          <div>
            <dt>{t("about.version")}</dt>
            <dd>{appVersion}</dd>
          </div>
          <div>
            <dt>{t("about.identifier")}</dt>
            <dd>{appIdentifier}</dd>
          </div>
          <div>
            <dt>{t("about.runtime")}</dt>
            <dd>{runtimeLabel}</dd>
          </div>
          <div>
            <dt>{t("about.activeConnection")}</dt>
            <dd>{activeConnectionLabel}</dd>
          </div>
          {crashReport ? (
            <div>
              <dt>{t("about.logDirectory")}</dt>
              <dd className="about-path" title={crashReport.logDir}>
                {crashReport.logDir}
              </dd>
            </div>
          ) : null}
          {crashReport?.latestBundleDir ? (
            <div>
              <dt>{t("about.previousCrash")}</dt>
              <dd className="about-path" title={crashReport.latestBundleDir}>
                {crashReport.latestBundleDir}
              </dd>
            </div>
          ) : null}
        </dl>
        {crashReport?.latestBundleDir ? (
          <div className="about-help">
            <Info size={16} />
            <span>{t("about.crashHelp")}</span>
          </div>
        ) : null}
        <div className="about-help">
          <Info size={16} />
          <span>{t("about.supportHelp")}</span>
        </div>
        <div className="about-links">
          <button
            className="text-button"
            type="button"
            onClick={() => openExternalUrl(DOCS_URL)}
          >
            <BookOpen size={13} />
            {t("about.docs")}
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => openExternalUrl(REPO_URL)}
          >
            <ExternalLink size={13} />
            {t("about.github")}
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => openExternalUrl(ISSUES_URL)}
          >
            <Bug size={13} />
            {t("about.reportIssue")}
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
          {t("about.copyDiagnostics")}
        </button>
        {crashReport?.latestBundleDir ? (
          <button
            className="text-button"
            type="button"
            onClick={() => void copyCrashReportPath()}
          >
            <Copy size={13} />
            {crashPathCopyStatus === "copied"
              ? t("about.crashPathCopied")
              : crashPathCopyStatus === "failed"
                ? t("about.copyFailed")
                : t("about.copyCrashPath")}
          </button>
        ) : null}
      </div>
    </DialogShell>
  );
}
