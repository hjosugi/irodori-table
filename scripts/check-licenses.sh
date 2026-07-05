#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
missing=0

while IFS= read -r manifest; do
  if grep -Eq '^[[:space:]]*license[[:space:]]*=[[:space:]]*"0BSD"' "$manifest"; then
    continue
  fi

  if grep -Eq '^[[:space:]]*license\.workspace[[:space:]]*=[[:space:]]*true' "$manifest"; then
    continue
  fi

  echo "missing 0BSD license field: ${manifest#$root/}" >&2
  missing=1
done < <(
  find "$root" \
    \( \
      -path "$root/.git" -o \
      -path "$root/.cache" -o \
      -path "$root/.irodori-dev" -o \
      -path "$root/.irodori-local" -o \
      -path "$root/.local" -o \
      -path "$root/apps/desktop/node_modules" -o \
      -path "$root/apps/desktop/src-tauri/target" -o \
      -path "$root/node_modules" -o \
      -path "$root/ref" -o \
      -path "$root/target" \
    \) -prune -o \
    -name Cargo.toml -print
)

if [[ -f "$root/apps/desktop/package.json" ]]; then
  if ! grep -Eq '"license"[[:space:]]*:[[:space:]]*"0BSD"' "$root/apps/desktop/package.json"; then
    echo "missing 0BSD license field: apps/desktop/package.json" >&2
    missing=1
  fi
fi

exit "$missing"
