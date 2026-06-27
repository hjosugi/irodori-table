# Rust/TypeScript Type Bridge Handoff

Last checked: 2026-06-27 JST.

The standalone generator is published as the `typeship` and `typeship-ts-rs`
crates. This document is the Irodori-side contract: how Irodori consumes the
bridge and keeps `apps/desktop/src/generated/` in sync.

Irodori should keep Rust structs idiomatic in Rust, keep JSON payloads idiomatic in TypeScript, and avoid hand-written duplicate types.

The immediate boundary is visible in the desktop prototype:

- `apps/desktop/src-tauri/src/lib.rs` defines `DbObject`, `Connection`, and `WorkspaceSnapshot` in Rust.
- Rust fields stay `snake_case`.
- Serialized JSON should use `camelCase` with Serde, for example `#[serde(rename_all = "camelCase")]`.
- `apps/desktop/src/App.tsx` imports generated TypeScript types and a typed `workspaceSnapshot()` wrapper from `apps/desktop/src/generated/irodori-api.ts`.

The first spike now uses `ts-rs` in the Tauri crate and a Rust test named `export_typescript_bindings` to generate the frontend boundary.

## Objective

Create an `irodori-typeship` path that makes Rust the source of truth for internal command payloads and generates the TypeScript surface automatically.

The first version can live inside this repository. If it grows into a general tool, split it into a separate permissively licensed project.

## Requirements

- Rust type names, modules, derives, and field names remain idiomatic for Rust.
- JSON and TypeScript names follow frontend conventions, especially `camelCase`.
- Serde attributes are respected: `rename`, `rename_all`, `tag`, `content`, `untagged`, `flatten`, `default`, `skip`, `skip_serializing`, and `skip_serializing_if`.
- Generated TypeScript includes request types, response types, error types, and typed wrappers for Tauri commands.
- The generator handles structs, enums, string literal unions, generics where needed, `Option`, `Vec`, arrays, maps, timestamps, UUIDs, decimal values, bytes, and JSON values.
- Generated files are deterministic, formatted, and checked in CI.
- Runtime validation is optional, but dev builds should be able to emit Zod/Valibot/JSON Schema validators for unsafe boundaries.
- Extension SDK types are generated from the same source so extension authors do not receive stale hand-written definitions.

## Candidate Ecosystem

Use existing projects where they fit. Do not copy code unless the license and adaptation path are explicit.

- `ts-rs`: focused Rust-to-TypeScript generation, Serde compatibility, and export tests. Good MVP candidate for model types.
- `specta`: broader type export ecosystem with TypeScript, Zod, JSON Schema, OpenAPI, and Tauri-related community usage. Strong candidate if command export and validator generation become central.
- `typeshare`: CLI-oriented multi-language type sharing from Rust, useful as a reference for standalone generation and non-TypeScript future SDKs.
- `schemars`: JSON Schema generation from Rust with Serde compatibility, useful when runtime validation, schema docs, or external plugin contracts matter.

Source links:

- https://github.com/Aleph-Alpha/ts-rs
- https://github.com/specta-rs/specta
- https://github.com/1Password/typeshare
- https://github.com/GREsau/schemars

## MVP

Start with the desktop command boundary.

Done for the first prototype:

1. `workspace_snapshot` response types derive `Serialize`, `Deserialize`, and `TS`.
2. `DbObjectKind` and `ConnectionStatus` are Rust enums that generate TypeScript string unions.
3. TypeScript is generated into `apps/desktop/src/generated/irodori-api.ts`.
4. `App.tsx` imports the generated `WorkspaceSnapshot` type and `workspaceSnapshot()` wrapper.
5. `apps/desktop/package.json` exposes `npm run typegen`; `npm run build`
   stays frontend-only for speed, while `npm run build:verified` runs the
   generated-binding drift check before TypeScript compilation.

Still needed:

1. Move command-facing types from `lib.rs` into a Rust module such as `irodori_api`.
2. Add a `typegen --check` command that fails if generated bindings are stale.
3. Expand generation beyond `workspace_snapshot`.

For the current prototype, the generated TypeScript should include something equivalent to:

