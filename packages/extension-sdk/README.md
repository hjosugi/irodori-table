# Irodori Extension SDK

This package is the TypeScript SDK surface for Irodori Table extensions.

The generated types in `src/generated/irodori-extension-api.ts` come from the
`irodori-extension` crate (in the sibling `irodori-kit` repo) through the same
`typeship` flow used by the desktop app.

## Manifest

Extensions use `irodori.extension.json`:

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
  "permissions": ["commands", "queryResults:read"]
}
```

## Local development

```sh
node packages/extension-sdk/bin/irodori-extension-dev.mjs packages/extension-sdk/templates/typescript-basic --once
node packages/extension-sdk/bin/irodori-extension-dev.mjs packages/extension-sdk/templates/typescript-basic
```

The dev command reads `irodori.extension.json`, inspects permissions, loads fake
database fixtures declared in `dev.fixtures`, writes logs, and watches declared
paths for reload requests.

## Type generation

```sh
cargo test -p irodori-extension export_typescript_bindings
```

CI runs the same test in check mode.
