# Sample Pull Request

## Summary

- Add dialect-aware identifier quoting for generated edit statements.
- Keep statement generation independent and covered by unit tests.

## Verification

- `cargo test -p irodori-table-desktop edit::tests`
- `scripts/check-licenses.sh`

## Clean-Room And Licensing Checklist

- [x] I read and followed `docs/clean-room.md`.
- [x] This change is written from Irodori requirements, public specifications,
      vendor documentation, or license-compatible OSS with required attribution.
- [x] I did not copy proprietary, commercial-only, GPL/AGPL, source-available,
      or unclear-license code, assets, strings, snippets, icons, theme files, or
      exact UI expression into the permissive core.
- [x] Public references that influenced behavior are linked in the PR.
- [x] OSS code-level references, if any, are linked with their license and
      adaptation boundary.
- [x] Any new dependency, asset, grammar, driver, sample, or template follows
      `docs/licensing.md`.
- [x] Any new Rust crate declares `license = "MIT OR 0BSD"` or
      `license.workspace = true`.
- [x] Tests assert Irodori behavior rather than another product's private
      behavior.

References:

- PostgreSQL documentation for quoted identifiers.
- MySQL documentation for identifier quote syntax.

