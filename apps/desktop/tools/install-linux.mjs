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
import { chmod, copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "../..");

const release = process.env.RELEASE === "1" || process.argv.includes("--release");
const noLaunch = process.env.NO_LAUNCH === "1" || process.argv.includes("--no-launch");

const home = homedir();
const appsDir = join(home, "Applications");
const appPath = join(appsDir, "Irodori Table.AppImage");
const iconPath = join(appsDir, "irodori-table.png");
const desktopEntryPath = join(home, ".local/share/applications/irodori-table.desktop");
const sourceIcon = resolve(desktopRoot, "src-tauri/icons/128x128.png");

if (process.platform !== "linux") {
  console.error("install-linux.mjs only runs on Linux.");
  process.exit(1);
}

// 1. Build the AppImage. Debug by default — functional verification doesn't
//    need release optimization, and the debug build is dramatically faster.
//    Go through `npm run` so the Tauri CLI (node_modules/.bin) is on PATH.
const npmArgs = ["run", "release:appimage"];
if (!release) npmArgs.push("--", "--debug");
console.log(`Building ${release ? "release" : "debug"} AppImage...`);
await run("npm", npmArgs, { cwd: desktopRoot });

// 2. Locate the freshly built AppImage.
const profileDir = release ? "release" : "debug";
const bundleDir = resolve(repoRoot, "target", profileDir, "bundle/appimage");
const builtImage = await newestAppImage(bundleDir);
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
if (noLaunch) {
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

function run(cmd, cmdArgs, opts) {
  return new Promise((res, rej) => {
    const child = spawn(cmd, cmdArgs, { stdio: "inherit", ...opts });
    child.on("exit", (code, signal) => {
      if (signal) return rej(new Error(`${cmd} terminated by ${signal}`));
      if (code !== 0) return rej(new Error(`${cmd} exited with code ${code}`));
      res();
    });
    child.on("error", rej);
  });
}

async function newestAppImage(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const images = entries.filter((name) => name.endsWith(".AppImage"));
  let newest = null;
  let newestMtime = -Infinity;
  for (const name of images) {
    const full = join(dir, name);
    const info = await stat(full);
    if (info.mtimeMs > newestMtime) {
      newestMtime = info.mtimeMs;
      newest = full;
    }
  }
  return newest;
}
