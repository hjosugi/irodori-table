import {
  jobsList,
  openDeveloperTools,
  workspaceSnapshot,
  type JobList,
  type WorkspaceSnapshot,
} from "@/generated/irodori-api";

export interface WorkbenchRuntimeService {
  snapshot(): Promise<WorkspaceSnapshot>;
  jobsList(): Promise<JobList>;
  openDeveloperTools(): Promise<void>;
}

export const tauriWorkbenchRuntimeService: WorkbenchRuntimeService = {
  snapshot: workspaceSnapshot,
  jobsList,
  openDeveloperTools,
};

export const workbenchRuntimeService = tauriWorkbenchRuntimeService;
