#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const updaterConfigPath = resolve(root, "src-tauri/tauri.updater.conf.json");
const defaultEndpoint =
  "https://github.com/hjosugi/irodori-table/releases/latest/download/latest.json";

const publicKey = requiredEnv("TAURI_UPDATER_PUBLIC_KEY");
requiredEnv("TAURI_SIGNING_PRIVATE_KEY");

const endpoint =
  process.env.IRODORI_UPDATER_ENDPOINT?.trim() || defaultEndpoint;
assertHttps(endpoint, "IRODORI_UPDATER_ENDPOINT");

writeFileSync(
  updaterConfigPath,
  `${JSON.stringify(
    {
      bundle: {
        createUpdaterArtifacts: true,
      },
      plugins: {
        updater: {
          pubkey: publicKey,
          endpoints: [endpoint],
          windows: {
            installMode: "passive",
          },
        },
      },
    },
    null,
    2,
  )}\n`,
);

console.log(`Updater signing config generated at ${updaterConfigPath}`);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for signed updater release artifacts.`,
    );
  }
  return value;
}

function assertHttps(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} must be a valid URL: ${message}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS for production updater releases.`);
  }
}
