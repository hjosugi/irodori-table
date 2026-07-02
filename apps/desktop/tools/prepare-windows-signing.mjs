#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const certificatePath = resolve(
  root,
  "../../.irodori-local/windows-signing/certificate.pfx",
);
const windowsConfigPath = resolve(root, "src-tauri/tauri.windows.conf.json");

const certificate = requiredEnv("WINDOWS_CERTIFICATE");
const certificatePassword = requiredEnv("WINDOWS_CERTIFICATE_PASSWORD");
const certificateThumbprint = normalizeThumbprint(
  requiredEnv("WINDOWS_CERTIFICATE_THUMBPRINT"),
);
const digestAlgorithm =
  process.env.WINDOWS_DIGEST_ALGORITHM?.trim() || "sha256";
const timestampUrl =
  process.env.WINDOWS_TIMESTAMP_URL?.trim() || "http://timestamp.digicert.com";

if (process.platform !== "win32") {
  throw new Error(
    "Windows code-signing preparation must run on a Windows runner.",
  );
}

mkdirSync(dirname(certificatePath), { recursive: true });
writeFileSync(certificatePath, decodeCertificate(certificate));
try {
  importCertificate(certificatePath, certificatePassword);
  writeTauriWindowsConfig();
  console.log(
    "Windows code-signing certificate imported and Tauri signing config generated.",
  );
} finally {
  rmSync(certificatePath, { force: true });
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for signed Windows release artifacts.`,
    );
  }
  return value;
}

function normalizeThumbprint(value) {
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-F0-9]{40}$/.test(normalized)) {
    throw new Error(
      "WINDOWS_CERTIFICATE_THUMBPRINT must be a 40-character SHA-1 thumbprint.",
    );
  }
  return normalized;
}

function decodeCertificate(value) {
  const body = value
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const buffer = Buffer.from(body, "base64");
  if (buffer.length === 0) {
    throw new Error("WINDOWS_CERTIFICATE did not decode to a PFX payload.");
  }
  return buffer;
}

function importCertificate(path, password) {
  const escapedPath = powershellSingleQuoted(path);
  const script = `
$ErrorActionPreference = 'Stop'
$password = ConvertTo-SecureString -String $env:WINDOWS_CERTIFICATE_PASSWORD -Force -AsPlainText
Import-PfxCertificate -FilePath ${escapedPath} -CertStoreLocation Cert:\\CurrentUser\\My -Password $password | Out-Null
`;
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    {
      cwd: root,
      env: { ...process.env, WINDOWS_CERTIFICATE_PASSWORD: password },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      "failed to import Windows code-signing certificate into CurrentUser certificate store.",
    );
  }
}

function writeTauriWindowsConfig() {
  writeFileSync(
    windowsConfigPath,
    `${JSON.stringify(
      {
        bundle: {
          windows: {
            certificateThumbprint,
            digestAlgorithm,
            timestampUrl,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

function powershellSingleQuoted(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
