import { describe, expect, it } from "vitest";
import {
  sanitizedProfile,
  settingsProfileFromJson,
  validateDraft,
  type ConnectionDraft,
  type ConnectionSshTunnel,
} from "@/features/connections/connection-profiles";
import {
  sshAuthConfig,
  sshTunnelAvailable,
  sshTunnelDefaults,
  sshTunnelEnabled,
  sshTunnelFromJson,
  sshTunnelTransport,
  supportsSshTunnel,
  validateSshTunnelDraft,
} from "@/features/connections/connection-ssh";

function tunnel(patch: Partial<ConnectionSshTunnel> = {}): ConnectionSshTunnel {
  return {
    ...sshTunnelDefaults(),
    enabled: true,
    host: "bastion.example.com",
    user: "deploy",
    ...patch,
  };
}

function draft(patch: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "prod-pg",
    name: "Prod Postgres",
    color: "#2563eb",
    engine: "postgres",
    mode: "fields",
    url: "",
    connectionTransport: "tcp",
    host: "10.0.0.5",
    port: "5432",
    user: "irodori",
    password: "",
    database: "app",
    socketPath: "",
    readOnly: false,
    ...patch,
  };
}

describe("SSH tunnel availability", () => {
  it("offers a tunnel for engines that dial a host and a port", () => {
    expect(supportsSshTunnel("postgres")).toBe(true);
    expect(supportsSshTunnel("mysql")).toBe(true);
  });

  it("hides it for engines that open a local file", () => {
    expect(supportsSshTunnel("sqlite")).toBe(false);
    expect(supportsSshTunnel("duckdb")).toBe(false);
  });

  it("hides it for engines with no port to forward", () => {
    expect(supportsSshTunnel("bigquery")).toBe(false);
  });

  // A tunnel rewrites host and port, and a DSN carries user, database, and
  // driver options in the same string, so there is nothing safe to rewrite.
  it("is offered for the field form only", () => {
    expect(sshTunnelAvailable(draft())).toBe(true);
    expect(sshTunnelAvailable(draft({ mode: "url" }))).toBe(false);
  });

  it("is not offered for a Unix socket profile", () => {
    expect(sshTunnelAvailable(draft({ connectionTransport: "socket" }))).toBe(
      false,
    );
  });

  it("stays off while the profile is unavailable, even when enabled", () => {
    const enabled = { ssh: tunnel() };
    expect(sshTunnelEnabled(draft(enabled))).toBe(true);
    expect(sshTunnelEnabled(draft({ ...enabled, mode: "url" }))).toBe(false);
  });
});

describe("SSH tunnel validation", () => {
  it("accepts a filled-in password tunnel", () => {
    expect(validateSshTunnelDraft(draft({ ssh: tunnel() }))).toBeNull();
  });

  it("requires the host, the port, and the user", () => {
    expect(validateSshTunnelDraft(draft({ ssh: tunnel({ host: " " }) }))).toBe(
      "SSH host is required",
    );
    expect(validateSshTunnelDraft(draft({ ssh: tunnel({ port: "" }) }))).toBe(
      "SSH port is required",
    );
    expect(validateSshTunnelDraft(draft({ ssh: tunnel({ user: "" }) }))).toBe(
      "SSH user is required",
    );
  });

  it("rejects a port outside the TCP range", () => {
    expect(
      validateSshTunnelDraft(draft({ ssh: tunnel({ port: "70000" }) })),
    ).toBe("SSH port must be a number between 1 and 65535");
  });

  it("requires a key file for key authentication", () => {
    expect(
      validateSshTunnelDraft(
        draft({ ssh: tunnel({ authMethod: "privateKey" }) }),
      ),
    ).toBe("SSH private key file is required");
  });

  // The forwarder refuses the session when strictHostKey has no key to compare
  // against, so the form has to catch it first.
  it("requires a host key when verification is on", () => {
    expect(
      validateSshTunnelDraft(draft({ ssh: tunnel({ strictHostKey: true }) })),
    ).toBe("SSH host key is required when host key verification is on");
  });

  // Both are session-only, so a saved profile reopened tomorrow has them empty
  // and must still be a valid profile.
  it("does not require the session-only secrets", () => {
    expect(
      validateSshTunnelDraft(
        draft({
          ssh: tunnel({
            authMethod: "privateKey",
            privateKeyPath: "~/.ssh/id_ed25519",
          }),
        }),
      ),
    ).toBeNull();
  });

  it("is reported through validateDraft", () => {
    expect(validateDraft(draft({ ssh: tunnel({ host: "" }) }))).toBe(
      "SSH host is required",
    );
  });
});

