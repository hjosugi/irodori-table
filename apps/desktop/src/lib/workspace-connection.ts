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
};
