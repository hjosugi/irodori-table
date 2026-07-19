import type { DbEngine, WorkspaceSnapshot } from "@/generated/irodori-api";

export type WorkspaceConnection = WorkspaceSnapshot["connections"][number];
export type ConnectionInputMode = "url" | "fields";
export type ConnectionTransportMode = "tcp" | "socket";

export type ConnectionDraft = {
  id: string;
  name: string;
  color: string;
  engine: DbEngine;
  mode: ConnectionInputMode;
  url: string;
  connectionTransport: ConnectionTransportMode;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  socketPath: string;
  readOnly: boolean;
  /**
   * Free-form connector settings forwarded verbatim as `ConnectionProfile.options`
   * (catalog URI, warehouse, region…). Which keys an engine takes is declared in
   * engine-connection-config.json; see engineOptionFields.
   *
   * Optional on purpose: profiles saved before this existed have no `options`,
   * and adding it to newDraft() would break isPristineDraftProfile, which
   * compares every key of a fresh draft with `===`.
   *
   * Never put secrets here — they would be persisted to localStorage in the
   * clear. Credentials belong in `password`, which is session-only.
   */
  options?: Record<string, string>;
};
