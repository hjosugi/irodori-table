.DEFAULT_GOAL := help

RELEASE := node apps/desktop/tools/release.mjs
DB ?= postgres
LIMIT ?= 16
JS_PM ?= npm
ENGINE_BIN ?= $(shell command -v podman >/dev/null 2>&1 && echo podman || echo docker)

.PHONY: help setup setup-desktop setup-fast \
        dev test build typegen e2e doctor \
        desktop-dev desktop-vite desktop-typegen desktop-typegen-check desktop-format desktop-format-check desktop-test desktop-test-rust-ts desktop-test-watch desktop-build desktop-build-verified desktop-e2e \
        check security security-strict extension-manifests db db-verify db-all db-up db-down \
        release release-patch release-minor release-major run-linux run-linux-release \
        knowledge-refresh knowledge-analyze ml-extract docs docs-check

ifneq ($(filter $(JS_PM),npm bun),$(JS_PM))
$(error Unsupported JS_PM="$(JS_PM)"; use JS_PM=npm or JS_PM=bun)
endif

define js-run
$(if $(filter bun,$(JS_PM)),bun --cwd=$(1) run $(2),npm --prefix $(1) run $(2))
endef

help:
	@printf "Irodori root commands\n\n"
	@printf "Setup\n"
	@printf "  make setup             npm ci for the desktop app\n"
	@printf "  make setup-desktop     npm ci for apps/desktop\n"
	@printf "  make setup-fast        Bun install without lockfile writes (local only)\n"
	@printf "  make doctor            check local tools and common missing setup\n\n"
	@printf "Shortcuts\n"
	@printf "  make dev               desktop-dev\n"
	@printf "  make test              desktop-test\n"
	@printf "  make build             desktop-build\n"
	@printf "  make typegen           desktop-typegen\n"
	@printf "  make e2e               desktop-e2e\n"
	@printf "  JS_PM=bun make test    run JS scripts through Bun where useful\n\n"
	@printf "Desktop app\n"
	@printf "  make desktop-dev       Tauri dev shell + Vite (:1420)\n"
	@printf "  make desktop-vite      Vite only, for manual debug binaries\n"
	@printf "  make desktop-typegen   regenerate Rust -> TypeScript bindings\n"
	@printf "  make desktop-typegen-check verify generated bindings are current\n"
	@printf "  make desktop-format    format desktop JS/TS sources with oxfmt\n"
	@printf "  make desktop-format-check verify desktop JS/TS formatting with oxfmt\n"
	@printf "  make desktop-test      Vitest\n"
	@printf "  make desktop-test-rust-ts Vitest + cargo test in parallel\n"
	@printf "  make desktop-test-watch Vitest watch mode\n"
	@printf "  make desktop-build     TypeScript + Vite production build (fast, no typegen)\n"
	@printf "  make desktop-build-verified typegen check + TypeScript + Vite build\n"
	@printf "  make desktop-e2e       Playwright\n"
	@printf "  make run-linux         build, install, and launch a local Linux AppImage\n\n"
	@printf "Sample databases\n"
	@printf "  make db-up DB=postgres     start one sample DB and print its env export\n"
	@printf "  make db-verify DB=postgres start, integration-test, then stop one DB\n"
	@printf "  make db-all                verify the normal bootable DB set\n"
	@printf "  make db-down DB=postgres   stop and remove one sample DB\n"
	@printf "  DB options: postgres mysql mariadb timescaledb cockroachdb yugabytedb tidb sqlserver mongodb oracle\n\n"
	@printf "Checks and docs\n"
	@printf "  make check             cargo test + desktop test/build\n"
	@printf "  make security          license, lockfile, npm audit/signature, RustSec checks\n"
	@printf "  make security-strict   same as security, but requires cargo-audit locally\n"
	@printf "  make extension-manifests validate extension templates/examples\n"
	@printf "  make docs              regenerate generated docs\n"
	@printf "  make docs-check        verify generated docs are current\n"

setup: setup-desktop

setup-desktop:
	npm --prefix apps/desktop ci

setup-fast:
	bun --cwd=apps/desktop install --no-save

dev: desktop-dev

test: desktop-test

build: desktop-build

typegen: desktop-typegen

e2e: desktop-e2e

doctor:
	node tools/dev/doctor.mjs

desktop-dev:
	$(call js-run,apps/desktop,tauri dev)

desktop-vite:
	$(call js-run,apps/desktop,dev)

desktop-typegen:
	$(call js-run,apps/desktop,typegen)

desktop-typegen-check:
	$(call js-run,apps/desktop,typegen:check)

desktop-format:
	$(call js-run,apps/desktop,format)

desktop-format-check:
	$(call js-run,apps/desktop,format:check)

desktop-test:
	$(call js-run,apps/desktop,test)

desktop-test-rust-ts:
	$(call js-run,apps/desktop,test:rust-ts)

desktop-test-watch:
	$(call js-run,apps/desktop,test:watch)

desktop-build:
	$(call js-run,apps/desktop,build)

desktop-build-verified:
	$(call js-run,apps/desktop,build:verified)

desktop-e2e:
	$(call js-run,apps/desktop,test:e2e)

check:
	cargo test --workspace
	$(MAKE) desktop-typegen-check
	$(MAKE) test
	$(MAKE) build

security:
	scripts/security-check.sh

security-strict:
	REQUIRE_CARGO_AUDIT=1 scripts/security-check.sh

extension-manifests:
	node tools/extensions/validate-manifests.mjs

db: db-verify

db-verify:
	scripts/verify-db.sh $(DB)

db-all:
	scripts/verify-db.sh all

db-up:
	scripts/verify-db.sh up $(DB)

db-down:
	scripts/verify-db.sh down $(DB)

# Repo-root release entry points. The release logic lives in
# apps/desktop/tools/release.mjs. Each release target bumps the version across
# package.json, tauri.conf.json, both Cargo.toml files and the lockfiles, then
# commits, tags `vX.Y.Z`, and pushes.

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
	node tools/docs/agent-workstreams.mjs
	node tools/docs/support-status.mjs
	node tools/docs/db-feature-samples.mjs
	node tools/extensions/validate-manifests.mjs
	node tools/knowledge/cheatsheet.mjs --check
