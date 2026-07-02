#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { fromRepoRoot } from "../lib/paths.mjs";

const mode = process.argv[2] || "check";
const cargoTomlPath = fromRepoRoot("Cargo.toml");
const kitRoot = fromRepoRoot("../irodori-kit");
const markerStart = "# BEGIN IRODORI LOCAL KIT PATCH";
const markerEnd = "# END IRODORI LOCAL KIT PATCH";
const patchHeader = '[patch."https://github.com/hjosugi/irodori-kit"]';
const crates = [
  "irodori-core",
  "irodori-proxy",
  "irodori-secure-store",
  "irodori-completion",
  "irodori-generate",
];

if (!["link", "unlink", "check"].includes(mode)) {
  console.error("Usage: node tools/dev/patch-siblings.mjs <link|unlink|check>");
  process.exit(2);
}

const current = readFileSync(cargoTomlPath, "utf8");

if (mode === "check") {
  if (hasKitPatch(current)) {
    console.error("Cargo.toml contains a local irodori-kit [patch]. Run `make kit-unlink` before committing.");
    process.exit(1);
  }
  console.log("Cargo.toml has no local irodori-kit patch.");
  process.exit(0);
}

if (mode === "unlink") {
  const next = removeManagedPatch(current);
  if (next === current) {
    console.log("No managed irodori-kit patch block found.");
    process.exit(0);
  }
  writeFileSync(cargoTomlPath, next, "utf8");
  console.log("Removed managed irodori-kit patch block from Cargo.toml.");
  process.exit(0);
}

if (!existsSync(kitRoot)) {
  console.error("Expected sibling checkout at ../irodori-kit.");
  console.error("Clone it with: git clone https://github.com/hjosugi/irodori-kit ../irodori-kit");
  process.exit(1);
}

if (hasKitPatch(current)) {
  if (current.includes(markerStart)) {
    console.log("Managed irodori-kit patch block is already present.");
    process.exit(0);
  }
  console.error("Cargo.toml already contains an irodori-kit [patch] block. Remove or reconcile it manually first.");
  process.exit(1);
}

writeFileSync(cargoTomlPath, `${current.trimEnd()}\n\n${patchBlock()}\n`, "utf8");
console.log("Added managed irodori-kit patch block to Cargo.toml.");

function hasKitPatch(contents) {
  return contents.includes(patchHeader);
}

function removeManagedPatch(contents) {
  const pattern = new RegExp(`\\n?${escapeRegex(markerStart)}[\\s\\S]*?${escapeRegex(markerEnd)}\\n?`, "m");
  return `${contents.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function patchBlock() {
  const lines = [markerStart, patchHeader];
  for (const crate of crates) {
    lines.push(`${crate} = { path = "../irodori-kit/${crate}" }`);
  }
  lines.push(markerEnd);
  return lines.join("\n");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
