use std::sync::Arc;

use irodori_core::{JobList, JobRecord, JobRuntime, Result as IrodoriResult};
use tauri::State;

pub struct JobState {
    runtime: Arc<JobRuntime>,
}

impl Default for JobState {
    fn default() -> Self {
        Self {
            runtime: Arc::new(JobRuntime::default()),
        }
    }
}

impl JobState {
    pub fn runtime(&self) -> &JobRuntime {
        &self.runtime
    }

    /// A shared owning handle so a background task can keep driving the runtime
    /// after the spawning command returns — the dashboard then shows live progress
    /// and can cancel the in-flight job.
    pub fn runtime_arc(&self) -> Arc<JobRuntime> {
        Arc::clone(&self.runtime)
    }
}

#[tauri::command]
pub fn jobs_list(state: State<'_, JobState>) -> JobList {
    state.runtime().list()
}

#[tauri::command]
pub fn jobs_get(state: State<'_, JobState>, job_id: String) -> IrodoriResult<Option<JobRecord>> {
    Ok(state.runtime().get(&job_id))
}

#[tauri::command]
pub fn jobs_cancel(state: State<'_, JobState>, job_id: String) -> IrodoriResult<JobRecord> {
    state.runtime().request_cancel(&job_id)
}
