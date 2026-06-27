#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
npm_audit_level="${NPM_AUDIT_LEVEL:-high}"
npm_dirs=(
  "apps/desktop"
)

step() {
  printf "\n==> %s\n" "$*"
}

step "license metadata"
"$root/scripts/check-licenses.sh"

step "dependency review policy"
node "$root/scripts/dependency-review.mjs"

step "Cargo lockfile consistency"
cargo metadata --locked --format-version 1 >/dev/null

for dir in "${npm_dirs[@]}"; do
  if [[ ! -f "$root/$dir/package-lock.json" ]]; then
    continue
  fi

  step "npm advisory audit: $dir"
  npm --prefix "$root/$dir" audit \
    --audit-level "$npm_audit_level" \
    --package-lock-only

  step "npm registry signature verification: $dir"
  signature_output="$(
    npm --prefix "$root/$dir" audit signatures \
      --package-lock-only 2>&1
  )" || {
    if grep -q "found no dependencies to audit that were installed from a supported registry" <<<"$signature_output"; then
      printf '%s\n' "$signature_output"
      echo "npm registry signature verification skipped: no supported registry-installed dependencies"
    else
      printf '%s\n' "$signature_output" >&2
      exit 1
    fi
  }
  if [[ -n "${signature_output:-}" ]]; then
    printf '%s\n' "$signature_output"
  fi
done

step "RustSec advisory audit"
if command -v cargo-audit >/dev/null 2>&1; then
  audit_args=(--deny warnings)
  rustsec_ignore_file="$root/tools/security/rustsec-audit-ignore.txt"
  if [[ -f "$rustsec_ignore_file" ]]; then
    while read -r advisory _; do
      if [[ -z "${advisory:-}" || "$advisory" == \#* ]]; then
        continue
      fi
      audit_args+=(--ignore "$advisory")
    done < "$rustsec_ignore_file"
  fi
  cargo audit "${audit_args[@]}"
else
  echo "cargo-audit is not installed; install it with: cargo install cargo-audit --locked" >&2
  if [[ "${REQUIRE_CARGO_AUDIT:-0}" == "1" ]]; then
    exit 1
  fi
fi
