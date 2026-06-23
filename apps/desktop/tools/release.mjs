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

// 1. Parse bump type
const bumpType = process.argv[2] || "patch"; // patch, minor, major

// 2. Read current version
const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
const currentVersion = pkg.version;

// 3. Compute new version
const parts = currentVersion.split(".").map(Number);
if (parts.length !== 3 || parts.some(isNaN)) {
  console.error(`Invalid current version: ${currentVersion}`);
  process.exit(1);
}

let [major, minor, patch] = parts;
if (bumpType === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else if (bumpType === "minor") {
  minor += 1;
  patch = 0;
} else if (bumpType === "patch") {
  patch += 1;
} else {
  // Assume direct version string
  if (!/^\d+\.\d+\.\d+$/.test(bumpType)) {
    console.error(`Unknown bump type or invalid version: ${bumpType}`);
    console.error(`Usage: npm run release [patch|minor|major|x.y.z]`);
    process.exit(1);
  }
  const customParts = bumpType.split(".");
  major = Number(customParts[0]);
  minor = Number(customParts[1]);
  patch = Number(customParts[2]);
}

const newVersion = `${major}.${minor}.${patch}`;
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

// 5. Git operations
try {
  console.log("Staging modified files...");
  execSync(`git add "${pkgJsonPath}" "${tauriConfPath}" "${tauriCargoPath}" "${rootCargoPath}"`, { stdio: "inherit" });
  
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
