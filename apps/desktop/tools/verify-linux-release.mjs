import { constants } from "node:fs";
import { access, open, readdir, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "../..");

const options = parseArgs(process.argv.slice(2));
const profile = options.debug ? "debug" : "release";
const bundleDir = resolve(repoRoot, "target", profile, "bundle/appimage");
const appImage = await newestAppImage(bundleDir);

if (!appImage) {
  fail(`No AppImage found under ${bundleDir}`);
}

const pkg = JSON.parse(
  await readFile(resolve(desktopRoot, "package.json"), "utf8"),
);
await verifyAppImage(appImage, pkg.version);
console.log(`linux-release: ok (${appImage})`);

function parseArgs(argv) {
  return {
    debug: argv.includes("--debug"),
    skipExec: argv.includes("--skip-exec"),
  };
}

async function verifyAppImage(file, version) {
  const info = await stat(file);
  if (!info.isFile()) {
    fail(`AppImage path is not a file: ${file}`);
  }
  if (info.size < 1_000_000) {
    fail(`AppImage is suspiciously small (${info.size} bytes): ${file}`);
  }
  await access(file, constants.X_OK).catch(() => {
    fail(`AppImage is not executable: ${file}`);
  });
  if (!file.includes(version)) {
    fail(`AppImage filename does not include package version ${version}: ${file}`);
  }

  const handle = await open(file, "r");
  const header = Buffer.alloc(4);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  if (header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) {
    fail(`AppImage is not an ELF executable: ${file}`);
  }

  if (!options.skipExec) {
    await runAppImageHelp(file);
  }
}

async function runAppImageHelp(file) {
  const { code, output } = await runWithTimeout(file, ["--appimage-help"], 10_000);
  if (code !== 0) {
    fail(`AppImage --appimage-help exited ${code}: ${output.trim()}`);
  }
  if (!/AppImage/i.test(output)) {
    fail(`AppImage --appimage-help did not print AppImage help text`);
  }
}

function runWithTimeout(cmd, args, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      output += `\nTimed out after ${timeoutMs}ms`;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ code: 1, output: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, output });
    });
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

function fail(message) {
  console.error(`linux-release: ${message}`);
  process.exit(1);
}
