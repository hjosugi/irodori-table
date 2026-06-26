#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowlistPath = resolve(root, "security/dependency-review-allowlist.json");
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));
const npmLockfiles = [
  "apps/desktop/package-lock.json",
  "apps/web/package-lock.json",
  "apps/web/endpoint/package-lock.json",
];
const errors = [];

for (const lockfile of npmLockfiles) {
  checkNpmLockfile(lockfile);
}
checkCargoMetadata();
checkCargoLockGitSources("Cargo.lock");
checkCargoLockGitSources("apps/desktop/src-tauri/Cargo.lock");

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`dependency-review: ${error}`);
  }
  console.error("\nUpdate security/dependency-review-allowlist.json only after review.");
  process.exit(1);
}

console.log("dependency-review: ok");

function checkNpmLockfile(lockfile) {
  const fullPath = resolve(root, lockfile);
  const lock = JSON.parse(readFileSync(fullPath, "utf8"));
  for (const [packagePath, packageInfo] of Object.entries(lock.packages ?? {})) {
    if (!packagePath) {
      continue;
    }

    const name = npmPackageName(packagePath);
    if (!name) {
      continue;
    }

    if (packageInfo.hasInstallScript && !allowlist.npmInstallScripts?.[name]) {
      errors.push(`${lockfile}: ${name} has an install script`);
    }

    if (
      packageInfo.resolved?.startsWith("http") &&
      !packageInfo.integrity &&
      !packageInfo.link
    ) {
      errors.push(`${lockfile}: ${name} has a remote tarball without integrity`);
    }

    if (
      packageInfo.resolved &&
      !packageInfo.resolved.startsWith("https://registry.npmjs.org/") &&
      !packageInfo.resolved.startsWith("file:") &&
      !packageInfo.link
    ) {
      errors.push(
        `${lockfile}: ${name} resolves outside the npm registry (${packageInfo.resolved})`,
      );
    }
  }
}

function checkCargoMetadata() {
  const result = spawnSync(
    "cargo",
    ["metadata", "--no-deps", "--locked", "--format-version", "1"],
    {
      cwd: root,
      encoding: "utf8",
      shell: false,
    },
  );
  if (result.status !== 0) {
    errors.push(`cargo metadata failed: ${(result.stderr || result.stdout).trim()}`);
    return;
  }

  const metadata = JSON.parse(result.stdout);
  for (const pkg of metadata.packages ?? []) {
    for (const dependency of pkg.dependencies ?? []) {
      if (dependency.source?.startsWith("git+") && !allowlist.cargoGitSources?.[dependency.name]) {
        errors.push(`${pkg.name}: git dependency ${dependency.name} (${dependency.source})`);
      }

      if (!dependency.path) {
        continue;
      }
      const dependencyPath = resolve(dependency.path);
      if (isInside(dependencyPath, root)) {
        continue;
      }
      if (!allowlist.cargoExternalPaths?.[dependency.name]) {
        const rel = relative(root, dependencyPath) || dependencyPath;
        errors.push(`${pkg.name}: external path dependency ${dependency.name} (${rel})`);
      }
    }
  }
}

function checkCargoLockGitSources(lockfile) {
  const fullPath = resolve(root, lockfile);
  let source = "";
  try {
    source = readFileSync(fullPath, "utf8");
  } catch {
    return;
  }

  for (const block of source.split(/\n\[\[package\]\]\n/)) {
    const name = block.match(/\n?name = "([^"]+)"/)?.[1];
    const sourceValue = block.match(/\nsource = "([^"]+)"/)?.[1];
    if (!name || !sourceValue?.startsWith("git+")) {
      continue;
    }
    if (!allowlist.cargoGitSources?.[name]) {
      errors.push(`${lockfile}: git source ${name} (${sourceValue})`);
    }
  }
}

function npmPackageName(packagePath) {
  const parts = packagePath.split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index < 0 || index + 1 >= parts.length) {
    return null;
  }
  const first = parts[index + 1];
  if (first.startsWith("@")) {
    return parts[index + 2] ? `${first}/${parts[index + 2]}` : null;
  }
  return first;
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}
