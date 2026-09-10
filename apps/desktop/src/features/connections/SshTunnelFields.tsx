import { useState } from "react";
import { FolderOpen, Waypoints } from "lucide-react";
import type { Translator } from "@/i18n";
import type {
  ConnectionDraft,
  ConnectionSshAuthMethod,
  ConnectionSshTunnel,
} from "@/lib/workspace-connection";
import {
  sshAuthMethods,
  sshTunnelDefaults,
  sshTunnelSettings,
} from "./connection-ssh";

const authMethodLabelKeys = {
  password: "connection.ssh.auth.password",
  privateKey: "connection.ssh.auth.privateKey",
  agent: "connection.ssh.auth.agent",
} as const;

/**
 * Opens the OS file picker for the private key. Picking a file is also what
 * grants the read: tauri-plugin-dialog adds the chosen path to the filesystem
 * runtime scope, and the capability grants `fs:read-text-file` with no static
 * scope of its own. So the app can read the key the user selected and nothing
 * else.
 */
async function pickPrivateKeyFile(title: string) {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple: false, directory: false, title });
  return typeof selected === "string" ? selected : null;
}

export function SshTunnelFields({
  draft,
  t,
  onUpdateDraft,
}: {
  draft: ConnectionDraft;
  t: Translator["t"];
  onUpdateDraft: (patch: Partial<ConnectionDraft>) => void;
}) {
  const [picking, setPicking] = useState(false);
  const ssh = sshTunnelSettings(draft);
  const update = (patch: Partial<ConnectionSshTunnel>) =>
    onUpdateDraft({ ssh: { ...ssh, ...patch } });

  async function browseForKey() {
    setPicking(true);
    try {
      const selected = await pickPrivateKeyFile(
        t("connection.ssh.browseTitle"),
      );
      if (selected) {
        update({ privateKeyPath: selected });
      }
    } catch {
      // No Tauri dialog (browser preview, or the user cancelled out of a
      // failing picker). The path field stays typable, so this is not an error
      // worth interrupting the form for.
    } finally {
      setPicking(false);
    }
  }

  return (
    <fieldset className="connection-form-section connection-ssh full-row">
      <legend>
        <Waypoints size={13} aria-hidden="true" /> {t("connection.ssh.section")}
      </legend>
      <label className="connection-form-checkbox">
        <input
          type="checkbox"
          checked={ssh.enabled}
          onChange={(event) =>
            onUpdateDraft({
              ssh: {
                ...sshTunnelDefaults(),
                ...ssh,
                enabled: event.currentTarget.checked,
              },
            })
          }
        />
        <span>{t("connection.ssh.enable")}</span>
      </label>
      {ssh.enabled ? (
        <>
          <div className="connection-form-grid">
            <label>
              <span>{t("connection.ssh.host")}</span>
              <input
                value={ssh.host}
                placeholder={t("connection.ssh.hostPlaceholder")}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) =>
                  update({ host: event.currentTarget.value })
                }
              />
            </label>
            <label>
              <span>{t("connection.ssh.port")}</span>
              <input
                inputMode="numeric"
                value={ssh.port}
                onChange={(event) =>
                  update({ port: event.currentTarget.value })
                }
              />
            </label>
            <label>
              <span>{t("connection.ssh.user")}</span>
              <input
                value={ssh.user}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) =>
                  update({ user: event.currentTarget.value })
                }
              />
            </label>
            <label>
              <span>{t("connection.ssh.authMethod")}</span>
              <select
                value={ssh.authMethod}
                onChange={(event) =>
                  update({
                    authMethod: event.currentTarget
                      .value as ConnectionSshAuthMethod,
                  })
                }
              >
                {sshAuthMethods.map((method) => (
                  <option key={method} value={method}>
                    {t(authMethodLabelKeys[method])}
                  </option>
                ))}
              </select>
            </label>
            {ssh.authMethod === "password" ? (
              <label>
                <span>{t("connection.ssh.password")}</span>
                <input
                  type="password"
                  value={ssh.password}
                  autoComplete="new-password"
                  onChange={(event) =>
                    update({ password: event.currentTarget.value })
                  }
                />
              </label>
            ) : null}
            {ssh.authMethod === "privateKey" ? (
              <>
                <label className="connection-ssh-key full-row">
                  <span>{t("connection.ssh.privateKeyFile")}</span>
                  <div className="connection-ssh-key-input">
                    <input
                      value={ssh.privateKeyPath}
                      placeholder={t("connection.ssh.privateKeyPlaceholder")}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(event) =>
                        update({ privateKeyPath: event.currentTarget.value })
                      }
                    />
                    <button
                      className="text-button"
                      type="button"
                      disabled={picking}
                      onClick={() => void browseForKey()}
                    >
                      <FolderOpen size={13} aria-hidden="true" />
                      {t("connection.ssh.browse")}
                    </button>
                  </div>
                </label>
                <label>
                  <span>{t("connection.ssh.passphrase")}</span>
                  <input
                    type="password"
                    value={ssh.passphrase}
                    autoComplete="new-password"
                    onChange={(event) =>
                      update({ passphrase: event.currentTarget.value })
                    }
                  />
                </label>
              </>
            ) : null}
          </div>
          <label className="connection-form-checkbox">
            <input
              type="checkbox"
              checked={ssh.strictHostKey}
              onChange={(event) =>
                update({ strictHostKey: event.currentTarget.checked })
              }
            />
            <span>{t("connection.ssh.strictHostKey")}</span>
          </label>
          {ssh.strictHostKey ? (
            <label className="full-row">
              <span>{t("connection.ssh.hostKey")}</span>
              <input
                value={ssh.hostKey}
                placeholder={t("connection.ssh.hostKeyPlaceholder")}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) =>
                  update({ hostKey: event.currentTarget.value })
                }
              />
            </label>
          ) : null}
          <p className="connection-ssh-hint">
            {t("connection.ssh.targetHint")}
          </p>
          <p className="connection-ssh-hint">
            {t("connection.ssh.localPortHint")}
          </p>
          <p className="connection-ssh-hint">
            {ssh.authMethod === "agent"
              ? t("connection.ssh.agentHint")
              : t("connection.ssh.secretHint")}
          </p>
        </>
      ) : null}
    </fieldset>
  );
}
