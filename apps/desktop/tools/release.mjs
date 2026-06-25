import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "../..");

// Paths
const pkgJsonPath = resolve(desktopRoot, "package.json");
const tauriConfPath = resolve(desktopRoot, "src-tauri/tauri.conf.json");
const tauriCargoPath = resolve(desktopRoot, "src-tauri/Cargo.toml");
const rootCargoPath = resolve(repoRoot, "Cargo.toml");
const rootCargoLockPath = resolve(repoRoot, "Cargo.lock");
const pkgLockPath = resolve(desktopRoot, "package-lock.json");

// 1. Parse bump type
const bumpType = process.argv[2] || "patch"; // patch, minor, major

// 2. Read current version
const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
const currentVersion = pkg.version;

// 3. Compute new version
const versionResult = resolveNextVersion(currentVersion, bumpType);
if (!versionResult.ok) {
  console.error(versionResult.message);
  if (versionResult.usage) {
    console.error(versionResult.usage);
  }
  process.exit(1);
}
const newVersion = versionResult.version;
console.log(`Bumping version from ${currentVersion} to ${newVersion}...`);

// 4. Update files
// package.json
pkg.version = newVersion;
writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log(`Updated package.json`);

// tauri.conf.json
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
tauriConf.version = newVersion;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n", "utf8");
console.log(`Updated tauri.conf.json`);

// src-tauri/Cargo.toml
let tauriCargo = readFileSync(tauriCargoPath, "utf8");
tauriCargo = tauriCargo.replace(/^(version\s*=\s*")[^"]*(")/m, `$1${newVersion}$2`);
writeFileSync(tauriCargoPath, tauriCargo, "utf8");
console.log(`Updated apps/desktop/src-tauri/Cargo.toml`);

// Cargo.toml (root)
let rootCargo = readFileSync(rootCargoPath, "utf8");
rootCargo = rootCargo.replace(/^(version\s*=\s*")[^"]*(")/m, `$1${newVersion}$2`);
writeFileSync(rootCargoPath, rootCargo, "utf8");
console.log(`Updated root Cargo.toml`);

// 4b. Sync lockfiles so the committed tree builds with --locked / npm ci.
// Cargo.lock: members use `version.workspace = true`, so the root bump moves
// every workspace crate. `--workspace` relocks only those, never external deps.
console.log("Updating Cargo.lock (workspace members)...");
execSync(`cargo update --workspace`, { stdio: "inherit", cwd: repoRoot });
console.log(`Updated Cargo.lock`);

// package-lock.json: only the root version field drifts on a bump. Patch it
// directly instead of `npm install --package-lock-only` to avoid pulling in
// unrelated transitive-dependency updates as part of a release commit.
const pkgLock = JSON.parse(readFileSync(pkgLockPath, "utf8"));
pkgLock.version = newVersion;
if (pkgLock.packages && pkgLock.packages[""]) {
  pkgLock.packages[""].version = newVersion;
}
writeFileSync(pkgLockPath, JSON.stringify(pkgLock, null, 2) + "\n", "utf8");
console.log(`Updated package-lock.json`);

// 5. Git operations
try {
  console.log("Staging modified files...");
  execSync(`git add "${pkgJsonPath}" "${pkgLockPath}" "${tauriConfPath}" "${tauriCargoPath}" "${rootCargoPath}" "${rootCargoLockPath}"`, { stdio: "inherit" });
  
  const commitMsg = `chore: release v${newVersion}`;
  console.log(`Committing: ${commitMsg}`);
  execSync(`git commit -m "${commitMsg}"`, { stdio: "inherit" });

  const tagName = `v${newVersion}`;
  console.log(`Creating tag: ${tagName}`);
  execSync(`git tag -a "${tagName}" -m "Release ${tagName}"`, { stdio: "inherit" });

  console.log("Pushing commits and tags to GitHub...");
  execSync(`git push origin main --follow-tags`, { stdio: "inherit" });

  console.log(`\nVersion bumped, tagged, and pushed successfully!`);
} catch (error) {
  console.error("Git operation failed:", error.message);
  process.exit(1);
}

function resolveNextVersion(currentVersion, bumpType) {
  const current = parseSemver(currentVersion);
  if (!current) {
    return {
      ok: false,
      message: `Invalid current version: ${currentVersion}`
    };
  }

  if (bumpType === "major") {
    return { ok: true, version: formatSemver(current.major + 1, 0, 0) };
  }
  if (bumpType === "minor") {
    return { ok: true, version: formatSemver(current.major, current.minor + 1, 0) };
  }
  if (bumpType === "patch") {
    return { ok: true, version: formatSemver(current.major, current.minor, current.patch + 1) };
  }

  if (!/^\d+\.\d+\.\d+$/.test(bumpType)) {
    return {
      ok: false,
      message: `Unknown bump type or invalid version: ${bumpType}`,
      usage: "Usage: npm run release [patch|minor|major|x.y.z]"
    };
  }

  const custom = parseSemver(bumpType);
  return { ok: true, version: formatSemver(custom.major, custom.minor, custom.patch) };
}

function parseSemver(value) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return null;
  }
  const [major, minor, patch] = parts;
  return { major, minor, patch };
}

function formatSemver(major, minor, patch) {
  return `${major}.${minor}.${patch}`;
}
