# Repo-root entry points. The release logic lives in
# apps/desktop/tools/release.mjs; these targets just let you run it from the
# repository root instead of having to `cd apps/desktop` first.
#
#   make release        # patch bump (default)
#   make release-minor
#   make release-major
#
# Each target bumps the version across package.json, tauri.conf.json, both
# Cargo.toml files and the lockfiles, then commits, tags `vX.Y.Z`, and pushes
# (which triggers the Tauri build in .github/workflows/release.yml).

RELEASE := node apps/desktop/tools/release.mjs

.PHONY: release release-patch release-minor release-major

release: release-patch

release-patch:
	$(RELEASE) patch

release-minor:
	$(RELEASE) minor

release-major:
	$(RELEASE) major
