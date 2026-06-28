#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "../..");
const defaultExtensionsRoot = resolve(root, "../../irodori-extensions");
const extensionsRoot =
  process.env.IRODORI_EXTENSIONS_ROOT ?? defaultExtensionsRoot;

const index = JSON.parse(
  readFileSync(resolve(root, "docs/extension-marketplace/index.json"), "utf8"),
);
const engines = JSON.parse(readFileSync(resolve(root, "knowledge/engines.json"), "utf8"))
  .engines;
const enginesById = new Map(engines.map((engine) => [engine.id, engine]));
const platforms = [
  "windowsX64",
  "windowsArm64",
  "macosX64",
  "macosArm64",
  "linuxX64",
  "linuxArm64",
];

const internalExtensions = [
  {
    id: "irodori.kv-store",
    name: "KV Store Connector",
    publisher: "irodori",
    version: "0.1.0",
    apiVersion: "0.1",
    summary: "Internal generic key-value connector target.",
    description:
      "Internal connector target kept out of the public marketplace until a concrete provider implementation is published.",
    license: "MIT OR 0BSD",
    repository: "https://github.com/hjosugi/irodori-extension-kv-store",
    categories: ["connector", "key-value", "internal"],
    engines: ["kvStore"],
    permissions: [
      "connections:read",
      "connections:write",
      "queries:run",
      "metadata:read",
      "native",
    ],
    runtime: "native",
    verified: false,
    publishedAt: "2026-06-27T00:00:00Z",
    visibility: "internal",
  },
];

const entries = [...index.extensions, ...internalExtensions];

for (const entry of entries) {
  writeConnectorRepo(entry);
}

console.log(
  `connector-scaffold: wrote ${entries.length} repos in ${extensionsRoot}`,
);

function writeConnectorRepo(entry) {
  const engine = entry.engines?.[0];
  if (!engine) {
    throw new Error(`${entry.id} has no engine`);
  }
  const engineMeta = enginesById.get(engine);
  if (!engineMeta) {
    throw new Error(`${entry.id} references unknown engine ${engine}`);
  }
  const repoName = repositoryName(entry);
  const repoDir = resolve(extensionsRoot, repoName);
  const crateName = repoName.replaceAll("-", "_");
  const connectorId = `${engine}.connector`;
  const moduleId = `${engine}.driver`;
  const label = connectorLabel(entry.name, engineMeta.label);
  const features = connectorFeatures(entry, engineMeta);
  const visibility = entry.visibility ?? "public";
  const permissions = unique([
    ...(entry.permissions ?? []),
    "connectors",
    "native",
  ]);
  const nativeModule = {
    id: moduleId,
    path: "dist/native",
    platforms,
  };
  const connectorContribution = {
    id: connectorId,
    engine,
    label,
    aliases: unique([
      engine,
      kebabEngine(engine),
      engineMeta.label,
      ...nameAliases(entry.name),
    ]),
    defaultPort: engineMeta.defaultPort,
    wire: engineMeta.wire,
    module: moduleId,
    features,
  };
  const manifest = {
    $schema: "https://irodori.dev/schemas/irodori.extension.schema.json",
    manifestVersion: 1,
    id: entry.id,
    name: entry.name,
    version: entry.version,
    publisher: entry.publisher,
    description:
      entry.description ??
      `${entry.name} contributes the ${label} database connector through the native connector ABI.`,
    license: entry.license,
    repository: entry.repository,
    apiVersion: entry.apiVersion,
    runtime: "native",
    entry: "dist/native",
    permissions,
    contributes: {
      connectors: [connectorContribution],
    },
    capabilities: {
      nativeModules: [nativeModule],
    },
    dev: {
      watch: ["src", "connector.config.json", "irodori.extension.json"],
    },
  };
  const config = {
    schemaVersion: 1,
    visibility,
    extensionId: entry.id,
    connector: connectorContribution,
    runtime: {
      abi: "irodori.connector.native.v1",
      module: nativeModule,
      crate: crateName,
      entrypoints: [
        "irodori_extension_abi_version",
        "irodori_extension_manifest_json",
        "irodori_connector_config_json",
        "irodori_connector_call_json",
      ],
    },
    source: {
      marketplaceId: entry.id,
      repository: entry.repository,
      knowledgeEngineStatus: engineMeta.status,
      adapter: engineMeta.adapter ?? engineMeta.routesThrough ?? null,
    },
  };

  mkdirSync(resolve(repoDir, "src"), { recursive: true });
  mkdirSync(resolve(repoDir, "dist/native"), { recursive: true });
  mkdirSync(resolve(repoDir, ".github/workflows"), { recursive: true });

  writeJson(resolve(repoDir, "irodori.extension.json"), manifest);
  writeJson(resolve(repoDir, "connector.config.json"), config);
  writeText(resolve(repoDir, "Cargo.toml"), cargoToml(repoName, crateName));
  writeText(resolve(repoDir, "src/lib.rs"), rustLib(engine, label));
  writeText(resolve(repoDir, "README.md"), readme(entry, engineMeta, visibility));
  writeText(resolve(repoDir, "Makefile"), makefile());
  writeText(resolve(repoDir, ".gitignore"), gitignore());
  writeText(resolve(repoDir, ".github/workflows/ci.yml"), ciWorkflow());
  writeText(resolve(repoDir, "dist/native/.gitkeep"), "");
}

function repositoryName(entry) {
  const fromUrl = entry.repository?.split("/").filter(Boolean).at(-1);
  if (fromUrl) {
    return fromUrl.replace(/\.git$/, "");
  }
  return `irodori-extension-${entry.id.replace(/^irodori\./, "")}`;
}

