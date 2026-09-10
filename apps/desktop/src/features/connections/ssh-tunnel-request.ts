import {
  securityDeleteSecret,
  securityStoreSecret,
  type ConnectionProfile,
  type DbEngine,
  type DesktopSecretPurpose,
  type SecretRef,
} from "@/generated/irodori-api";
import type { ConnectorConnectionModel } from "@/features/extensions/connection-model";
import type { ConnectionDraft } from "@/lib/workspace-connection";
import {
  sshAuthConfig,
  sshTunnelEnabled,
  sshTunnelSettings,
  sshTunnelTransport,
  type SshTunnelSecrets,
} from "./connection-ssh";

/**
 * The three side effects an SSH tunnel needs, injected so the request can be
 * unit tested without a Tauri host.
 */
export type SshTunnelIo = {
  storeSecret: (
    connectionId: string,
    purpose: DesktopSecretPurpose,
    value: string,
  ) => Promise<SecretRef>;
  deleteSecret: (secret: SecretRef) => Promise<void>;
  readPrivateKey: (path: string) => Promise<string>;
};

export const defaultSshTunnelIo: SshTunnelIo = {
  storeSecret: securityStoreSecret,
  deleteSecret: securityDeleteSecret,
  readPrivateKey: async (path) => {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    return readTextFile(path);
  },
};

export type PreparedConnectionRequest = {
  profile: ConnectionProfile<DbEngine>;
  /**
   * Drops every secret this request put in the OS keychain. Safe to call more
   * than once, and safe to call as soon as the connect attempt has resolved:
   * the backend reads each secret once, before it starts the forwarder.
   */
  release: () => Promise<void>;
};

function passthrough(
  profile: ConnectionProfile<DbEngine>,
): PreparedConnectionRequest {
  return { profile, release: async () => {} };
}

/**
 * Turns a draft with SSH settings into a profile the backend can dial.
 *
 * Secrets cannot travel inside the profile — `SshAuthConfig` carries keychain
 * handles — so they are written to the OS keychain here and deleted again by
 * `release()`. That keeps the app's promise that credentials typed into the
 * form live for one session only: nothing survives the connect attempt.
 */
export async function prepareConnectionRequest(
  draft: ConnectionDraft,
  profile: ConnectionProfile<DbEngine>,
  connectionModel: ConnectorConnectionModel | null = null,
  io: SshTunnelIo = defaultSshTunnelIo,
): Promise<PreparedConnectionRequest> {
  if (!sshTunnelEnabled(draft, connectionModel)) {
    return passthrough(profile);
  }
  const ssh = sshTunnelSettings(draft);
  const owner = draft.id.trim();
  const stored: SecretRef[] = [];
  const release = async () => {
    const pending = stored.splice(0, stored.length);
    await Promise.all(
      // Best effort: a keychain that refuses the delete must not turn a live
      // connection into a failed one.
      pending.map((secret) => io.deleteSecret(secret).catch(() => {})),
    );
  };
  const keep = async (purpose: DesktopSecretPurpose, value: string) => {
    const secret = await io.storeSecret(owner, purpose, value);
    stored.push(secret);
    return secret;
  };

  try {
    const secrets: SshTunnelSecrets = {};
    if (ssh.authMethod === "password") {
      // Session-only, so validateDraft cannot require it at save time; a saved
      // profile reopened after a restart lands here with an empty field.
      if (!ssh.password) {
        throw new Error("SSH password is required for this connection");
      }
      secrets.password = await keep("sshPassword", ssh.password);
    }
    if (ssh.authMethod === "privateKey") {
      const key = (await io.readPrivateKey(ssh.privateKeyPath.trim())).trim();
      if (!key) {
        throw new Error("SSH private key file is empty");
      }
      secrets.privateKey = await keep("privateKey", key);
      if (ssh.passphrase) {
        secrets.passphrase = await keep("privateKeyPassphrase", ssh.passphrase);
      }
    }
    const transport = sshTunnelTransport(
      ssh,
      { host: profile.host, port: profile.port },
      sshAuthConfig(ssh, secrets),
    );
    return { profile: { ...profile, transport }, release };
  } catch (error) {
    await release();
    throw error;
  }
}
