import { AlertTriangle, XCircle } from "lucide-react";
import type { JobList, JobSummary } from "../../../generated/irodori-api";
import type { TranslateFn } from "./shared";

function toCount(value: bigint | number) {
  return Number(value).toLocaleString();
}

function formatJobKind(kind: JobSummary["kind"]) {
  switch (kind) {
    case "knowledgeRefresh":
      return "Knowledge refresh";
    case "indexBuild":
      return "Index build";
    case "mlEvaluation":
      return "ML evaluation";
    case "bulkEdit":
      return "Bulk edit";
    case "sourceScan":
      return "Source scan";
    default:
      return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

function formatJobTime(value?: bigint) {
  if (value === undefined) {
    return "-";
  }
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatJobProgress(job: JobSummary) {
  const progress = job.progress;
  if (progress.total !== undefined) {
    return `${toCount(progress.completed)} / ${toCount(progress.total)} ${progress.unit}`;
  }
  if (progress.completed > 0n) {
    return `${toCount(progress.completed)} ${progress.unit}`;
  }
  return progress.message ?? "Waiting";
}

export interface JobsTabProps {
  t: TranslateFn;
  jobs: JobList;
  jobsLoading: boolean;
  jobsError: string | null;
  refreshJobs: () => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
}

export function JobsTab({
  t,
  jobs,
  jobsLoading,
  jobsError,
  refreshJobs,
  cancelJob,
}: JobsTabProps) {
  return (
    <div className="settings-jobs">
      <div className="settings-json-toolbar">
        <span>
          <strong>{t("settings.jobs.title")}</strong>
          <small>{t("settings.jobs.description")}</small>
        </span>
        <button
          className="text-button"
          type="button"
          onClick={() => void refreshJobs()}
          disabled={jobsLoading}
        >
          {jobsLoading ? t("common.refreshing") : t("common.refresh")}
        </button>
      </div>
      {jobsError ? (
        <div className="inline-error settings-json-error">
          <AlertTriangle size={13} />
          <span>{jobsError}</span>
        </div>
      ) : null}
      <section className="jobs-section">
        <div className="jobs-section-title">
          <strong>{t("settings.jobs.active")}</strong>
          <span>{jobs.active.length}</span>
        </div>
        {jobs.active.length > 0 ? (
          <div className="jobs-list">
            {jobs.active.map((job) => (
              <div className="job-row" key={job.id}>
                <div className="job-main">
                  <strong>{job.title}</strong>
                  <small>
                    {formatJobKind(job.kind)} · {job.status} ·{" "}
                    {formatJobProgress(job)}
                  </small>
                  {job.progress.percent !== undefined ? (
                    <div className="job-progress">
                      <span style={{ width: `${job.progress.percent}%` }} />
                    </div>
                  ) : null}
                </div>
                <div className="job-meta">
                  <small>
                    {t("settings.jobs.attempt", {
                      attempt: job.attempt,
                    })}
                  </small>
                  <button
                    className="icon-button"
                    type="button"
                    title={t("settings.jobs.cancel")}
                    aria-label={t("settings.jobs.cancel")}
                    disabled={job.cancelRequested || job.status === "cancelling"}
                    onClick={() => void cancelJob(job.id)}
                  >
                    <XCircle size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-browser">{t("settings.jobs.noActive")}</div>
        )}
      </section>
      <section className="jobs-section">
        <div className="jobs-section-title">
          <strong>{t("settings.jobs.history")}</strong>
          <span>{jobs.history.length}</span>
        </div>
        {jobs.history.length > 0 ? (
          <div className="jobs-list">
            {jobs.history.map((job) => (
              <div className={`job-row ${job.status}`} key={job.id}>
                <div className="job-main">
                  <strong>{job.title}</strong>
                  <small>
                    {formatJobKind(job.kind)} · {job.status} ·{" "}
                    {formatJobTime(job.finishedAtMs ?? job.updatedAtMs)}
                  </small>
                  {job.error ? (
                    <small className="job-error">{job.error.message}</small>
                  ) : job.latestLogMessage ? (
                    <small>{job.latestLogMessage}</small>
                  ) : null}
                </div>
                <div className="job-meta">
                  <small>
                    {job.artifactCount
                      ? t("settings.jobs.artifacts", {
                          count: job.artifactCount,
                        })
                      : t("settings.jobs.noArtifacts")}
                  </small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-browser">{t("settings.jobs.noFinished")}</div>
        )}
      </section>
    </div>
  );
}
