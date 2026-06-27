use super::*;

fn runtime() -> JobRuntime {
    JobRuntime::new(JobRuntimeConfig {
        max_concurrent_jobs: 1,
        max_history: 2,
    })
}

#[test]
fn job_lifecycle_tracks_progress_logs_artifacts_and_success() {
    let runtime = runtime();
    let mut spec = JobSpec::new(JobKind::Export, "export result");
    spec.resumable = true;

    let queued = runtime.submit_with_id("job.export.1", spec).unwrap();
    assert_eq!(queued.status, JobStatus::Queued);
    assert_eq!(queued.logs.len(), 1);

    let started = runtime.start("job.export.1").unwrap();
    assert_eq!(started.status, JobStatus::Running);
    assert_eq!(started.attempt, 1);

    let progressed = runtime
        .update_progress("job.export.1", 50, Some(100), "rows", Some("half".into()))
        .unwrap();
    assert_eq!(progressed.progress.percent, Some(50));

    let checkpoint = JobCheckpoint::new(1, "row:50", r#"{"row":50}"#);
    assert_eq!(
        runtime
            .update_checkpoint("job.export.1", checkpoint.clone())
            .unwrap()
            .checkpoint,
        Some(checkpoint)
    );

    runtime
        .add_artifact(
            "job.export.1",
            JobArtifact {
                id: "csv".into(),
                name: "CSV".into(),
                path: "/tmp/result.csv".into(),
                media_type: Some("text/csv".into()),
                size_bytes: Some(128),
            },
        )
        .unwrap();

    let done = runtime.succeed("job.export.1", "export finished").unwrap();
    assert_eq!(done.status, JobStatus::Succeeded);
    assert_eq!(done.progress.percent, Some(100));
    assert_eq!(done.artifacts.len(), 1);
    assert_eq!(runtime.list().history.len(), 1);
}

#[test]
fn global_and_group_concurrency_limits_are_enforced() {
    let runtime = runtime();
    runtime
        .submit_with_id("job.one", JobSpec::new(JobKind::IndexBuild, "one"))
        .unwrap();
    runtime
        .submit_with_id("job.two", JobSpec::new(JobKind::IndexBuild, "two"))
        .unwrap();
    runtime.start("job.one").unwrap();
    let error = runtime.start("job.two").unwrap_err();
    assert_eq!(error.kind, crate::IrodoriErrorKind::Validation);

    let grouped = JobRuntime::new(JobRuntimeConfig {
        max_concurrent_jobs: 4,
        max_history: 10,
    });
    let mut spec = JobSpec::new(JobKind::Import, "a");
    spec.concurrency.group = "imports".into();
    spec.concurrency.max_concurrent_in_group = Some(1);
    grouped.submit_with_id("job.a", spec.clone()).unwrap();
    spec.title = "b".into();
    grouped.submit_with_id("job.b", spec).unwrap();
    grouped.start("job.a").unwrap();
    assert_eq!(
        grouped.start("job.b").unwrap_err().kind,
        crate::IrodoriErrorKind::Validation
    );
}

#[test]
fn cancel_request_marks_running_jobs_cancelling_and_queued_jobs_cancelled() {
    let runtime = runtime();
    runtime
        .submit_with_id("job.running", JobSpec::new(JobKind::SourceScan, "running"))
        .unwrap();
    runtime.start("job.running").unwrap();
    let cancelling = runtime.request_cancel("job.running").unwrap();
    assert_eq!(cancelling.status, JobStatus::Cancelling);
    assert!(runtime.should_cancel("job.running"));
    let cancelled = runtime
        .mark_cancelled("job.running", "worker stopped")
        .unwrap();
    assert_eq!(cancelled.status, JobStatus::Cancelled);

    runtime
        .submit_with_id("job.queued", JobSpec::new(JobKind::SourceScan, "queued"))
        .unwrap();
    let queued = runtime.request_cancel("job.queued").unwrap();
    assert_eq!(queued.status, JobStatus::Cancelled);
}

#[test]
fn failed_jobs_requeue_until_retry_policy_is_exhausted() {
    let runtime = runtime();
    let mut spec = JobSpec::new(JobKind::KnowledgeRefresh, "refresh");
    spec.retry = JobRetryPolicy::with_retries(2);
    runtime.submit_with_id("job.retry", spec).unwrap();
    runtime.start("job.retry").unwrap();

    let retrying = runtime
        .fail("job.retry", IrodoriError::from("network timed out"))
        .unwrap();
    assert_eq!(retrying.status, JobStatus::Queued);
    assert!(retrying.next_retry_at_ms.is_some());

    runtime.start("job.retry").unwrap();
    let failed = runtime
        .fail("job.retry", IrodoriError::from("network timed out again"))
        .unwrap();
    assert_eq!(failed.status, JobStatus::Failed);
    assert!(failed.finished_at_ms.is_some());
}
