#!/usr/bin/env node
// Configure Windows code signing through Azure Trusted Signing (formerly Azure
// Code Signing). Unlike the PFX path in prepare-windows-signing.mjs, no
// certificate file is imported: signing is delegated to the Azure Trusted
// Signing service through `trusted-signing-cli`, which Tauri invokes per
// artifact via the generated `bundle.windows.signCommand`.
//
// Authentication is read by trusted-signing-cli from the environment
// (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET); this module only
// writes the non-secret endpoint/account/profile into the sign command, so no
// credential is ever persisted to disk.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Build the Tauri `bundle.windows.signCommand`. Every interpolated value is
// validated to a shell-safe charset, so the command needs no extra quoting and
// nothing in the environment can break out of it. `%1` is the placeholder Tauri
// replaces with the path of each artifact it bundles.
export function buildAzureSignCommand(env = process.env) {
  const endpoint = validateEndpoint(
    requiredEnv(env, "AZURE_TRUSTED_SIGNING_ENDPOINT"),
  );
  const account = safeName(
    requiredEnv(env, "AZURE_TRUSTED_SIGNING_ACCOUNT"),
    "AZURE_TRUSTED_SIGNING_ACCOUNT",
  );
  const certificateProfile = safeName(
    requiredEnv(env, "AZURE_TRUSTED_SIGNING_PROFILE"),
    "AZURE_TRUSTED_SIGNING_PROFILE",
  );
  const description = safeDescription(env.WINDOWS_SIGN_DESCRIPTION);
  return (
    `trusted-signing-cli -e ${endpoint} -a ${account} ` +
    `-c ${certificateProfile} -d ${description} %1`
  );
}

export function buildAzureWindowsConfig(env = process.env) {
  return { bundle: { windows: { signCommand: buildAzureSignCommand(env) } } };
}

export function writeAzureWindowsConfig(path, env = process.env) {
  const config = buildAzureWindowsConfig(env);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

function requiredEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for Azure Trusted Signing of Windows artifacts.`,
    );
  }
  return value;
}

// Azure resource names and Trusted Signing profile names are alphanumeric with
// hyphens; reject anything else so nothing can break out of the sign command.
function safeName(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(value)) {
    throw new Error(
      `${name} must be 1-63 chars of letters, digits, or hyphens; got '${value}'.`,
    );
  }
  return value;
}

function validateEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `AZURE_TRUSTED_SIGNING_ENDPOINT must be a valid https URL; got '${value}'.`,
    );
  }
  if (url.protocol !== "https:") {
    throw new Error(
      `AZURE_TRUSTED_SIGNING_ENDPOINT must use https; got '${value}'.`,
    );
  }
  // Strip any trailing slash so the command reads cleanly.
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

// Keep the description a single, shell-safe token: drop quotes/backslashes and
// collapse whitespace so it never needs escaping inside signCommand.
function safeDescription(value) {
  const cleaned = (value?.trim() || "Irodori Table")
    .replace(/["'\\]/g, "")
    .replace(/\s+/g, "_");
  return cleaned.length > 0 ? cleaned : "Irodori_Table";
}

// CLI entry: only runs when executed directly, so the module stays importable
// from tests without side effects.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const windowsConfigPath = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "../src-tauri/tauri.windows.conf.json",
  );
  const config = writeAzureWindowsConfig(windowsConfigPath);
  const signCommand = config.bundle.windows.signCommand;
  const account = signCommand.split(" -a ")[1]?.split(" ")[0] ?? "";
  const profile = signCommand.split(" -c ")[1]?.split(" ")[0] ?? "";
  console.log(
    `Azure Trusted Signing configured (account '${account}', profile '${profile}').`,
  );
}
