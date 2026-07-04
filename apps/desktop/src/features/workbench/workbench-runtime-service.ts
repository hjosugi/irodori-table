import {
  jobsCancel,
  jobsList,
  openDeveloperTools,
  workspaceSnapshot,
  type JobList,
  type WorkspaceSnapshot,
} from "@/generated/irodori-api";

export interface WorkbenchRuntimeService {
  snapshot(): Promise<WorkspaceSnapshot>;
  jobsList(): Promise<JobList>;
  jobsCancel(jobId: string): Promise<boolean>;
  openDeveloperTools(): Promise<void>;
}

export const tauriWorkbenchRuntimeService: WorkbenchRuntimeService = {
  snapshot: workspaceSnapshot,
  jobsList,
  jobsCancel,
  openDeveloperTools,
};

export const workbenchRuntimeService = tauriWorkbenchRuntimeService;
