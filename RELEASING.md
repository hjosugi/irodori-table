# Releasing

This repo ships the desktop app. Shared foundation crates and templates are
released from sibling repositories first, then consumed here by git tag.

## Preconditions

- `git status --short` is clean except for intentional release edits.
- `make kit-patch-check` passes; local `irodori-kit` patches must not ship.
- `irodori-kit`, `irodori-sql`, and `irodori-knowledge` tags referenced in
  `Cargo.toml` exist and contain the intended release code.
- If extension SDK APIs changed, `irodori-kit/packages/extension-sdk` has been
  regenerated, validated, tagged, and its template/catalog effects are reflected
  here through source data or generators.
- Generated bindings and generated registry/docs snapshots are current.

## Local Verification

Run the narrowest loop while preparing a change, then run the release gate:

```sh
make doctor
make desktop-format-check
make desktop-lint
make desktop-typegen-check
make desktop-test
cargo test --workspace
make docs-check
make security
make desktop-build-verified
```

For browser-facing changes, also run:

```sh
cd apps/desktop
npx playwright install --with-deps chromium
cd ../..
make desktop-e2e
```

## Version Bump

Use the repo-root release targets. They delegate to
`apps/desktop/tools/release.mjs` and update the desktop package, Tauri config,
Cargo manifests, lockfiles, commit, tag, and push.

```sh
make release-patch
make release-minor
make release-major
```

Before running a release target, update any sibling git tags in `Cargo.toml`
explicitly and verify the lockfile diff is intentional.

## Cross-Repo Tag Order

Cut dependency repos before `irodori-table`, then repoint this repo to those
immutable tags:

1. `irodori-sql` - SQL dialect, parameter, schema, and migration SQL helpers.
2. `irodori-knowledge` - shared error, job, and knowledge-store primitives.
3. `irodori-kit` - app foundation crates, completion/generation, extension SDK,
   and packaging templates. If kit consumes new SQL or knowledge behavior, bump
   those tags in kit before tagging kit.
4. `irodori-table` - update `[workspace.dependencies]` in `Cargo.toml`, run
   `cargo update`, verify generated bindings and docs, then run the appropriate
   `make release-*` target.

For each sibling repo, update its changelog or release notes before tagging.
For `irodori-table`, mention the consumed sibling tags in the release notes when
they affect runtime behavior, extension SDK compatibility, or generated
bindings.

## GitHub Release

1. Push the release commit and tag created by the release target.
2. Watch the release workflow in GitHub Actions.
3. The tag workflow publishes a lightweight Linux pre-release with AppImage,
   deb, and rpm packages and default features only. When explicitly requested,
   manually dispatch the `preview` channel for the same tag to append unsigned
   universal macOS app/dmg packages and Windows NSIS/MSI installers. Select
   `windows_signing=signpath` to replace the Windows assets with SignPath-signed
   installers. Updater artifacts remain exclusive to the signed stable lane.
   DuckDB is distributed through its installable connector extension instead
   of the core desktop build.
4. Confirm the packages match the lightweight connector feature set. Do not
   present unsigned macOS preview packages as signed/notarized stable builds.
5. Compare `registry/data-source-support-status.md` against shipped build
   behavior before publishing user-facing notes.
6. Publish release notes that separate app changes from sibling-crate and
   extension SDK changes.

## Signing, Notarization, And Updates

The default tag workflow is intentionally unsigned and marked as a pre-release.
It publishes Linux AppImage, deb, and rpm packages, but it must not be used as
the stable updater channel. The updater plugin is compiled into the desktop
shell only when the `updater` Cargo feature is explicitly enabled by the stable
release workflow.

The release workflow also has two manual `workflow_dispatch` channels. The
`preview` channel appends unsigned macOS and Windows artifacts to an existing
lightweight tag release by default. Selecting `windows_signing=signpath` keeps
macOS unsigned but replaces the Windows NSIS/MSI assets with SignPath-signed
installers. It leaves the release marked as a pre-release, does not generate
`latest.json`, and does not publish to the stable updater channel; unsigned
artifacts may trigger operating-system trust warnings. The preview lanes stay
serialized (macOS, then Windows) to avoid concurrent uploads to the same
release, but a failed macOS build does not skip the Windows lane.