function connectorLabel(name, fallback) {
  return name.replace(/\s+Connector$/, "") || fallback;
}

function connectorFeatures(entry, engineMeta) {
  const categories = new Set(entry.categories ?? []);
  const features = ["metadata"];
  if (!categories.has("object-store")) {
    features.push("sql");
  }
  if (
    ["verified", "wired", "extension"].includes(engineMeta.status) &&
    !categories.has("object-store")
  ) {
    features.push("streaming");
  }
  if (
    ["relational", "analytical", "warehouse", "distributed-sql"].some((family) =>
      String(engineMeta.family ?? "").includes(family),
    )
  ) {
    features.push("explain");
  }
  return unique(features);
}

function nameAliases(name) {
  return name
    .replace(/\s+Connector$/, "")
    .split(/\s*\/\s*|\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function kebabEngine(engine) {
  return engine
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path, content) {
  writeFileSync(path, content);
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

function cargoToml(packageName, crateName) {
  return `[package]
name = "${packageName}"
version = "0.1.0"
edition = "2021"
license = "MIT OR 0BSD"
publish = false

[lib]
name = "${crateName}"
crate-type = ["cdylib", "rlib"]

[dev-dependencies]
serde_json = "1"
`;
}

function rustLib(engine, label) {
  return `//! Native connector ABI for ${label}.
//!
//! Connector behavior is declared in ../connector.config.json and
//! ../irodori.extension.json so packaging can customize metadata without
//! changing Rust code.

const ABI_VERSION: u32 = 1;
const ENGINE: &str = "${engine}";
const CONFIG_JSON: &str = include_str!("../connector.config.json");
const MANIFEST_JSON: &str = include_str!("../irodori.extension.json");
const NOT_LINKED_RESPONSE_JSON: &str = r#"{"ok":false,"error":{"code":"connector.driverNotLinked","message":"The native connector metadata is available, but the engine-specific driver entrypoint is not linked in this package yet."}}"#;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct IrodoriConnectorBuffer {
    pub ptr: *const u8,
    pub len: usize,
}

fn static_buffer(value: &'static str) -> IrodoriConnectorBuffer {
    IrodoriConnectorBuffer {
        ptr: value.as_ptr(),
        len: value.len(),
    }
}

#[no_mangle]
pub extern "C" fn irodori_extension_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn irodori_connector_engine_json() -> IrodoriConnectorBuffer {
    static_buffer(ENGINE)
}

#[no_mangle]
pub extern "C" fn irodori_extension_manifest_json() -> IrodoriConnectorBuffer {
    static_buffer(MANIFEST_JSON)
}

#[no_mangle]
pub extern "C" fn irodori_connector_config_json() -> IrodoriConnectorBuffer {
    static_buffer(CONFIG_JSON)
}

#[no_mangle]
pub extern "C" fn irodori_connector_call_json(_request: IrodoriConnectorBuffer) -> IrodoriConnectorBuffer {
    static_buffer(NOT_LINKED_RESPONSE_JSON)
}

#[no_mangle]
pub extern "C" fn irodori_connector_free_buffer(_buffer: IrodoriConnectorBuffer) {}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn manifest_and_config_describe_the_same_connector() {
        let manifest: Value = serde_json::from_str(MANIFEST_JSON).unwrap();
        let config: Value = serde_json::from_str(CONFIG_JSON).unwrap();
        let connector = &manifest["contributes"]["connectors"][0];

        assert_eq!(manifest["id"], config["extensionId"]);
        assert_eq!(connector["engine"], ENGINE);
        assert_eq!(connector["engine"], config["connector"]["engine"]);
        assert_eq!(connector["module"], config["connector"]["module"]);
        assert!(manifest["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|permission| permission == "connectors"));
    }

    #[test]
    fn abi_exports_static_json() {
        assert_eq!(irodori_extension_abi_version(), ABI_VERSION);
        assert!(irodori_extension_manifest_json().len > 0);
        assert!(irodori_connector_config_json().len > 0);
        assert_eq!(irodori_connector_engine_json().len, ENGINE.len());
    }
}
`;
}

function readme(entry, engineMeta, visibility) {
  const publicNote =
    visibility === "public"
      ? "This connector is listed in the public Irodori extension marketplace."
      : "This connector is internal and intentionally omitted from the public Irodori extension marketplace.";
  return `# ${entry.name}

${entry.summary}

${publicNote}

## Connector

- Extension ID: \`${entry.id}\`
- Engine ID: \`${entry.engines[0]}\`
- Wire: \`${engineMeta.wire}\`
- Default port: \`${engineMeta.defaultPort}\`
- Native ABI: \`irodori.connector.native.v1\`

Connector metadata lives in \`connector.config.json\` and \`irodori.extension.json\`.
The Rust code only exports the native ABI and embedded JSON so connector metadata
can be customized without code edits.

## Development

\`\`\`sh
cargo test
make build
\`\`\`

Release packages place platform-specific native artifacts under \`dist/native\`.
`;
}

function makefile() {
  return `.PHONY: build test package clean

build:
\tcargo build --release

test:
\tcargo test

package: build
\tmkdir -p dist/native
\tcp target/release/libirodori_extension_* dist/native/ 2>/dev/null || true
\tcp target/release/irodori_extension_*.dll dist/native/ 2>/dev/null || true
\tcp target/release/libirodori_extension_*.dylib dist/native/ 2>/dev/null || true

clean:
\tcargo clean
`;
}

function gitignore() {
  return `/target
/.irodori-dev
dist/native/*
!dist/native/.gitkeep
`;
}

function ciWorkflow() {
  return `name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo test
`;
}
