// Type declarations for the Azure Trusted Signing prep script so strict TS
// consumers (e.g. the unit test under src/) can import it without TS7016.
export type AzureSigningEnv = Record<string, string | undefined>;

export type AzureWindowsConfig = {
  bundle: { windows: { signCommand: string } };
};

export function buildAzureSignCommand(env?: AzureSigningEnv): string;

export function buildAzureWindowsConfig(env?: AzureSigningEnv): AzureWindowsConfig;

export function writeAzureWindowsConfig(
  path: string,
  env?: AzureSigningEnv,
): AzureWindowsConfig;