The `stable` channel is the only one that publishes as a full release rather
than a pre-release, so it is what GitHub surfaces as **Latest** on the
repository home page. It builds the complete Linux + universal macOS + Windows
set and, when the corresponding secrets are configured, generates the ignored
`src-tauri/tauri.updater.conf.json` config through
`npm run release:prepare-updater`, signs Tauri updater artifacts, publishes
`latest.json` for the stable update channel, and signs/notarizes the macOS and
Windows artifacts.

Signing is **best-effort, not required**. Each lane detects its own secrets and
turns itself off when they are absent, so a stable release still ships all
three platforms — unsigned — instead of failing the dispatch:

| Missing secrets | Effect |
| --- | --- |
| `TAURI_UPDATER_PUBLIC_KEY` / `TAURI_SIGNING_PRIVATE_KEY` | Updater artifacts and `latest.json` are omitted; the updater manifest check is skipped. Users must reinstall to upgrade. |
| Apple certificate or notarization credentials | macOS packages ship unsigned and may trigger Gatekeeper warnings. |
| The selected `windows_signing` backend's secrets | Windows installers ship unsigned and may trigger SmartScreen warnings. |

Each degraded lane emits a `::warning::` in the run log and the generated
release notes state exactly which artifacts are unsigned. Configure these
GitHub Actions secrets to get a fully signed stable release:

### Windows signing backend

The stable channel signs Windows artifacts with one of three backends, selected
by the `windows_signing` dispatch input (default `pfx`). The preview channel is
unsigned by default but also supports `windows_signing=signpath` without the
stable updater or Apple signing credentials:

- **`pfx`** — a code-signing `.pfx` certificate you hold. `prepare-windows-signing.mjs`
  imports it into the runner's certificate store and points Tauri's
  `certificateThumbprint` at it. Requires the `WINDOWS_CERTIFICATE*` secrets
  below. A self-signed certificate signs the file but is not trusted on other
  machines, so it does not clear SmartScreen; use a CA-issued certificate.
