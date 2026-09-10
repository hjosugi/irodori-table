import type { DbEngine, WorkspaceSnapshot } from "@/generated/irodori-api";

export type WorkspaceConnection = WorkspaceSnapshot["connections"][number];
export type ConnectionInputMode = "url" | "fields";
export type ConnectionTransportMode = "tcp" | "socket";
export type ConnectionSshAuthMethod = "password" | "privateKey" | "agent";

/**
 * SSH tunnel settings for one profile. The host and port on the profile itself
 * stay the database endpoint *as the SSH server sees it*, which is what the
 * forwarder dials once the session is up.
 *
 * `password` and `passphrase` are session-only, exactly like the database
 * password: sanitizedProfile blanks them before anything reaches localStorage
 * or an export file. `privateKeyPath` is a path, not a secret, so it persists.
 */
export type ConnectionSshTunnel = {
  enabled: boolean;
  host: string;
  port: string;
  user: string;
  authMethod: ConnectionSshAuthMethod;
  password: string;
  privateKeyPath: string;
  passphrase: string;
  /** Requires `hostKey`; the forwarder refuses the session without one. */
  strictHostKey: boolean;
  hostKey: string;
};

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
   * Built-in keys are declared in builtin-engine-connection-config.json;
   * extension keys come from the installed connectionModel.
   *
   * Optional on purpose: profiles saved before this existed have no `options`,
   * and adding it to newDraft() would break isPristineDraftProfile, which
   * compares every key of a fresh draft with `===`.
   *
   * Never put secrets here — they would be persisted to localStorage in the
   * clear. Credentials belong in `password`, which is session-only.
   */
  options?: Record<string, string>;
  /**
   * Extension-declared credentials that do not fit the single legacy
   * `password` slot (API tokens, private keys, OAuth secrets…). These values
   * exist only in the live form draft and are merged into the invoke payload
   * for one connection attempt. Persistence and export helpers must always
   * remove the whole map.
   */
  secretOptions?: Record<string, string>;
  /**
   * Raw JSON for the extension model's `profileField: "options"` editor.
   * Custom driver options can contain credentials, so the whole value is
   * conservatively session-only and parsed only while building one request.
   */
  customOptionsJson?: string;
  /**
   * SSH tunnel settings, absent on profiles saved before the feature existed
   * and on every profile that has never opened the section. Optional for the
   * same reason `options` is: newDraft() must keep comparing equal by `===`
   * for isPristineDraftProfile.
   */
  ssh?: ConnectionSshTunnel;
};
