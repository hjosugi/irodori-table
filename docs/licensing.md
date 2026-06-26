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
- Reference repositories under `.irodori-local/ref/` are not part of Irodori Table and keep their original licenses.
- GPL/AGPL code can be studied, but it must not be copied into the permissive core unless the project intentionally creates a separate license boundary.
- Commercial or proprietary reference code is off-limits unless we have explicit rights.
- Third-party adapted code keeps its original obligations; the `MIT OR 0BSD` choice applies to Irodori-authored code.

## Default Policy

- New Irodori-authored code: `MIT OR 0BSD`.
- Official examples and extension templates: `MIT OR 0BSD`.
- Third-party copied/adapted code: avoid when possible; when used, record the source, license, and attribution requirements.
- Core app, extension API, and SDK packages should remain permissive enough that downstream users can build anything on top.

## Compatibility Classes

- Allowed by default: `MIT`, `0BSD`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `Apache-2.0`, `Unlicense`, `CC0-1.0`, and similarly permissive licenses.
- Allowed with asset-specific review: `MPL-2.0`, `EPL-2.0`, `CDDL`, Creative Commons attribution licenses, and font licenses such as `OFL-1.1`.
- Dependency-only review required: native drivers, parser generators, grammar packages, crypto/TLS libraries, and packages that bundle binary artifacts.
- Blocked for the permissive core unless an explicit separate license boundary is approved: `GPL`, `LGPL`, `AGPL`, commercial-only terms, source-available licenses that restrict use or competition, no-license code, and unclear provenance.

## Asset Rules

| Asset type | Allowed | Needs review | Blocked in the permissive core |
| --- | --- | --- | --- |
| Rust crates and npm packages | Permissive licenses listed above, declared in package metadata | Dual-licensed packages, native/binary packages, unusual patent terms | GPL/AGPL/copyleft packages that would affect the core distribution |
| Official extension templates and examples | Irodori-authored `MIT OR 0BSD` | Third-party sample code with attribution | Code copied from incompatible products or commercial examples |
| Themes | Original themes or permissive VS Code themes with attribution | Marketplace themes with mixed assets or unclear bundled licenses | Proprietary themes, copied product themes, GPL/AGPL themes for bundled distribution |
| Snippets and query templates | Original snippets, public-domain examples, permissive examples with attribution | Vendor docs examples when terms are unclear | Copied paid-course, book, commercial-product, or incompatible OSS snippets |
| Icons, images, and logos | Original assets, permissive icon sets, project-owned marks | CC-BY assets with required attribution, trademarked database logos used only as nominative references | Competitor icons, proprietary screenshots, unlicensed web images |
| Fonts | System fonts, `OFL-1.1`, permissive fonts | Font licenses with embedding or naming restrictions | Commercial fonts without redistribution rights |
| Tree-sitter grammars and language data | Permissive grammars with recorded license | Mixed-license grammars or generated artifacts | GPL/AGPL grammars bundled into the core |
| Database drivers and native clients | Permissive pure-Rust or clearly redistributable drivers | Vendor clients with platform packaging terms | Drivers or SDKs that forbid redistribution, competition, or reverse engineering |
| Sample data and fixtures | Original data, synthetic data, public-domain datasets | Public datasets with attribution/share requirements | Production data, personal data, unclear-license dumps |

When in doubt, do not vendor or copy the asset. Link the public source, record
the license question in the PR, and implement the Irodori behavior independently.
