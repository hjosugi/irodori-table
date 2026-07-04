#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v cargo-deny >/dev/null 2>&1; then
  echo "cargo-deny is not installed; install it with: cargo install cargo-deny --locked --version 0.19.9" >&2
  exit 127
fi

exec cargo deny \
  --manifest-path "$root/Cargo.toml" \
  --workspace \
  --locked \
  check advisories licenses sources
