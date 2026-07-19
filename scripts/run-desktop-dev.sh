#!/usr/bin/env bash
# Launch `tauri dev` with a GPU stack the WebView can actually use.
#
# The Nix dev shell provides WebKitGTK from the Nix store, but the GL/EGL
# drivers on a non-NixOS host live in /usr/lib and are not ABI-compatible with
# it. WebKit then fails at EGL display creation and the process aborts before a
# window appears:
#
#   Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
#
# nixGL supplies matching drivers and exports LD_LIBRARY_PATH, which child
# processes inherit — so wrapping the parent covers the WebView that `tauri dev`
# spawns. Everything here is a no-op outside that specific situation: on NixOS,
# outside the Nix shell, or when the caller opts out.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${JS_PM:=npm}"

if [[ "${JS_PM}" == "bun" ]]; then
  dev_cmd=(bun --cwd="${root}/apps/desktop" run tauri dev)
else
  dev_cmd=(npm --prefix "${root}/apps/desktop" run tauri dev)
fi

needs_nixgl() {
  [[ -n "${IRODORI_NO_NIXGL:-}" ]] && return 1
  # NixOS already has a matching driver stack.
  [[ -e /etc/NIXOS ]] && return 1
  # Only meaningful when the toolchain itself came from the Nix store.
  command -v cargo >/dev/null 2>&1 || return 1
  [[ "$(command -v cargo)" == /nix/store/* ]] || return 1
  command -v nix >/dev/null 2>&1 || return 1
  return 0
}

if needs_nixgl; then
  echo "Launching through nixGL (Nix WebKit needs a matching GL driver)."
  echo "Set IRODORI_NO_NIXGL=1 to skip this."
  # --impure is required: nixGL inspects the host's driver version at eval time.
  exec nix run --impure github:nix-community/nixGL -- "${dev_cmd[@]}"
fi

exec "${dev_cmd[@]}"
