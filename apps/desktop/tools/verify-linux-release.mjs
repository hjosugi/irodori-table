import { constants } from "node:fs";
import { access, open, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { newestFileByExtension } from "../../../tools/lib/files.mjs";
import { fromDesktopRoot, fromRepoRoot } from "../../../tools/lib/paths.mjs";
import { runWithTimeout } from "../../../tools/lib/process.mjs";

const options = parseArgs(process.argv.slice(2));
const profile = options.debug ? "debug" : "release";
const cargoTargetDir = resolve(
  process.env.CARGO_TARGET_DIR ?? fromRepoRoot(".irodori-local/target"),
);
const bundleDir = resolve(cargoTargetDir, profile, "bundle/appimage");
const appImage = await newestFileByExtension(bundleDir, ".AppImage");

if (!appImage) {
  fail(`No AppImage found under ${bundleDir}`);
}

const pkg = JSON.parse(await readFile(fromDesktopRoot("package.json"), "utf8"));
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
    fail(
      `AppImage filename does not include package version ${version}: ${file}`,
    );
  }

  const handle = await open(file, "r");
  const header = Buffer.alloc(4);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  if (
    header[0] !== 0x7f ||
    header[1] !== 0x45 ||
    header[2] !== 0x4c ||
    header[3] !== 0x46
  ) {
    fail(`AppImage is not an ELF executable: ${file}`);
  }

  if (!options.skipExec) {
    await runAppImageHelp(file);
  }
}

async function runAppImageHelp(file) {
  const { code, output } = await runWithTimeout(
    file,
    ["--appimage-help"],
    10_000,
  );
  if (code !== 0) {
    fail(`AppImage --appimage-help exited ${code}: ${output.trim()}`);
  }
  if (!/AppImage/i.test(output)) {
    fail(`AppImage --appimage-help did not print AppImage help text`);
  }
}

function fail(message) {
  console.error(`linux-release: ${message}`);
  process.exit(1);
}
