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

.PHONY: release release-patch release-minor release-major run-linux run-linux-release \
        knowledge-refresh knowledge-analyze ml-extract docs docs-check

release: release-patch

release-patch:
	$(RELEASE) patch

release-minor:
	$(RELEASE) minor

release-major:
	$(RELEASE) major

# Local real-device testing on Linux (CachyOS/Arch, etc.): build an AppImage,
# install it to ~/Applications, register a launcher entry, and open it.
#   make run-linux           # fast debug build (default)
#   make run-linux-release   # optimized build
# Set NO_LAUNCH=1 to install without opening.
run-linux:
	node apps/desktop/tools/install-linux.mjs

run-linux-release:
	RELEASE=1 node apps/desktop/tools/install-linux.mjs

# Knowledge base + generated data-source docs.
#   make knowledge-refresh   # fetch official docs, then extract facts (changed-only)
#   make ml-extract          # optional model-backed cheatsheet extraction (needs IRODORI_LLM_*)
#   make docs                # regenerate per-engine cheatsheets from facts/fixtures
#   make docs-check          # CI guards: registry drift + cheatsheets up to date
LIMIT ?= 16
knowledge-refresh:
	node tools/knowledge/refresh.mjs --limit $(LIMIT)
	node tools/knowledge/analyze.mjs --changed-only

knowledge-analyze:
	node tools/knowledge/analyze.mjs --changed-only

ml-extract:
	node tools/knowledge/ml-extract.mjs --all --limit 12

docs:
	node tools/knowledge/cheatsheet.mjs

docs-check:
	node tools/docs/support-status.mjs
	node tools/knowledge/cheatsheet.mjs --check
