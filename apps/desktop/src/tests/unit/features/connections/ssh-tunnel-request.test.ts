import { describe, expect, it, vi } from "vitest";
import type { ConnectionProfile, DbEngine } from "@/generated/irodori-api";
import { sshTunnelDefaults } from "@/features/connections/connection-ssh";
import {
  prepareConnectionRequest,
  type SshTunnelIo,
} from "@/features/connections/ssh-tunnel-request";
import type {
  ConnectionDraft,
  ConnectionSshTunnel,
} from "@/lib/workspace-connection";

function tunnel(patch: Partial<ConnectionSshTunnel> = {}): ConnectionSshTunnel {
  return {
    ...sshTunnelDefaults(),
    enabled: true,
    host: "bastion.example.com",
    user: "deploy",
    password: "hunter2",
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
    ssh: tunnel(),
    ...patch,
  };
}

const profile: ConnectionProfile<DbEngine> = {
  id: "prod-pg",
  engine: "postgres",
  host: "10.0.0.5",
  port: 5432,
  user: "irodori",
  database: "app",
};

function io(overrides: Partial<SshTunnelIo> = {}) {
  return {
    storeSecret: vi.fn(async (connectionId: string, purpose: string) => ({
      handle: `${connectionId}/${purpose}`,
    })),
    deleteSecret: vi.fn(async () => {}),
    readPrivateKey: vi.fn(async () => "-----BEGIN OPENSSH PRIVATE KEY-----\n"),
    ...overrides,
  } satisfies SshTunnelIo;
}

describe("prepareConnectionRequest", () => {
  it("leaves a profile without a tunnel exactly as it was", async () => {
    const deps = io();
    const request = await prepareConnectionRequest(
      draft({ ssh: undefined }),
      profile,
      null,
      deps,
    );

    expect(request.profile).toBe(profile);
    expect(deps.storeSecret).not.toHaveBeenCalled();
  });

  it("stores the SSH password and points the transport at its handle", async () => {
    const deps = io();
    const request = await prepareConnectionRequest(
      draft(),
      profile,
      null,
      deps,
    );

    expect(deps.storeSecret).toHaveBeenCalledWith(
      "prod-pg",
      "sshPassword",
      "hunter2",
    );
    expect(request.profile.transport).toEqual({
      kind: "sshTunnel",
      sshHost: "bastion.example.com",
      sshPort: 22,
      username: "deploy",
      auth: { kind: "password", password: { handle: "prod-pg/sshPassword" } },
      targetHost: "10.0.0.5",
      targetPort: 5432,
      strictHostKey: false,
    });
  });

  it("reads the private key file and stores its contents", async () => {
    const deps = io();
    const request = await prepareConnectionRequest(
      draft({
        ssh: tunnel({
          authMethod: "privateKey",
          privateKeyPath: "  ~/.ssh/id_ed25519  ",
          passphrase: "open sesame",
        }),
      }),
      profile,
      null,
      deps,
    );

    expect(deps.readPrivateKey).toHaveBeenCalledWith("~/.ssh/id_ed25519");
    expect(deps.storeSecret).toHaveBeenCalledWith(
      "prod-pg",
      "privateKey",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
    );
    expect(deps.storeSecret).toHaveBeenCalledWith(
      "prod-pg",
      "privateKeyPassphrase",
      "open sesame",
    );
    expect(request.profile.transport).toMatchObject({
      auth: {
        kind: "privateKey",
        privateKey: { handle: "prod-pg/privateKey" },
        passphrase: { handle: "prod-pg/privateKeyPassphrase" },
      },
    });
  });

  it("stores nothing for agent authentication", async () => {
    const deps = io();
    const request = await prepareConnectionRequest(
      draft({ ssh: tunnel({ authMethod: "agent" }) }),
      profile,
      null,
      deps,
    );

    expect(deps.storeSecret).not.toHaveBeenCalled();
    expect(request.profile.transport).toMatchObject({
      auth: { kind: "agent" },
    });
  });

  // The keychain entry exists only for the one connect call that reads it.
  it("drops every stored secret on release", async () => {
    const deps = io();
    const request = await prepareConnectionRequest(
      draft({
        ssh: tunnel({
          authMethod: "privateKey",
          privateKeyPath: "~/.ssh/id_ed25519",
          passphrase: "open sesame",
        }),
      }),
      profile,
      null,
      deps,
    );

    await request.release();

    expect(
      vi.mocked(deps.deleteSecret).mock.calls.map(([ref]) => ref.handle),
    ).toEqual(["prod-pg/privateKey", "prod-pg/privateKeyPassphrase"]);
  });

  it("releases only once, so a second call is a no-op", async () => {
    const deps = io();
    const request = await prepareConnectionRequest(
      draft(),
      profile,
      null,
      deps,
    );

    await request.release();
    await request.release();

    expect(deps.deleteSecret).toHaveBeenCalledTimes(1);
  });

  it("keeps a live connection when the keychain refuses the cleanup", async () => {
    const deps = io({
      deleteSecret: vi.fn(async () => {
        throw new Error("keychain locked");
      }),
    });
    const request = await prepareConnectionRequest(
      draft(),
      profile,
      null,
      deps,
    );

    await expect(request.release()).resolves.toBeUndefined();
  });

  it("cleans up what it stored when a later step fails", async () => {
    const deps = io({
      readPrivateKey: vi.fn(async () => {
        throw new Error("no such file");
      }),
    });

    await expect(
      prepareConnectionRequest(
        draft({
          ssh: tunnel({
            authMethod: "privateKey",
            privateKeyPath: "~/.ssh/missing",
          }),
        }),
        profile,
        null,
        deps,
      ),
    ).rejects.toThrow("no such file");
    expect(deps.storeSecret).not.toHaveBeenCalled();
  });

  it("says which credential is missing instead of failing in the keychain", async () => {
    const deps = io();

    await expect(
      prepareConnectionRequest(
        draft({ ssh: tunnel({ password: "" }) }),
        profile,
        null,
        deps,
      ),
    ).rejects.toThrow("SSH password is required");
    expect(deps.storeSecret).not.toHaveBeenCalled();
  });

  it("rejects an empty key file before it reaches the keychain", async () => {
    const deps = io({ readPrivateKey: vi.fn(async () => "   \n") });

    await expect(
      prepareConnectionRequest(
        draft({
          ssh: tunnel({
            authMethod: "privateKey",
            privateKeyPath: "~/.ssh/id_ed25519",
          }),
        }),
        profile,
        null,
        deps,
      ),
    ).rejects.toThrow("SSH private key file is empty");
    expect(deps.storeSecret).not.toHaveBeenCalled();
  });
});
