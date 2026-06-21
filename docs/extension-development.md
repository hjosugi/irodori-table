# Extension Development

Irodori Table should be easy to extend without learning the internals of the desktop app. The extension system is a first-class product surface, not an afterthought.

## Goals

- Let users add drivers, commands, themes, formatters, result renderers, AI providers, proxy transports, and panels.
- Make TypeScript extensions the easiest path, with Rust/Wasm available for high-performance pieces.
- Keep APIs small, documented, versioned, and stable.
- Support local development with fast reload and useful logs.
- Use capability-scoped permissions so extensions can ask for only what they need.
- Let extension authors choose their own license.

## Extension Manifest Draft

The initial schema lives at [`extension.schema.json`](../extension.schema.json).

```json
{
  "id": "example.quick-export",
  "name": "Quick Export",
  "version": "0.1.0",
  "license": "MIT OR 0BSD",
  "entry": "dist/main.js",
  "permissions": ["commands", "queryResults:read", "files:write"],
  "contributes": {
    "commands": [
      {
        "id": "quickExport.copyAsMarkdown",
        "title": "Copy Result as Markdown Table"
      }
    ],
    "keybindings": [
      {
        "command": "quickExport.copyAsMarkdown",
        "key": "cmd+shift+m",
        "when": "resultGridFocus"
      }
    ]
  }
}
```

## API Surfaces

- Commands: register command IDs, keybindings, command palette entries, and context menu actions.
- Database drivers: add engines behind the same connection/query/introspection traits as built-in drivers.
- SQL dialects: provide keywords, parser metadata, formatter hooks, snippets, completion enrichers, and explain-plan adapters.
- Result renderers: add grid actions, custom cell renderers, export formats, and side-by-side diff views.
- Themes: import or provide workbench colors, editor token colors, semantic colors, and icon mappings.
- Proxy transports: add connection hops such as SSH variants, cloud tunnels, or custom enterprise proxies.
- Panels: add side panels, bottom panels, inspectors, and object-browser actions.
- AI providers: add opt-in local or remote assistance with explicit privacy disclosure.

## Developer Experience

- `irodori extension init` scaffolds a `MIT OR 0BSD` TypeScript extension.
- `irodori extension dev` runs an extension in a watched local workspace.
- Extensions get typed APIs, example tests, and a fake database harness.
- Logs and permission prompts are visible from a developer panel.
- Extension packages should be simple zip/tar archives with manifest, code, assets, and license.

## Safety Rules

- Extensions must declare permissions before calling privileged APIs.
- Secrets are never exposed directly; extensions receive handles or scoped operations.
- Query text, result data, and schema metadata are considered sensitive and require explicit permission.
- Native binaries and Wasm modules need clear platform and license metadata.
