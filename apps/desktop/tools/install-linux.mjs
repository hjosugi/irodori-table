// Local "ship to my machine" helper for real-device testing on Linux
// (CachyOS/Arch and anything else that runs AppImages).
//
//   make run-linux            # fast debug build, install, and launch
//   RELEASE=1 make run-linux  # optimized build instead of debug
//   NO_LAUNCH=1 make run-linux # install but don't open it
//
// It reuses tools/build-linux-release.mjs to produce the AppImage (with the
// cached AppImage runtime), copies it to ~/Applications under a stable name so
// each new version overwrites the previous one, writes a .desktop entry so it
// shows up in the launcher, and opens it. The whole point is to go from "new
// version" to "running app" with one command and no CI wait.

import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { newestFileByExtension } from "../../../tools/lib/files.mjs";
import {
  fromDesktopRoot,
  fromRepoRoot,
  desktopRoot,
} from "../../../tools/lib/paths.mjs";
import { run } from "../../../tools/lib/process.mjs";

const options = parseInstallOptions(process.argv.slice(2), process.env);
const cargoTargetDir = resolve(
  process.env.CARGO_TARGET_DIR ?? fromRepoRoot(".irodori-local/target"),
);

const home = homedir();
const appsDir = join(home, "Applications");
const appPath = join(appsDir, "Irodori Table.AppImage");
const iconPath = join(appsDir, "irodori-table.png");
const desktopEntryPath = join(
  home,
  ".local/share/applications/irodori-table.desktop",
);
const sourceIcon = fromDesktopRoot("src-tauri/icons/128x128.png");

if (process.platform !== "linux") {
  console.error("install-linux.mjs only runs on Linux.");
  process.exit(1);
}

// 1. Build the AppImage. Debug by default — functional verification doesn't
//    need release optimization, and the debug build is dramatically faster.
//    Go through `npm run` so the Tauri CLI (node_modules/.bin) is on PATH.
const npmArgs = buildNpmArgs(options.release);
console.log(`Building ${options.release ? "release" : "debug"} AppImage...`);
await run("npm", npmArgs, { cwd: desktopRoot });

// 2. Locate the freshly built AppImage.
const profileDir = profileDirName(options.release);
const bundleDir = join(cargoTargetDir, profileDir, "bundle/appimage");
const builtImage = await newestFileByExtension(bundleDir, ".AppImage");
if (!builtImage) {
  console.error(`No .AppImage found under ${bundleDir}`);
  process.exit(1);
}

// 3. Install it to a stable private location so it replaces the prior version.
await mkdir(appsDir, { recursive: true });
await copyFile(builtImage, appPath);
await chmod(appPath, 0o755);
await copyFile(sourceIcon, iconPath).catch(() => {});
console.log(`Installed: ${appPath}`);

// 4. Register a desktop entry so it appears in the application launcher.
await mkdir(dirname(desktopEntryPath), { recursive: true });
await writeFile(
  desktopEntryPath,
  [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Irodori Table",
    "Comment=Fast SQL workbench (local test build)",
    `Exec=env APPIMAGE_EXTRACT_AND_RUN=1 "${appPath}"`,
    `Icon=${iconPath}`,
    "Categories=Development;Database;",
    "Terminal=false",
    "",
  ].join("\n"),
  "utf8",
);
console.log(`Desktop entry: ${desktopEntryPath}`);

// 5. Launch it (detached) unless asked not to. APPIMAGE_EXTRACT_AND_RUN avoids
//    a hard dependency on FUSE.
if (options.noLaunch) {
  console.log("Skipping launch (NO_LAUNCH).");
} else {
  console.log("Launching...");
  const child = spawn(appPath, [], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1" },
  });
  child.unref();
}

function parseInstallOptions(argv, env) {
  return {
    release: env.RELEASE === "1" || argv.includes("--release"),
    noLaunch: env.NO_LAUNCH === "1" || argv.includes("--no-launch"),
  };
}

function buildNpmArgs(release) {
  const args = ["run", "release:appimage"];
  if (!release) args.push("--", "--debug");
  return args;
}

function profileDirName(release) {
  return release ? "release" : "debug";
}
