# Package Manager Templates

These files are submission templates, not ready-to-submit manifests. Replace
every `__PLACEHOLDER__` value after a GitHub Release exists and the artifact
names, sha256 checksums, signatures, and installer behavior are verified.

Canonical public metadata lives in
[store-registration](https://hjosugi.github.io/irodori-docs/store-registration.html).

## Release values to collect

For each published release, collect:

- version without `v`, for example `0.3.0`;
- tag, for example `v0.3.0`;
- per-platform asset URL;
- sha256 for every referenced asset;
- installer type and silent install/uninstall switches for Windows installers;
- minimum OS requirements;
- signed/notarized status.

## Template map

| Channel | Template |
| --- | --- |
| Homebrew cask | `homebrew/irodori-table.rb.template` |
| Scoop | `scoop/irodori-table.json.template` |
| winget | `winget/README.md` and `winget/*.yaml.template` |
| Chocolatey | `chocolatey/irodori-table.nuspec.template` and `chocolatey/tools/chocolateyinstall.ps1.template` |
| AUR | `aur/PKGBUILD.template` |
| Flatpak | `flatpak/dev.irodori.table.yml.template` |
| Snap | `snap/snapcraft.yaml.template` |

Shared Linux metadata templates:

- `../linux/dev.irodori.table.desktop.template`
- `../appstream/dev.irodori.table.metainfo.xml.template`

## Validation

Run channel-specific validators before opening submissions. Do not submit a
manifest that points at a draft release or placeholder checksum.
