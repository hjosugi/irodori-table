import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconDir = join(root, "src-tauri", "icons");
const source = join(iconDir, "irodori-icon.svg");
const tempDir = join(root, ".icon-build");

const pngTargets = new Map([
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50],
]);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icnsEntries = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function renderPng(out, size) {
  run("rsvg-convert", [
    "--width",
    String(size),
    "--height",
    String(size),
    "--output",
    out,
    source,
  ]);
}

function writeIcns(entries, out) {
  const chunks = entries.map(([kind, size]) => {
    const png = readFileSync(join(tempDir, `icns-${size}.png`));
    const header = Buffer.alloc(8);
    header.write(kind, 0, 4, "ascii");
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 8);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(totalLength, 4);
  writeFileSync(out, Buffer.concat([header, ...chunks], totalLength));
}

function collectIconRenderSizes(icoSizes, icnsEntries) {
  return new Set([...icoSizes, ...icnsEntries.map(([, size]) => size)]);
}

function main() {
  mkdirSync(tempDir, { recursive: true });

  for (const [name, size] of pngTargets) {
    renderPng(join(iconDir, name), size);
  }

  for (const size of collectIconRenderSizes(icoSizes, icnsEntries)) {
    renderPng(join(tempDir, `icns-${size}.png`), size);
  }

  run("magick", [
    ...icoSizes.map((size) => join(tempDir, `icns-${size}.png`)),
    join(iconDir, "icon.ico"),
  ]);

  writeIcns(icnsEntries, join(iconDir, "icon.icns"));
  rmSync(tempDir, { recursive: true, force: true });
}

main();
