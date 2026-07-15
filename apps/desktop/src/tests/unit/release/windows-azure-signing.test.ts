import { describe, expect, it } from "vitest";
// The release tooling lives outside src/, imported here by relative path since
// the vitest include glob is scoped to src/tests/unit.
import {
  buildAzureSignCommand,
  buildAzureWindowsConfig,
} from "../../../../tools/prepare-windows-azure-signing.mjs";

const base = {
  AZURE_TRUSTED_SIGNING_ENDPOINT: "https://eus.codesigning.azure.net/",
  AZURE_TRUSTED_SIGNING_ACCOUNT: "irodori-signing",
  AZURE_TRUSTED_SIGNING_PROFILE: "irodori-profile",
};

describe("prepare-windows-azure-signing", () => {
  it("builds a trusted-signing-cli sign command with the %1 placeholder", () => {
    const command = buildAzureSignCommand(base);
    expect(command).toBe(
      "trusted-signing-cli -e https://eus.codesigning.azure.net " +
        "-a irodori-signing -c irodori-profile -d Irodori_Table %1",
    );
  });

  it("nests the command under bundle.windows.signCommand for Tauri", () => {
    const config = buildAzureWindowsConfig(base);
    expect(config.bundle.windows.signCommand).toContain("trusted-signing-cli");
    expect(config.bundle.windows.signCommand.endsWith("%1")).toBe(true);
  });

  it("strips a trailing slash from the endpoint", () => {
    expect(buildAzureSignCommand(base)).toContain(
      "-e https://eus.codesigning.azure.net ",
    );
  });

  it("collapses and de-quotes the description into one safe token", () => {
    const command = buildAzureSignCommand({
      ...base,
      WINDOWS_SIGN_DESCRIPTION: 'My "App" \\ v2',
    });
    expect(command).toContain("-d My_App_v2 %1");
  });

  it("rejects shell metacharacters in the account (command injection guard)", () => {
    expect(() =>
      buildAzureSignCommand({
        ...base,
        AZURE_TRUSTED_SIGNING_ACCOUNT: "acct; rm -rf /",
      }),
    ).toThrow(/AZURE_TRUSTED_SIGNING_ACCOUNT/);
  });

  it("rejects a non-https endpoint", () => {
    expect(() =>
      buildAzureSignCommand({
        ...base,
        AZURE_TRUSTED_SIGNING_ENDPOINT: "http://evil.example",
      }),
    ).toThrow(/https/);
  });

  it("requires the profile name", () => {
    const { AZURE_TRUSTED_SIGNING_PROFILE: _omitted, ...withoutProfile } = base;
    void _omitted;
    expect(() => buildAzureSignCommand(withoutProfile)).toThrow(
      /AZURE_TRUSTED_SIGNING_PROFILE is required/,
    );
  });
});
