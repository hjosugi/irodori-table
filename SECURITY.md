# Security Policy

## Reporting A Vulnerability

Do not open a public issue for a suspected vulnerability.

Report privately via GitHub private vulnerability reporting:
<https://github.com/hjosugi/irodori-table/security/advisories/new>.

Include in the report:

- affected version, commit, or release artifact;
- a minimal reproduction or exploit sketch;
- impact and data exposure assumptions;
- whether the report includes third-party dependency or build-system behavior.

If GitHub advisories are unavailable to you, open a public issue with only a
high-level statement that a private security report is needed. Do not include
proof-of-concept payloads, credentials, customer data, or exploit details in the
issue.

## Supported Versions

Irodori Table is pre-1.0. Security fixes target `main` first. Release backports
are best-effort until stable release channels exist.

## Security Scope

Security-sensitive areas include:

- database credentials, connection profiles, and secret persistence;
- query execution, cancellation, result streaming, import/export, and local file
  writes;
- extension SDK behavior and any future plugin execution path;
- desktop release packaging, updater/signing, and generated bindings;
- dependency, build, and CI configuration.

## Baseline Checks

Run these before releasing or merging dependency changes:

```sh
make security
make security-strict
make check
```

The security target verifies project license metadata, locked dependency
resolution, npm advisories, npm registry signatures, and RustSec advisories when
`cargo-audit` is installed. The strict target requires local RustSec coverage.