```ts
export type DbObject = {
  name: string;
  kind: "table" | "view" | "procedure";
  rows?: string;
};

export type Connection = {
  id: string;
  name: string;
  engine: string;
  status: "connected" | "idle";
  latencyMs: number;
  proxy: string;
  objects: DbObject[];
};

export type WorkspaceSnapshot = {
  connections: Connection[];
  activeConnectionId: string;
};
```

Then a wrapper should hide raw `invoke` strings:

```ts
export function workspaceSnapshot(): Promise<WorkspaceSnapshot> {
  return invoke<WorkspaceSnapshot>("workspace_snapshot");
}
```

## Architecture Sketch

Use three layers:

- `irodori-api`: Rust command, event, extension, and shared payload types.
- `irodori-typeship`: generator facade, initially a thin wrapper around the selected library.
- `generated/irodori-api.ts`: committed TypeScript API consumed by the desktop UI and extension SDK.

The generator should know about command metadata, not only plain types:

```rust
#[irodori_command]
pub async fn workspace_snapshot() -> Result<WorkspaceSnapshot, IrodoriError> {
    todo!()
}
```

Generated TypeScript should expose:

```ts
export const commands = {
  workspaceSnapshot(): Promise<WorkspaceSnapshot> {
    return invoke("workspace_snapshot");
  },
};
```

## Naming Rules

- Rust fields: `snake_case`.
- JSON object fields: `camelCase`.
- TypeScript properties: `camelCase`.
- Rust enum variants: idiomatic Rust.
- TypeScript discriminants: stable lowercase or explicit Serde names.
- Command names: keep Tauri command IDs stable; expose camelCase wrappers in TS.

Every command-facing struct should either:

- use `#[serde(rename_all = "camelCase")]`, or
- intentionally opt out with a short comment explaining why the JSON shape differs.

## Generated File Policy

- Generated TypeScript lives under `apps/desktop/src/generated/`.
- Generated extension SDK types later live under `packages/extension-sdk/src/generated/`.
- Generated files include a header saying which command created them.
- Developers do not edit generated files manually.
- CI runs generation and checks the working tree for drift.

Suggested commands:

```bash
npm run typegen --prefix apps/desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml export_typescript_bindings
```

Later this should become:

```bash
cargo xtask typegen
cargo xtask typegen --check
```

If the frontend pipeline needs Node-only formatting, the typegen wrapper can call the formatter after Rust generation.

## Runtime Validation

Do not make runtime validation mandatory for every internal call; Rust and TypeScript should be statically aligned first.

Add optional validators for:

- extension host boundaries;
- imported settings, keymaps, and themes;
- plugin-provided driver metadata;
- persisted workspace files;
- AI/MCP tool payloads;
- any untrusted JSON from outside the desktop process.

## Extension SDK Impact

This bridge should become the foundation for extension APIs.

- Command names, payloads, permission scopes, result-grid APIs, theme APIs, and driver APIs should be generated or schema-backed.
- Extension examples should compile against generated types.
- Breaking API changes should be visible as generated diff and semantic-versioning review.

## Split Criteria

Keep the bridge in this repository while it is Irodori-specific. Split into a separate project when at least two of these are true:

- It supports multiple frontend targets or non-Irodori users.
- It has a CLI, config file, and public Rust API that make sense without the desktop app.
- It generates command clients for Tauri plus at least one other transport.
- It emits validators or schema docs as a product-quality feature.
- Extension authors need to depend on it directly.

If split, keep the core license `MIT OR 0BSD` unless dependency choices force a different compatible license.

## Open Questions

- Choose `ts-rs`, `specta`, `schemars`, or a hybrid after a small spike.
- Decide whether generated TypeScript should use `type` aliases only, or also emit Zod/Valibot schemas.
- Decide how to model large integers: `bigint`, string, or number per field.
- Decide whether errors are one shared `IrodoriError` union or command-specific error types.
- Decide how extension API versioning maps to generated type packages.

## Next Implementation Steps

1. Move command payload types out of `lib.rs` into an `api` module.
2. Add `typegen --check` to CI before broader command work begins.
3. Add command metadata generation for arguments, return types, and error types.
4. Extend the same bridge to the extension SDK contracts.
