import type {
  DbEngine,
  SecretRef,
  SshAuthConfig,
  TransportConfig,
} from "@/generated/irodori-api";
import { isRecord } from "@/core";
import type { ConnectorConnectionModel } from "@/features/extensions/connection-model";
import { engineConnectionLayout } from "./engine-connection-settings";
import type {
  ConnectionDraft,
  ConnectionSshAuthMethod,
  ConnectionSshTunnel,
} from "@/lib/workspace-connection";

export const defaultSshPort = "22";

export const sshAuthMethods: readonly ConnectionSshAuthMethod[] = [
  "password",
  "privateKey",
  "agent",
];

/**
 * Engines that open a local file instead of dialling a server. A tunnel in
 * front of them would forward to nothing, so the section stays hidden.
 */
const localFileEngines: ReadonlySet<DbEngine> = new Set(["sqlite", "duckdb"]);

export function sshTunnelDefaults(): ConnectionSshTunnel {
  return {
    enabled: false,
    host: "",
    port: defaultSshPort,
    user: "",
    authMethod: "password",
    password: "",
    privateKeyPath: "",
    passphrase: "",
    strictHostKey: false,
    hostKey: "",
  };
}

/** The profile's tunnel settings, or the untouched defaults when it has none. */
export function sshTunnelSettings(draft: ConnectionDraft): ConnectionSshTunnel {
  return draft.ssh ?? sshTunnelDefaults();
}

/**
 * True when the engine can sit behind a tunnel at all. The forwarder rewrites
 * the profile's host and port, so an engine that shows neither has no endpoint
 * to forward.
 */
export function supportsSshTunnel(
  engine: DbEngine,
  connectionModel: ConnectorConnectionModel | null = null,
) {
  if (localFileEngines.has(engine)) {
    return false;
  }
  if (connectionModel && connectionModel.endpoint.fields.length > 0) {
    const declares = (field: "host" | "port") =>
      connectionModel.endpoint.fields.some(
        (entry) => entry.profileField === field,
      );
    return declares("host") && declares("port");
  }
  const layout = engineConnectionLayout(engine);
  return layout.showHost && layout.showPort;
}

/**
 * A tunnel replaces the profile's host and port with the local forwarder, which
 * leaves nothing to rewrite in a URL/DSN — user, database, and driver options
 * all live inside that one string. So the tunnel is offered for the field form
 * only, and a socket profile never leaves the machine to begin with.
 */
export function sshTunnelAvailable(
  draft: ConnectionDraft,
  connectionModel: ConnectorConnectionModel | null = null,
) {
  return (
    draft.mode === "fields" &&
    draft.connectionTransport !== "socket" &&
    supportsSshTunnel(draft.engine, connectionModel)
  );
}

export function sshTunnelEnabled(
  draft: ConnectionDraft,
  connectionModel: ConnectorConnectionModel | null = null,
) {
  return (
    sshTunnelAvailable(draft, connectionModel) && draft.ssh?.enabled === true
  );
}

/** Blanks the two session-only credentials before a profile is persisted. */
export function sanitizedSshTunnel(
  ssh: ConnectionSshTunnel | undefined,
): ConnectionSshTunnel | undefined {
  if (!ssh) {
    return undefined;
  }
  return { ...ssh, password: "", passphrase: "" };
}

function jsonText(value: unknown, fallback: string) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function jsonAuthMethod(value: unknown): ConnectionSshAuthMethod {
  return sshAuthMethods.find((method) => method === value) ?? "password";
}

/** Imported files are untrusted shapes, so every field is coerced. */
export function sshTunnelFromJson(
  value: unknown,
): ConnectionSshTunnel | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const defaults = sshTunnelDefaults();
  return {
    enabled: value.enabled === true,
    host: jsonText(value.host, defaults.host),
    port: jsonText(value.port, defaults.port).trim() || defaults.port,
    user: jsonText(value.user, defaults.user),
    authMethod: jsonAuthMethod(value.authMethod),
    password: "",
    privateKeyPath: jsonText(value.privateKeyPath, defaults.privateKeyPath),
    passphrase: "",
    strictHostKey: value.strictHostKey === true,
    hostKey: jsonText(value.hostKey, defaults.hostKey),
  };
}

/**
 * Returns an English message shown verbatim, matching validateDraft. The two
 * secrets are deliberately not required: they are session-only, so a saved
 * profile has to stay valid with them empty.
 */
export function validateSshTunnelDraft(
  draft: ConnectionDraft,
  connectionModel: ConnectorConnectionModel | null = null,
): string | null {
  if (!sshTunnelEnabled(draft, connectionModel)) {
    return null;
  }
  const ssh = sshTunnelSettings(draft);
  if (!ssh.host.trim()) {
    return "SSH host is required";
  }
  const port = ssh.port.trim();
  if (!port) {
    return "SSH port is required";
  }
  if (
    !Number.isInteger(Number(port)) ||
    Number(port) < 1 ||
    Number(port) > 65535
  ) {
    return "SSH port must be a number between 1 and 65535";
  }
  if (!ssh.user.trim()) {
    return "SSH user is required";
  }
  if (ssh.authMethod === "privateKey" && !ssh.privateKeyPath.trim()) {
    return "SSH private key file is required";
  }
  if (ssh.strictHostKey && !ssh.hostKey.trim()) {
    return "SSH host key is required when host key verification is on";
  }
  return null;
}

export type SshTunnelSecrets = {
  password?: SecretRef;
  privateKey?: SecretRef;
  passphrase?: SecretRef;
};

export function sshAuthConfig(
  ssh: ConnectionSshTunnel,
  secrets: SshTunnelSecrets,
): SshAuthConfig {
  if (ssh.authMethod === "agent") {
    return { kind: "agent" };
  }
  if (ssh.authMethod === "privateKey") {
    if (!secrets.privateKey) {
      throw new Error("SSH private key was not stored");
    }
    return {
      kind: "privateKey",
      privateKey: secrets.privateKey,
      ...(secrets.passphrase ? { passphrase: secrets.passphrase } : {}),
    };
  }
  if (!secrets.password) {
    throw new Error("SSH password was not stored");
  }
  return { kind: "password", password: secrets.password };
}

/**
 * Builds the transport from the *resolved* endpoint rather than the raw draft,
 * so connector-declared fields and built-in fields agree. `targetHost` is the
 * database as the SSH server sees it, which is why the form says so.
 */
export function sshTunnelTransport(
  ssh: ConnectionSshTunnel,
  target: { host?: string; port?: number },
  auth: SshAuthConfig,
): TransportConfig {
  const targetHost = target.host?.trim() ?? "";
  if (!targetHost) {
    throw new Error("database host is required for an SSH tunnel");
  }
  if (target.port === undefined || !Number.isInteger(target.port)) {
    throw new Error("database port is required for an SSH tunnel");
  }
  return {
    kind: "sshTunnel",
    sshHost: ssh.host.trim(),
    sshPort: Number(ssh.port.trim()),
    username: ssh.user.trim(),
    auth,
    targetHost,
    targetPort: target.port,
    strictHostKey: ssh.strictHostKey,
    ...(ssh.strictHostKey && ssh.hostKey.trim()
      ? { hostKey: ssh.hostKey.trim() }
      : {}),
  };
}
