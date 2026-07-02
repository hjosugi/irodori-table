#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const signingDir = resolve(root, "../../.irodori-local/macos-signing");
const certificatePath = resolve(signingDir, "certificate.p12");
const keychainPath = resolve(signingDir, "irodori-table-release.keychain-db");
const privateKeyDir = resolve(signingDir, "private_keys");

const certificate = requiredEnv("APPLE_CERTIFICATE");
const certificatePassword = requiredEnv("APPLE_CERTIFICATE_PASSWORD");
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim();
const apiIssuer = process.env.APPLE_API_ISSUER?.trim();
const apiKey = process.env.APPLE_API_KEY?.trim();
const apiKeyP8 = process.env.APPLE_API_KEY_P8?.trim();
const appleId = process.env.APPLE_ID?.trim();
const applePassword = process.env.APPLE_PASSWORD?.trim();
const appleTeamId = process.env.APPLE_TEAM_ID?.trim();

if (process.platform !== "darwin") {
  throw new Error("macOS code-signing preparation must run on a macOS runner.");
}

if (
  !(apiIssuer && apiKey && apiKeyP8) &&
  !(appleId && applePassword && appleTeamId)
) {
  throw new Error(
    "macOS notarization requires either APPLE_API_ISSUER + APPLE_API_KEY + APPLE_API_KEY_P8 or APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID.",
  );
}

mkdirSync(signingDir, { recursive: true });
writeFileSync(
  certificatePath,
  decodeBase64Payload(certificate, "APPLE_CERTIFICATE"),
);

try {
  const keychainPassword = randomUUID();
  createAndUnlockKeychain(keychainPassword);
  importCertificate(keychainPassword);
  const identity = signingIdentity || discoverSigningIdentity();
  writeGitHubEnv("APPLE_SIGNING_IDENTITY", identity);

  if (apiIssuer && apiKey && apiKeyP8) {
    const keyPath = writeAppStoreConnectPrivateKey(apiKey, apiKeyP8);
    writeGitHubEnv("APPLE_API_KEY_PATH", keyPath);
  }

  console.log(`macOS signing identity prepared: ${identity}`);
} finally {
  rmSync(certificatePath, { force: true });
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for signed macOS release artifacts.`);
  }
  return value;
}

function createAndUnlockKeychain(password) {
  run("security", ["delete-keychain", keychainPath], { allowFailure: true });
  run("security", ["create-keychain", "-p", password, keychainPath]);
  run("security", ["set-keychain-settings", "-lut", "21600", keychainPath]);
  run("security", ["unlock-keychain", "-p", password, keychainPath]);

  const currentKeychains = run("security", ["list-keychains", "-d", "user"], {
    capture: true,
  })
    .split("\n")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  const nextKeychains = [
    keychainPath,
    ...currentKeychains.filter((path) => path !== keychainPath),
  ];
  run("security", ["list-keychains", "-d", "user", "-s", ...nextKeychains]);
}

function importCertificate(keychainPassword) {
  run("security", [
    "import",
    certificatePath,
    "-k",
    keychainPath,
    "-P",
    certificatePassword,
    "-T",
    "/usr/bin/codesign",
    "-T",
    "/usr/bin/productsign",
  ]);
  run("security", [
    "set-key-partition-list",
    "-S",
    "apple-tool:,apple:,codesign:",
    "-s",
    "-k",
    keychainPassword,
    keychainPath,
  ]);
}

function discoverSigningIdentity() {
  const output = run(
    "security",
    ["find-identity", "-v", "-p", "codesigning", keychainPath],
    {
      capture: true,
    },
  );
  const identities = output
    .split("\n")
    .map((line) => line.match(/"([^"]+)"/)?.[1])
    .filter(Boolean);
  const developerIdIdentity = identities.find((identity) =>
    identity.startsWith("Developer ID Application:"),
  );
  const identity = developerIdIdentity ?? identities[0];
  if (!identity) {
    throw new Error(
      "No macOS code-signing identity was found after importing APPLE_CERTIFICATE.",
    );
  }
  return identity;
}

function writeAppStoreConnectPrivateKey(keyId, value) {
  mkdirSync(privateKeyDir, { recursive: true });
  const keyPath = resolve(privateKeyDir, `AuthKey_${keyId}.p8`);
  writeFileSync(keyPath, normalizePrivateKey(value));
  return keyPath;
}

function writeGitHubEnv(name, value) {
  const githubEnv = process.env.GITHUB_ENV;
  if (!githubEnv) {
    process.env[name] = value;
    return;
  }
  writeFileSync(githubEnv, `${name}=${value}\n`, { flag: "a" });
}

function normalizePrivateKey(value) {
  if (value.includes("BEGIN PRIVATE KEY")) {
    return `${value.replace(/\r\n/g, "\n").trim()}\n`;
  }
  const decoded = decodeBase64Payload(value, "APPLE_API_KEY_P8")
    .toString("utf8")
    .trim();
  if (!decoded.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "APPLE_API_KEY_P8 must be a raw .p8 key or a base64-encoded .p8 key.",
    );
  }
  return `${decoded}\n`;
}

function decodeBase64Payload(value, name) {
  const body = value
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const buffer = Buffer.from(body, "base64");
  if (buffer.length === 0) {
    throw new Error(`${name} did not decode to a payload.`);
  }
  return buffer;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0 && !options.allowFailure) {
    const details = options.capture
      ? `\n${result.stderr || result.stdout}`
      : "";
    throw new Error(`${command} ${args.join(" ")} failed.${details}`);
  }
  return options.capture ? result.stdout : "";
}
