.DEFAULT_GOAL := help

RELEASE := node apps/desktop/tools/release.mjs
DB ?= postgres
LIMIT ?= 16
ENGINE_BIN ?= $(shell command -v podman >/dev/null 2>&1 && echo podman || echo docker)

.PHONY: help setup setup-desktop setup-web \
        desktop-dev desktop-vite desktop-typegen desktop-test desktop-build desktop-e2e \
        web-dev web-test web-build web-preview web-endpoint web-endpoint-host web-endpoint-down \
        check db db-verify db-all db-up db-down \
        release release-patch release-minor release-major run-linux run-linux-release \
        knowledge-refresh knowledge-analyze ml-extract docs docs-check

help:
	@printf "Irodori root commands\n\n"
	@printf "Setup\n"
	@printf "  make setup             npm ci for desktop and web apps\n"
	@printf "  make setup-desktop     npm ci for apps/desktop\n"
	@printf "  make setup-web         npm ci for apps/web\n\n"
	@printf "Desktop app\n"
	@printf "  make desktop-dev       Tauri dev shell + Vite (:1420)\n"
	@printf "  make desktop-vite      Vite only, for manual debug binaries\n"
	@printf "  make desktop-typegen   regenerate Rust -> TypeScript bindings\n"
	@printf "  make desktop-test      Vitest\n"
	@printf "  make desktop-build     typegen + TypeScript + Vite production build\n"
	@printf "  make desktop-e2e       Playwright\n"
	@printf "  make run-linux         build, install, and launch a local Linux AppImage\n\n"
	@printf "Web app\n"
	@printf "  make web-dev           Vite web app (:1422)\n"
	@printf "  make web-endpoint      Postgres-backed local API endpoint (:1423)\n"
	@printf "  make web-endpoint-host host-network endpoint variant\n"
	@printf "  make web-endpoint-down stop endpoint containers and volumes\n"
	@printf "  make web-test          Vitest\n"
	@printf "  make web-build         TypeScript + Vite production build\n\n"
	@printf "Sample databases\n"
	@printf "  make db-up DB=postgres     start one sample DB and print its env export\n"
	@printf "  make db-verify DB=postgres start, integration-test, then stop one DB\n"
	@printf "  make db-all                verify the normal bootable DB set\n"
	@printf "  make db-down DB=postgres   stop and remove one sample DB\n"
	@printf "  DB options: postgres mysql mariadb timescaledb cockroachdb yugabytedb tidb sqlserver mongodb oracle\n\n"
	@printf "Checks and docs\n"
	@printf "  make check             cargo test + desktop/web test/build\n"
	@printf "  make docs              regenerate generated docs\n"
	@printf "  make docs-check        verify generated docs are current\n"

setup: setup-desktop setup-web

setup-desktop:
	npm --prefix apps/desktop ci

setup-web:
	npm --prefix apps/web ci

desktop-dev:
	npm --prefix apps/desktop run tauri dev

desktop-vite:
	npm --prefix apps/desktop run dev

desktop-typegen:
	npm --prefix apps/desktop run typegen

desktop-test:
	npm --prefix apps/desktop test

desktop-build:
	npm --prefix apps/desktop run build

desktop-e2e:
	npm --prefix apps/desktop run test:e2e

web-dev:
	npm --prefix apps/web run dev

web-test:
	npm --prefix apps/web test

web-build:
	npm --prefix apps/web run build

web-preview:
	npm --prefix apps/web run preview

web-endpoint:
	$(ENGINE_BIN) compose -f apps/web/compose.endpoint.yaml up --build

web-endpoint-host:
	$(ENGINE_BIN) compose -f apps/web/compose.endpoint.host.yaml up --build

web-endpoint-down:
	$(ENGINE_BIN) compose -f apps/web/compose.endpoint.yaml down -v || true
	$(ENGINE_BIN) compose -f apps/web/compose.endpoint.host.yaml down -v || true

check:
	cargo test
	$(MAKE) desktop-test
	$(MAKE) desktop-build
	$(MAKE) web-test
	$(MAKE) web-build

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
	node tools/docs/support-status.mjs
	node tools/knowledge/cheatsheet.mjs --check