- **`azure`** — [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/).
  No certificate file is stored: the Windows lane installs
  [`trusted-signing-cli`](https://crates.io/crates/trusted-signing-cli) and
  `prepare-windows-azure-signing.mjs` writes a Tauri `signCommand` that signs
  each artifact through your Trusted Signing account. `trusted-signing-cli`
  authenticates with the `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` /
  `AZURE_CLIENT_SECRET` service-principal secrets and timestamps through the
  service. Certificates are managed by Azure and chain to a Microsoft root, so
  signed builds are trusted (SmartScreen reputation still builds over time).
  Requires the `AZURE_*` secrets below.
- **`signpath`** — [SignPath](https://signpath.io/), whose
  [Foundation](https://signpath.org/) program signs open-source releases for
  **free**. SignPath is a cloud signing service rather than a local signtool, so
  the Windows lane publishes the unsigned installers as usual, then downloads
  the `.exe`/`.msi`, submits them through the
  [`SignPath/github-action-submit-signing-request`](https://github.com/SignPath/github-action-submit-signing-request)
  action, and replaces the release assets with the signed versions. No
  certificate is held locally. The workflow grants the action read access to
  GitHub Actions artifacts for provenance verification. It verifies the
  returned Authenticode signatures before replacement, downloads the published
  assets and verifies them again, and removes the Windows release assets if
  signing or verification fails. Requires the `SIGNPATH_*` secrets below.
  **Limitation:** the auto-updater payload (`.nsis.zip`) is built before this
  post-publish signing step, so it is not code-signed by SignPath — use `pfx`
  or `azure` (build-time signing) if you need signed updater payloads.

  To enable it: apply to the SignPath Foundation with the project's public
  GitHub repository, then in the SignPath dashboard create a project, an
  artifact configuration with a root `<zip-file>` containing one NSIS `.exe`
  and one MSI package, and a signing policy, and issue a CI API token. Enforce
  the Irodori Table product name and matching version with file metadata
  restrictions. Install the SignPath GitHub App, link the predefined GitHub.com
  trusted build system, and feed the values into the `SIGNPATH_*` secrets
  below. Foundation signing requests require manual approval.

All backends are inert unless the matching dispatch option and secrets are
present. Lightweight releases remain unsigned, and preview releases use
SignPath only when explicitly selected.

The repository home page contains the Foundation-required
[code signing policy](README.md#code-signing-policy). Keep its team roles and
privacy statement current when project ownership or network behavior changes.

Configure the updater secrets before dispatching a stable release:

| Secret | Used by | Notes |
| --- | --- | --- |
| `TAURI_UPDATER_PUBLIC_KEY` | updater config | Public key generated by `npm run tauri signer generate -- -w <path>`. This is embedded in release builds. |
| `TAURI_SIGNING_PRIVATE_KEY` | updater artifact signing | Private key content or path for Tauri updater signatures. Keep this stable across releases. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater artifact signing | Optional; required only if the updater private key was generated with a password. |

The updater endpoint is
`https://github.com/hjosugi/irodori-table/releases/latest/download/latest.json`.
Override it only for a deliberate channel split by setting the
`IRODORI_UPDATER_ENDPOINT` repository variable. Draft releases are not visible
to the updater; publish the GitHub Release only after the artifacts and
generated `latest.json` have been reviewed.

The stable workflow signs the Windows and macOS lanes when the platform secrets
below are present, and publishes them unsigned when they are not. The default
tag workflow stays on the lightweight Linux package lane, so missing platform
credentials block neither prerelease checkpoints nor stable releases.

| Secret | Used by | Notes |
| --- | --- | --- |
| `WINDOWS_CERTIFICATE` | Windows signing (`pfx`) | Base64-encoded `.pfx` certificate. |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows signing (`pfx`) | Export password for the `.pfx`. |
| `WINDOWS_CERTIFICATE_THUMBPRINT` | Windows signing (`pfx`) | SHA-1 certificate thumbprint without spaces. |
| `WINDOWS_TIMESTAMP_URL` | Windows signing (`pfx`) | Optional; defaults to DigiCert timestamping when unset. |
| `AZURE_TENANT_ID` | Windows signing (`azure`) | Entra tenant ID of the Trusted Signing service principal. |
| `AZURE_CLIENT_ID` | Windows signing (`azure`) | App registration (service principal) client ID with the Trusted Signing Certificate Profile Signer role. |
| `AZURE_CLIENT_SECRET` | Windows signing (`azure`) | Client secret for that service principal. |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | Windows signing (`azure`) | Region endpoint, e.g. `https://eus.codesigning.azure.net/`. |
| `AZURE_TRUSTED_SIGNING_ACCOUNT` | Windows signing (`azure`) | Trusted Signing account name. |
| `AZURE_TRUSTED_SIGNING_PROFILE` | Windows signing (`azure`) | Certificate profile name under that account. |
| `SIGNPATH_API_TOKEN` | Windows signing (`signpath`) | SignPath CI user API token. |
| `SIGNPATH_ORGANIZATION_ID` | Windows signing (`signpath`) | SignPath organization ID (GUID). |
| `SIGNPATH_PROJECT_SLUG` | Windows signing (`signpath`) | SignPath project slug for this repo. |
| `SIGNPATH_SIGNING_POLICY_SLUG` | Windows signing (`signpath`) | Signing policy slug (e.g. `release-signing`). |
| `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | Windows signing (`signpath`) | Artifact configuration that signs the root NSIS and MSI files. |
| `APPLE_CERTIFICATE` | macOS signing | Base64-encoded `.p12` Developer ID Application certificate. |
| `APPLE_CERTIFICATE_PASSWORD` | macOS signing | Export password for the `.p12`. |
| `APPLE_SIGNING_IDENTITY` | macOS signing | Optional; discovered from the imported certificate when unset. |
| `APPLE_API_ISSUER` | macOS notarization | App Store Connect API Issuer ID. |
| `APPLE_API_KEY` | macOS notarization | App Store Connect API Key ID. |
| `APPLE_API_KEY_P8` | macOS notarization | Raw or base64-encoded App Store Connect `.p8` private key. |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | macOS notarization | Alternative notarization path if App Store Connect API secrets are not used. |

## Rollback

If a release artifact is wrong, do not retag over a published tag. Mark the
release as withdrawn, fix forward on a new patch version, and document the
artifact issue in the replacement release notes.
