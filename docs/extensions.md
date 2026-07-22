# Extensions

Extensions are downloaded from pinned GitHub releases and checksum-verified.
Two production runtimes are supported:

- **native** connector extensions load a database driver into the app process;
- **declarative** feature extensions activate a named, trusted feature compiled
  into the desktop host. Downloaded declarative packages do not execute code in
  the application webview.

Knowledge and Datalake are distributed as declarative feature extensions.

Open **Settings ▸ Extensions** — from **Tools ▸ Open Extensions**, from the
command palette as **Open Extensions**, or from the Settings dialog (`Mod+,`).

## The tab

Three sections:

- **Installed** — what is on this device, with **Enabled** / **Disabled** state,
  the verified digest as **SHA-256 {digest}…**, and either the connector engine
  and ABI version or the activated host feature.
- **Marketplace** — everything in the catalog, filtered by **Search Extensions
  in Marketplace** (matches name, id, publisher, summary, engines, categories,
  and topics).
- **Recommended** — a short curated list.

The header shows **Marketplace source: {source}** and **Platform: {target}**,
where target is the architecture and OS pair the app resolved for itself. A
standing warning reads:

> Native extensions run with this app's process privileges; declarative
> extensions only activate trusted built-in features. Install verified releases
> and review permissions.

Treat installing a native extension as running third-party native code.

## Installing

The action button reflects state: **Install**, **Update** when the catalog has a
newer version, **Installed** when current, **Unavailable** when there is no
release asset for your platform, and **Working…** while busy.

Confirming **Install {name}?** shows the version and the exact permission set
being granted, then:

1. The archive is downloaded from the pinned GitHub release.
2. Its SHA-256 is compared against the catalog digest; a mismatch aborts.
3. The manifest is validated — id, version, and permissions must match what you
   approved exactly.
4. A native extension must contribute exactly one connector. Its library's
   embedded manifest must byte-match the archive manifest, its ABI version must
   be supported, and a health probe must return OK.
5. A declarative extension must contribute exactly one supported host feature,
   declare `hostFeatures`, and contain its declared data entry. No downloaded
   executable code is loaded.

Only then is it moved into place. Archives are capped at 512 MiB and are
rejected if any entry uses an absolute path or `..`.

Extensions install under the app data directory:

- Linux: `~/.local/share/dev.irodori.table/extensions/`
- macOS: `~/Library/Application Support/dev.irodori.table/extensions/`
- Windows: `%APPDATA%\dev.irodori.table\extensions\`

with one directory per id and version, and a registry at `installed.json`.

## Enabling, disabling, removing

- **Disable** flips a flag in the registry; the files stay on disk. A connector
  stops being offered to connections, while a feature's panel and commands are
  removed immediately.
- **Enable** turns it back on.
- **Uninstall** confirms with **Uninstall {name}?** and deletes the extension's
  directory.

Only enabled extensions contribute connectors or features. On restart, the
registry restores the same enabled state.

## The catalog

The marketplace list is fetched from the project registry on GitHub each time the
tab opens. If that fetch fails, the app falls back to a catalog bundled with the
build and shows the error inline — so the tab still works offline, just with a
snapshot from release time.

**Refresh extension store** re-fetches. **Open store index** and **Open release**
open the corresponding pages in a browser.

## Installing a lakehouse connector

This is the common case and it has its own walkthrough, including what the
connection form looks like afterwards: [Lakehouse
connections](lakehouse.md).

Short version: search the marketplace for the engine name, **Install**, confirm,
then create the connection. Note that of the lakehouse connectors only DuckDB
appears under **Recommended** — Iceberg, Delta Lake, Hudi, Hive, Athena, S3
Tables, Databricks, and MotherDuck are found by searching the marketplace.

## Gaps

- **No install from a local file.** GitHub releases are the only source; there
  is no offline or air-gapped install path.
- **The `verified` flag is not shown or enforced.** The standing warning tells
  you to install only verified releases, but the UI gives no way to distinguish
  them. The digest prefix on installed rows is the only trust signal surfaced.
- **The connect-time error does not link here.** When a connection fails for a
  missing connector, the message says to install it from Extensions but offers
  no button to get there.
- **Uninstall removes every installed version** of that extension, not just the
  selected one.
- **Rich connector catalog metadata is parsed and discarded.** Connectors declare
  source-type contracts — catalog browsing, table-format metadata,
  execution-backend selection, query templates — and nothing in the app reads
  them. The Lakehouse panel ships its own hardcoded snippets rather than the
  templates a connector declares.
- **No extension settings, no per-extension configuration**, and no way to pin
  or roll back to a specific version from the UI.
