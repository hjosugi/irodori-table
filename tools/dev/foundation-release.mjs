#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { repoRoot } from "../lib/paths.mjs";

const groups = {
  kit: {
    repository: "https://github.com/hjosugi/irodori-kit",
    crates: [
      "irodori-connection",
      "irodori-security",
      "irodori-proxy",
      "irodori-secure-store",
      "irodori-completion",
      "irodori-generate",
    ],
  },
  knowledge: {
    repository: "https://github.com/hjosugi/irodori-knowledge",
    crates: ["irodori-error", "irodori-jobs", "irodori-knowledge"],
  },
  sql: {
    repository: "https://github.com/hjosugi/irodori-sql",
    crates: ["irodori-sql"],
  },
};

const siblingKitRoot = resolve(repoRoot, "../irodori-kit");
const manifests = [
  {
    label: "irodori-table",
    path: resolve(repoRoot, "Cargo.toml"),
    groups: ["kit", "knowledge", "sql"],
    lockRoot: repoRoot,
  },
  {
    label: "irodori-kit",
    path: resolve(siblingKitRoot, "Cargo.toml"),
    groups: ["knowledge", "sql"],
    lockRoot: siblingKitRoot,
    optional: true,
  },
];

const options = parseArgs(process.argv.slice(2));
const mode = options.apply ? "apply" : "check";
const targetTags = {
  kit: options.kit,
  knowledge: options.knowledge,
  sql: options.sql,
};

const loadedManifests = loadManifests();
const currentPins = collectPins(loadedManifests);
const resolvedTags = resolveTargetTags(currentPins, targetTags);
validateTagShape(resolvedTags);
validateRemoteTags(resolvedTags);

if (mode === "check") {
  printPinSummary(currentPins, resolvedTags);
  console.log("foundation-release: ok");
  process.exit(0);
}

const changedLockRoots = new Map();
for (const manifest of loadedManifests) {
  const nextSource = updateManifest(manifest, resolvedTags);
  if (nextSource !== manifest.source) {
    writeFileSync(manifest.path, nextSource, "utf8");
    changedLockRoots.set(manifest.lockRoot, manifest);
    console.log(`Updated ${manifest.label} ${relativeLabel(manifest.path)}`);
  } else {
    console.log(`${manifest.label} already matches requested foundation tags`);
  }
}

if (options.lock && changedLockRoots.size > 0) {
  for (const [lockRoot, manifest] of changedLockRoots) {
    const crates = cratesForManifest(manifest);
    console.log(`Updating ${manifest.label} Cargo.lock (${crates.join(", ")})...`);
    run("cargo", ["update", ...crates.flatMap((crate) => ["-p", crate])], {
      cwd: lockRoot,
    });
  }
}

printPinSummary(collectPins(loadManifests()), resolvedTags);
console.log("foundation-release: ok");

