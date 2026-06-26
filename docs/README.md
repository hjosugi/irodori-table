# Documentation Guide

This directory holds planning, architecture, runbook, policy, generated-reference,
and public-site documents. Keep the source of truth narrow: update the owning
document instead of adding another near-duplicate status page.

## Fast Paths

| If you need to... | Read / update |
| --- | --- |
| Start local development | [../README.md](../README.md), [linux-development.md](linux-development.md) |
| Check what is implemented today | [implementation-progress.md](implementation-progress.md) |
| Pick the next ticket | [implementation-backlog.md](implementation-backlog.md) |
| Check engine support | [data-source-support-status.md](data-source-support-status.md) |
| Add DB-specific samples or links | [db-feature-samples.md](db-feature-samples.md), [../samples/db-feature-samples.json](../samples/db-feature-samples.json) |
| Update public website copy | [site/](site/) |
| Add generated per-engine docs | [cheatsheets/README.md](cheatsheets/README.md), [cheatsheet-autodoc-plan.md](cheatsheet-autodoc-plan.md) |
| Record a durable architectural choice | [adr/](adr/) |

## Source-Of-Truth Rules

| Topic | Owning document |
| --- | --- |
| Phase-level product direction | [../ROADMAP.md](../ROADMAP.md) |
| Ticket IDs, dependencies, and done criteria | [implementation-backlog.md](implementation-backlog.md) |
| Built-and-verified snapshot | [implementation-progress.md](implementation-progress.md) |
| Release gates before daily-driver use | [production-readiness.md](production-readiness.md) |
| Engine registry status | [data-source-support-status.md](data-source-support-status.md) |
| DB-specific runnable sample catalog | [db-feature-samples.md](db-feature-samples.md) + [../samples/db-feature-samples.json](../samples/db-feature-samples.json) |
| Feature parity and competitive gaps | [feature-matrix.md](feature-matrix.md) |
| Public website/search/blog copy | [site/](site/) |

Before adding a new status page, check whether one of these rows should be
updated instead.

## Product And Status

| Need | Source of truth |
| --- | --- |
| Product direction and phase-level goals | [../ROADMAP.md](../ROADMAP.md) |
| Ticket IDs, dependencies, and done criteria | [implementation-backlog.md](implementation-backlog.md) |
| Current built-and-verified snapshot | [implementation-progress.md](implementation-progress.md) |
| Release gates before daily-driver use | [production-readiness.md](production-readiness.md) |
| Supported, verified, pending, and future engines | [data-source-support-status.md](data-source-support-status.md) |
| Competitive capability matrix | [feature-matrix.md](feature-matrix.md) |

## Runbooks

| Need | Read |
| --- | --- |
| Linux desktop setup and WebKit/Tauri troubleshooting | [linux-development.md](linux-development.md) |
| Engine connection syntax and quirks | [engine-syntax-reference.md](engine-syntax-reference.md) |
| DB-specific feature samples and catalog checks | [db-feature-samples.md](db-feature-samples.md) |
| External database verification rules | [external-db-contract-and-verification.md](external-db-contract-and-verification.md) |
| UI language switching and translation keys | [i18n.md](i18n.md) |
| Generated cheatsheets | [cheatsheets/README.md](cheatsheets/README.md) |

## Public Site

`docs/site/` is a checked-in static site. It is not generated from the Markdown
docs yet, so keep the site copy and `docs/site/search-data.js` in sync when
changing user-facing support/status text.

Preview from the repo root:

```sh
python3 -m http.server 8080 --directory docs/site
```

## Architecture And Strategy

| Area | Read |
| --- | --- |
| Data-source expansion | [data-source-coverage-strategy.md](data-source-coverage-strategy.md) |
| Completion and optional AI | [completion-and-ai-strategy.md](completion-and-ai-strategy.md) |
| Editor stack decision | [adr/0001-editor-stack.md](adr/0001-editor-stack.md) |
| Extension SDK | [extension-development.md](extension-development.md) |
| Type bridge handoff | [type-bridge-handoff.md](type-bridge-handoff.md) |
| Local knowledge base | [knowledge-base.md](knowledge-base.md) |
| Maintainability audit | [maintainability-audit.md](maintainability-audit.md) |

## Research And Automation

| Need | Read |
| --- | --- |
| Current DB-client market scan | [db-client-market-scan-2026-06-21.md](db-client-market-scan-2026-06-21.md) |
| A5:SQL Mk-2 feature reference notes | [reference-a5sql.md](reference-a5sql.md) |
| RSQL performance and UX reference notes | [reference-rsql.md](reference-rsql.md) |
| Generated-doc automation plan | [cheatsheet-autodoc-plan.md](cheatsheet-autodoc-plan.md) |
| Multi-agent handoff notes | [agent-coordination.md](agent-coordination.md) |

## Generated Or Guarded Docs

| Surface | Command |
| --- | --- |
| Support-status registry drift | `node tools/docs/support-status.mjs` |
| DB feature sample catalog | `node tools/docs/db-feature-samples.mjs` |
| All docs guards | `make docs-check` |
| Regenerate cheatsheets from knowledge data | `make docs` |

## Governance

| Need | Read |
| --- | --- |
| Clean-room reference rules | [clean-room.md](clean-room.md) |
| License policy | [licensing.md](licensing.md) |
| PR expectations | [../CONTRIBUTING.md](../CONTRIBUTING.md) |

## Cleanup Rules

- Prefer updating the status/backlog/source-of-truth docs above over creating a
  new dated note.
- Keep public-site facts in `docs/site/*.html` and `docs/site/search-data.js`
  aligned with the owning Markdown/source JSON.
- Keep dated audit evidence out of the repo unless it is required for a release
  gate or a regression test. Temporary screenshots belong in `/tmp` or release
  artifacts.
- If a research note becomes durable product input, merge it into
  [db-client-market-scan-2026-06-21.md](db-client-market-scan-2026-06-21.md),
  [feature-matrix.md](feature-matrix.md), or the relevant strategy document.
