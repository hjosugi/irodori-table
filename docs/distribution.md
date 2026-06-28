# Distribution & updates

How users get Irodori Table and how it updates. Current version: **0.3.0**.

## Already in place

`.github/workflows/release.yml` — on a `v*` tag push, `tauri-action` builds
installers for **macOS** (`.dmg`/`.app`), **Windows** (`.msi`/NSIS), and **Linux**
(`.deb`/`.AppImage`) on the matrix runners and creates a (draft) GitHub Release.
So the download channel is live today: just push a `v0.3.0` tag.

## Channel matrix

| Channel | For | Status | Notes |
| --- | --- | --- | --- |
| GitHub Releases (installers) | end users | ✅ exists | `release.yml`; cut by tagging `v0.3.0` |
| Tauri in-app updater | end users (auto-update) | ⬜ next | the fastest *update* path for the GUI; needs a signing key |
| `cargo install --git` | Rust devs (headless `irodori-server`/CLI) | ⬜ blocked | unblocked by removing the dev `[patch]` (cut `irodori-sql` v0.2.24) |
| crates.io | Rust devs | ⬜ later | crates.io forbids git/path deps; all `irodori-*` must be published first |
| Homebrew cask / Scoop / winget | mac/Windows | ⬜ later | manifests auto-bumped from releases |
| AUR / Flatpak | Linux | ⬜ later | from releases |

## On "cargo is fastest"

Half-right: `cargo install` only installs **Rust binaries**, so it's a great, fast
channel for the headless **`irodori-server`** (and any CLI) — but **not** for the
desktop app, which bundles a webview + a built frontend (`cargo install` can't
produce that; use installers/updater instead).

And it's currently **blocked**: the workspace has a development
`[patch."https://github.com/hjosugi/irodori-sql"] → path = "../irodori-sql"`, so
`cargo install --git` would fail (that sibling path doesn't exist for a remote
install). Prerequisite to unblock (also a 1.0 item):

1. Commit + tag the sibling `irodori-sql` repo as `v0.2.24` and push the tag.
2. Point the workspace dep at `tag = "v0.2.24"` and delete the `[patch]`.
3. Then: `cargo install --git https://github.com/hjosugi/irodori-table irodori-server`.

## Recommended order

1. **Tag `v0.3.0`** → installers ship immediately (channel already built).
2. **Tauri updater** for in-app auto-update (the real "get updates" for the GUI):
   - `cd apps/desktop && npm run tauri signer generate` → keypair.
   - Add the private key as the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret.
   - In `tauri.conf.json`: set `bundle.createUpdaterArtifacts = true` and
     `plugins.updater` with the public key + an `endpoints` entry pointing at the
     releases `latest.json` (tauri-action emits it per release).
3. **Unblock cargo** for the headless binary (the v0.2.24 + drop-patch steps above).
4. **Package managers** (brew/scoop/winget/AUR/Flatpak) once you want them — each
   is a small manifest auto-updated from the GitHub Release assets.
