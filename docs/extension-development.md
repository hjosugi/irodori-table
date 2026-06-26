# Extension Development

Irodori Table treats extensions as a product surface. The extension system starts
with TypeScript because that is the fastest path for commands, UI integrations,
themes, result-grid tools, and SQL dialect metadata. Rust/Wasm remains available
for high-performance drivers, parsers, renderers, and formatters.

## Current Implementation

- Manifest schema: [`extension.schema.json`](../extension.schema.json), for files
  named `irodori.extension.json`.
- Rust source of truth: [`crates/irodori-extension`](../crates/irodori-extension).
- Generated SDK contracts:
  [`packages/extension-sdk/src/generated/irodori-extension-api.ts`](../packages/extension-sdk/src/generated/irodori-extension-api.ts).
- TypeScript SDK:
  [`packages/extension-sdk/src/index.ts`](../packages/extension-sdk/src/index.ts).
- Local dev CLI:
  [`packages/extension-sdk/bin/irodori-extension-dev.mjs`](../packages/extension-sdk/bin/irodori-extension-dev.mjs).
- Templates:
  [`packages/extension-sdk/templates/typescript-basic`](../packages/extension-sdk/templates/typescript-basic)
  and [`packages/extension-sdk/templates/wasm-sql-dialect`](../packages/extension-sdk/templates/wasm-sql-dialect).
- Example:
  [`examples/extensions/markdown-result-export`](../examples/extensions/markdown-result-export).

## Manifest

Extensions declare a strict `irodori.extension.json` manifest. The schema rejects
unknown top-level and contribution fields so the host can safely validate packages
before loading them.

```json
{
  "$schema": "../../extension.schema.json",
  "manifestVersion": 1,
  "id": "example.quick-export",
  "name": "Quick Export",
  "version": "0.1.0",
  "license": "MIT OR 0BSD",
  "apiVersion": "0.1",
  "runtime": "typescript",
  "entry": "dist/main.js",
  "permissions": ["commands", "queryResults:read", "resultRenderers"],
  "contributes": {
    "commands": [
      {
        "id": "quickExport.copyAsMarkdown",
        "title": "Copy Result as Markdown Table",
        "category": "Result Grid",
        "enablement": "resultGridFocus"
      }
    ],
    "resultGridActions": [
      {
        "id": "quickExport.copyMarkdownAction",
        "title": "Copy as Markdown",
        "command": "quickExport.copyAsMarkdown",
        "when": "resultGridFocus"
      }
    ]
  }
}
```

Core manifest fields:

- `manifestVersion`: currently `1`.
- `apiVersion`: currently `0.1`.
- `runtime`: `typescript`, `javascript`, `wasm`, or `native`.
- `permissions`: explicit capability scopes such as `commands`,
  `queryResults:read`, `themes`, `sqlDialects`, `native`, and `wasm`.
- `contributes`: declarative commands, keybindings, result-grid actions/renderers,
  themes, and SQL dialects.
- `capabilities`: Wasm and native module declarations.
- `dev`: watch paths, fake database fixtures, and log file configuration for local
  development.

## Type Generation

The extension SDK uses the same `typeship` pattern as the desktop app.

```sh
cargo test -p irodori-extension export_typescript_bindings
```

The Rust crate owns the serde/TS contracts for:

- manifest and contribution data;
- permission scopes and permission inspection;
- result-grid columns, rows, selections, and snapshots;
- theme definitions and token color rules;
- SQL dialect definitions, keywords, snippets, and formatter config;
- Wasm/native module capability metadata;
- local development fixtures and logs.

The generated file is committed. In CI, the same test runs in check mode and
fails if the generated SDK types drift from Rust.

## TypeScript SDK

The SDK exposes generated contracts plus host-facing interfaces:

- `commands.registerCommand` and `commands.executeCommand`;
- `keybindings.registerKeybinding`;
- `resultGrid.getActiveSnapshot`, `resultGrid.getSelection`,
  `resultGrid.registerAction`, and `resultGrid.copyText`;
- `themes.registerTheme`;
- `sqlDialects.registerDialect`;
- `permissions.has`, `permissions.require`, and `permissions.inspect`;
- structured extension logging.

Extensions implement:

```ts
import type { ExtensionContext } from "@irodori-table/extension-sdk";

export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.push(
    context.commands.registerCommand("example.hello", async () => {
      context.log.info("hello from an extension");
    }),
  );
}
```

## Local Development

The local dev CLI reads a manifest, inspects declared permissions, loads fake
database fixtures, writes JSON-line logs, and watches declared files for reload
requests.

```sh
node packages/extension-sdk/bin/irodori-extension-dev.mjs packages/extension-sdk/templates/typescript-basic --once
node packages/extension-sdk/bin/irodori-extension-dev.mjs examples/extensions/markdown-result-export
```

The `--once` mode is useful for CI and smoke checks. Without it, the command stays
running and reports reload requests when watched paths change.

## Runtime Safety Rules

- Extensions must declare permissions before using privileged APIs.
- Query text, query results, schema metadata, file access, native code, and Wasm
  modules are sensitive.
- Secrets are never exposed directly; extension APIs should receive handles or
  scoped operations.
- Native modules require platform metadata and should include `sha256` before
  marketplace distribution.
- Wasm modules must declare an ABI string. Current templates use
  `irodori-sql-dialect-v0` while the host ABI is still stabilizing.

## Next Host Work

- Wire manifest validation into the desktop extension loader.
- Implement the real desktop extension host behind the SDK interfaces.
- Add package archive verification and install/uninstall flows.
- Surface logs, reload state, and permission inspection in a developer panel.
- Add runtime validation for extension-provided theme, dialect, and renderer data.
