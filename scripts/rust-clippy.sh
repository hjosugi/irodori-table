#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Keep the CI gate useful while existing command-entrypoint/runtime cleanup stays
# with the owning Rust workstreams. New warning classes still fail the build.
exec cargo clippy --manifest-path "$root/Cargo.toml" --workspace --all-targets -- \
  -D warnings \
  -A clippy::too-many-arguments \
  -A clippy::io-other-error \
  -A clippy::match-like-matches-macro \
  -A clippy::redundant-pattern-matching \
  -A clippy::obfuscated-if-else
