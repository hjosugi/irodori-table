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
| `cargo install --git` | Rust devs (headless `irodori-server`/CLI) | ✅ unblocked | `irodori-sql` is now a tagged dep (`v0.2.24`); no dev `[patch]` remains |
| crates.io | Rust devs | ⬜ later | crates.io forbids git/path deps; all `irodori-*` must be published first |
| Homebrew cask / Scoop / winget | mac/Windows | ⬜ later | manifests auto-bumped from releases |
| AUR / Flatpak | Linux | ⬜ later | from releases |

## On "cargo is fastest"

Half-right: `cargo install` only installs **Rust binaries**, so it's a great, fast
channel for the headless **`irodori-server`** (and any CLI) — but **not** for the
desktop app, which bundles a webview + a built frontend (`cargo install` can't
produce that; use installers/updater instead).

This is now **unblocked**. The workspace previously carried a development
`[patch]` redirecting `irodori-sql` to a local sibling path, which made a remote
`cargo install --git` fail. That patch is gone — the workspace consumes
`irodori-sql` from the `v0.2.24` Git tag — so the headless binary installs with:

```
cargo install --git https://github.com/hjosugi/irodori-table irodori-server
```

(How it got here: `irodori-sql` was bumped to `0.2.24`, tagged `v0.2.24`, and
pushed; the workspace dep was repointed from `rev = …` to `tag = "v0.2.24"`.)

## Recommended order

1. **Tag `v0.3.0`** → installers ship immediately (channel already built).
2. **Tauri updater** for in-app auto-update (the real "get updates" for the GUI):
   - `cd apps/desktop && npm run tauri signer generate` → keypair.
   - Add the private key as the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret.
   - In `tauri.conf.json`: set `bundle.createUpdaterArtifacts = true` and
     `plugins.updater` with the public key + an `endpoints` entry pointing at the
     releases `latest.json` (tauri-action emits it per release).
3. ~~**Unblock cargo**~~ — ✅ done (`irodori-sql v0.2.24` tagged + workspace
   repointed). `cargo install --git … irodori-server` works today.
4. **Package managers** (brew/scoop/winget/AUR/Flatpak) once you want them — each
   is a small manifest auto-updated from the GitHub Release assets.
