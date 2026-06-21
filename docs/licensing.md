# Licensing

Irodori Table's own code is dual-licensed under `MIT OR 0BSD`.

The intent is simple: anyone can use, copy, fork, sell, rewrite, embed, or compete with Irodori Table without asking for permission. Users can choose the familiar MIT license or the almost-no-conditions 0BSD license.

## Why Dual License

- MIT is familiar to companies, package managers, and open-source contributors.
- 0BSD preserves the project's "fully free to copy" goal.
- Both avoid copyleft obligations for downstream users.
- The SPDX expression `MIT OR 0BSD` works well for npm and Cargo metadata.
- Official extension examples and templates can be reused under either path.

## What This Does Not Mean

- Dependencies keep their own licenses.
- Extensions keep their own licenses unless their author chooses `MIT OR 0BSD`.
- Reference repositories under `ref/` are not part of Irodori Table and keep their original licenses.
- GPL/AGPL code can be studied, but it must not be copied into the permissive core unless the project intentionally creates a separate license boundary.
- Commercial or proprietary reference code is off-limits unless we have explicit rights.
- Third-party adapted code keeps its original obligations; the `MIT OR 0BSD` choice applies to Irodori-authored code.

## Default Policy

- New Irodori-authored code: `MIT OR 0BSD`.
- Official examples and extension templates: `MIT OR 0BSD`.
- Third-party copied/adapted code: avoid when possible; when used, record the source, license, and attribution requirements.
- Core app, extension API, and SDK packages should remain permissive enough that downstream users can build anything on top.
