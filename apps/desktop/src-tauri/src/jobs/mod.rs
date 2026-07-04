use std::sync::Arc;

use irodori_error::Result as IrodoriResult;
use irodori_jobs::{JobList, JobRecord, JobRuntime};
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
    /// after the spawning command returns.
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
pub fn jobs_cancel(state: State<'_, JobState>, job_id: String) -> IrodoriResult<bool> {
    state.runtime().request_cancel(&job_id)?;
    Ok(true)
}