describe("SSH tunnel persistence", () => {
  it("never persists the password or the passphrase", () => {
    const saved = sanitizedProfile(
      draft({
        ssh: tunnel({
          authMethod: "privateKey",
          privateKeyPath: "~/.ssh/id_ed25519",
          password: "hunter2",
          passphrase: "open sesame",
        }),
      }),
    );

    expect(saved.ssh?.password).toBe("");
    expect(saved.ssh?.passphrase).toBe("");
    // The path is not a secret, so it survives and the key is read again.
    expect(saved.ssh?.privateKeyPath).toBe("~/.ssh/id_ed25519");
  });

  it("leaves a profile without a tunnel untouched", () => {
    expect(sanitizedProfile(draft()).ssh).toBeUndefined();
  });

  it("coerces every field of an imported tunnel", () => {
    expect(
      sshTunnelFromJson({
        enabled: "yes",
        host: "bastion",
        port: 2222,
        user: "deploy",
        authMethod: "nonsense",
        password: "leaked",
        passphrase: "leaked",
        strictHostKey: 1,
      }),
    ).toEqual({
      ...sshTunnelDefaults(),
      enabled: false,
      host: "bastion",
      port: "2222",
      user: "deploy",
      authMethod: "password",
      strictHostKey: false,
    });
  });

  it("reads the tunnel back from an exported profile", () => {
    const exported = JSON.parse(
      JSON.stringify(
        sanitizedProfile(draft({ ssh: tunnel({ port: "2222" }) })),
      ),
    );

    expect(settingsProfileFromJson(exported, 0).ssh).toMatchObject({
      enabled: true,
      host: "bastion.example.com",
      port: "2222",
      user: "deploy",
    });
  });
});

describe("SSH tunnel transport", () => {
  const secret = { handle: "prod-pg/sshPassword" };

  it("forwards to the database as the SSH server sees it", () => {
    expect(
      sshTunnelTransport(
        tunnel({ port: "2222" }),
        { host: "10.0.0.5", port: 5432 },
        sshAuthConfig(tunnel(), { password: secret }),
      ),
    ).toEqual({
      kind: "sshTunnel",
      sshHost: "bastion.example.com",
      sshPort: 2222,
      username: "deploy",
      auth: { kind: "password", password: secret },
      targetHost: "10.0.0.5",
      targetPort: 5432,
      strictHostKey: false,
    });
  });

  it("sends the host key only when verification is on", () => {
    const withKey = tunnel({ strictHostKey: true, hostKey: "abc123" });
    expect(
      sshTunnelTransport(
        withKey,
        { host: "10.0.0.5", port: 5432 },
        { kind: "agent" },
      ),
    ).toMatchObject({ strictHostKey: true, hostKey: "abc123" });
    expect(
      sshTunnelTransport(
        tunnel({ hostKey: "abc123" }),
        { host: "10.0.0.5", port: 5432 },
        { kind: "agent" },
      ),
    ).not.toHaveProperty("hostKey");
  });

  it("refuses to build a tunnel with no target", () => {
    expect(() =>
      sshTunnelTransport(tunnel(), { host: "", port: 5432 }, { kind: "agent" }),
    ).toThrow(/database host/);
    expect(() =>
      sshTunnelTransport(
        tunnel(),
        { host: "10.0.0.5", port: undefined },
        { kind: "agent" },
      ),
    ).toThrow(/database port/);
  });

  it("omits the passphrase when the key has none", () => {
    const key = { handle: "prod-pg/privateKey" };
    expect(
      sshAuthConfig(tunnel({ authMethod: "privateKey" }), { privateKey: key }),
    ).toEqual({ kind: "privateKey", privateKey: key });
  });

  it("asks the agent for the key when the agent is selected", () => {
    expect(sshAuthConfig(tunnel({ authMethod: "agent" }), {})).toEqual({
      kind: "agent",
    });
  });
});