function parseArgs(args) {
  const parsed = {
    apply: false,
    lock: true,
    kit: null,
    knowledge: null,
    sql: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--check") {
      parsed.apply = false;
      continue;
    }
    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (arg === "--lock") {
      parsed.lock = true;
      continue;
    }
    if (arg === "--no-lock") {
      parsed.lock = false;
      continue;
    }
    if (arg === "--kit" || arg === "--knowledge" || arg === "--sql") {
      const value = args[index + 1];
      if (!value) {
        fail(`${arg} requires a version tag, for example ${arg} v0.6.0`);
      }
      parsed[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node tools/dev/foundation-release.mjs --check
  node tools/dev/foundation-release.mjs --apply --kit v0.6.0 --knowledge v0.3.0 --sql v0.3.0
  node tools/dev/foundation-release.mjs --apply --kit v0.6.0 --no-lock

Updates the app Cargo.toml and, when ../irodori-kit is present, the kit
Cargo.toml so foundation git-tag pins move as one reviewed release step.`);
}

function loadManifests() {
  const loaded = [];
  for (const manifest of manifests) {
    if (!existsSync(manifest.path)) {
      if (manifest.optional) {
        continue;
      }
      fail(`Missing required manifest: ${manifest.path}`);
    }
    loaded.push({
      ...manifest,
      source: readFileSync(manifest.path, "utf8"),
    });
  }
  return loaded;
}

function collectPins(loaded) {
  const pins = new Map();
  for (const manifest of loaded) {
    const manifestPins = {};
    for (const groupName of manifest.groups) {
      const group = groups[groupName];
      const tags = new Map();
      for (const crate of group.crates) {
        const tag = readCrateTag(manifest.source, crate);
        if (!tag) {
          fail(`${manifest.label}: missing git tag for ${crate}`);
        }
        tags.set(crate, tag);
      }
      const uniqueTags = new Set(tags.values());
      if (uniqueTags.size > 1) {
        const values = [...tags].map(([crate, tag]) => `${crate}=${tag}`).join(", ");
        fail(`${manifest.label}: ${groupName} pins are not in lockstep (${values})`);
      }
      manifestPins[groupName] = {
        tag: [...uniqueTags][0],
        crates: [...tags.keys()],
      };
    }
    pins.set(manifest.label, manifestPins);
  }
  return pins;
}

function readCrateTag(source, crate) {
  const escaped = escapeRegExp(crate);
  const pattern = new RegExp(
    `^${escaped}\\s*=\\s*\\{[^\\n}]*\\btag\\s*=\\s*"([^"]+)"[^\\n}]*\\}`,
    "m",
  );
  return source.match(pattern)?.[1] ?? null;
}

function resolveTargetTags(currentPins, targetTags) {
  const tablePins = currentPins.get("irodori-table");
  const resolved = {};
  for (const groupName of Object.keys(groups)) {
    resolved[groupName] = targetTags[groupName] ?? tablePins[groupName]?.tag;
    if (!resolved[groupName]) {
      fail(`Unable to resolve current ${groupName} tag from irodori-table Cargo.toml`);
    }
  }
  return resolved;
}

function validateTagShape(tags) {
  for (const [groupName, tag] of Object.entries(tags)) {
    if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
      fail(`${groupName} tag must look like vX.Y.Z, got ${tag}`);
    }
  }
}

function validateRemoteTags(tags) {
  for (const [groupName, tag] of Object.entries(tags)) {
    const repository = groups[groupName].repository;
    const result = spawnSync(
      "git",
      ["ls-remote", "--exit-code", "--tags", repository, `refs/tags/${tag}`],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (result.status !== 0) {
      fail(`${groupName} tag ${tag} was not found in ${repository}`);
    }
  }
}

function updateManifest(manifest, tags) {
  let nextSource = manifest.source;
  for (const groupName of manifest.groups) {
    const group = groups[groupName];
    for (const crate of group.crates) {
      if (!readCrateTag(nextSource, crate)) {
        continue;
      }
      nextSource = replaceCrateTag(nextSource, crate, tags[groupName]);
    }
  }
  return nextSource;
}

function replaceCrateTag(source, crate, tag) {
  const escaped = escapeRegExp(crate);
  const pattern = new RegExp(
    `(^${escaped}\\s*=\\s*\\{[^\\n}]*\\btag\\s*=\\s*")([^"]+)("[^\\n}]*\\})`,
    "m",
  );
  return source.replace(pattern, `$1${tag}$3`);
}

function cratesForManifest(manifest) {
  return manifest.groups.flatMap((groupName) => {
    const group = groups[groupName];
    return group.crates.filter((crate) => readCrateTag(manifest.source, crate));
  });
}

function printPinSummary(currentPins, resolvedTags) {
  for (const [label, manifestPins] of currentPins) {
    const parts = Object.entries(manifestPins).map(
      ([groupName, info]) => `${groupName}=${info.tag}`,
    );
    console.log(`${label}: ${parts.join(" ")}`);
  }
  console.log(
    `target: kit=${resolvedTags.kit} knowledge=${resolvedTags.knowledge} sql=${resolvedTags.sql}`,
  );
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relativeLabel(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1) : path;
}

function fail(message) {
  console.error(`foundation-release: ${message}`);
  process.exit(1);
}
