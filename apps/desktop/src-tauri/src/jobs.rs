use irodori_core::{JobList, JobRecord, JobRuntime, Result as IrodoriResult};
use tauri::State;

#[derive(Default)]
pub struct JobState {
    runtime: JobRuntime,
}

impl JobState {
    pub fn runtime(&self) -> &JobRuntime {
        &self.runtime
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
