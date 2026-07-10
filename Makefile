.DEFAULT_GOAL := help

RELEASE := node apps/desktop/tools/release.mjs
DB ?= postgres
LIMIT ?= 16
JS_PM ?= npm
ENGINE_BIN ?= $(shell command -v podman >/dev/null 2>&1 && echo podman || echo docker)
EXTENSION_SDK_DIR ?= $(firstword $(wildcard ../irodori-kit/packages/extension-sdk irodori-kit/packages/extension-sdk))

.PHONY: help setup setup-desktop setup-fast \
        dev test build typegen e2e doctor \
        desktop-dev desktop-vite desktop-typegen desktop-typegen-check desktop-format desktop-format-check desktop-lint desktop-test desktop-test-rust-ts desktop-test-watch desktop-build desktop-build-verified desktop-e2e \
        rust-clippy cargo-deny workflow-lint \
        check security security-strict extension-manifests kit-link kit-unlink kit-patch-check foundation-release foundation-release-check db db-verify db-all db-up db-down \
        extension-scenarios extension-fleet-audit \
        release release-patch release-minor release-major run-linux run-linux-release \
        knowledge-refresh knowledge-analyze ml-extract perf-hot-surfaces docs docs-check

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
	@printf "  make desktop-lint      lint desktop JS/TS sources with oxlint\n"
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
	@printf "  make rust-clippy       cargo clippy warning gate\n"
	@printf "  make cargo-deny        Rust dependency advisories/licenses/sources gate\n"
	@printf "  make workflow-lint     actionlint for GitHub Actions workflows\n"
	@printf "  make security          license, lockfile, npm audit/signature, RustSec checks\n"
	@printf "  make security-strict   same as security, but requires cargo-audit locally\n"
	@printf "  make extension-manifests validate kit extension SDK templates when present\n"
	@printf "  make kit-link          add a local Cargo [patch] for ../irodori-kit\n"
	@printf "  make kit-unlink        remove the managed local irodori-kit Cargo [patch]\n"
	@printf "  make kit-patch-check   fail if a local irodori-kit Cargo [patch] remains\n"
	@printf "  make foundation-release-check verify foundation git-tag pins are lockstep\n"
	@printf "  make foundation-release FOUNDATION_ARGS='--kit vX.Y.Z --knowledge vX.Y.Z --sql vX.Y.Z' update foundation pins\n"
	@printf "  make extension-scenarios run connector extension scenario tests\n"
	@printf "  make extension-fleet-audit run post-ABI-migration connector fleet audit (#44)\n"
	@printf "  make docs              regenerate generated docs\n"
	@printf "  make docs-check        verify generated docs are current\n"
	@printf "  make perf-hot-surfaces benchmark editor/result-grid hot-surface paths\n"

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

desktop-lint:
	$(call js-run,apps/desktop,lint)

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

rust-clippy:
	scripts/rust-clippy.sh

cargo-deny:
	scripts/cargo-deny.sh

workflow-lint:
	actionlint

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
	@if [ -n "$(EXTENSION_SDK_DIR)" ]; then \
		npm --prefix "$(EXTENSION_SDK_DIR)" run validate; \
	elif [ -n "$$CI" ]; then \
		printf "irodori-kit/packages/extension-sdk not found; CI must check out irodori-kit\n"; \
		exit 1; \
	else \
		printf "irodori-kit/packages/extension-sdk not found; skipping SDK manifest validation\n"; \
	fi

kit-link:
	node tools/dev/patch-siblings.mjs link

kit-unlink:
	node tools/dev/patch-siblings.mjs unlink

kit-patch-check:
	node tools/dev/patch-siblings.mjs check

foundation-release-check:
	node tools/dev/foundation-release.mjs --check

foundation-release:
	node tools/dev/foundation-release.mjs --apply $(FOUNDATION_ARGS)

extension-scenarios:
	node tools/extensions/scenario-test.mjs --all --strict-package --require-archive

extension-fleet-audit:
	node tools/extensions/fleet-audit.mjs

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

perf-hot-surfaces:
	node tools/perf/hot-surface-benchmark.mjs

docs:
	node tools/docs/build-extension-catalog.mjs
	node tools/knowledge/cheatsheet.mjs

docs-check:
	node tools/docs/agent-workstreams.mjs
	node tools/extensions/sync-release-catalog.mjs --check
	node tools/docs/build-extension-catalog.mjs --check
	node tools/docs/support-status.mjs
	node tools/docs/db-feature-samples.mjs
	node tools/knowledge/cheatsheet.mjs --check
