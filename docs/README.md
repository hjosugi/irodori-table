# Documentation Guide

This directory holds planning, architecture, runbook, and policy documents. Keep
the source of truth narrow: update the owning document instead of adding another
near-duplicate status page.

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
| External database verification rules | [external-db-contract-and-verification.md](external-db-contract-and-verification.md) |
| Web app runtime and endpoint contract | [web-app-architecture.md](web-app-architecture.md) |
| Generated cheatsheets | [cheatsheets/README.md](cheatsheets/README.md) |

## Architecture And Strategy

| Area | Read |
| --- | --- |
| Data-source expansion | [data-source-coverage-strategy.md](data-source-coverage-strategy.md) |
| Completion and optional AI | [completion-and-ai-strategy.md](completion-and-ai-strategy.md) |
| Editor stack decision | [adr/0001-editor-stack.md](adr/0001-editor-stack.md) |
| Extension SDK | [extension-development.md](extension-development.md) |
| Type bridge handoff | [type-bridge-handoff.md](type-bridge-handoff.md) |
| Local knowledge base | [knowledge-base.md](knowledge-base.md) |

## Research And Automation

| Need | Read |
| --- | --- |
| Current DB-client market scan | [db-client-market-scan-2026-06-21.md](db-client-market-scan-2026-06-21.md) |
| RSQL performance and UX reference notes | [reference-rsql.md](reference-rsql.md) |
| Generated-doc automation plan | [cheatsheet-autodoc-plan.md](cheatsheet-autodoc-plan.md) |
| Multi-agent handoff notes | [agent-coordination.md](agent-coordination.md) |

## Governance

| Need | Read |
| --- | --- |
| Clean-room reference rules | [clean-room.md](clean-room.md) |
| License policy | [licensing.md](licensing.md) |
| PR expectations | [../CONTRIBUTING.md](../CONTRIBUTING.md) |

## Cleanup Rules

- Prefer updating the status/backlog/source-of-truth docs above over creating a
  new dated note.
- Keep dated audit evidence out of the repo unless it is required for a release
  gate or a regression test. Temporary screenshots belong in `/tmp` or release
  artifacts.
- If a research note becomes durable product input, merge it into
  [db-client-market-scan-2026-06-21.md](db-client-market-scan-2026-06-21.md),
  [feature-matrix.md](feature-matrix.md), or the relevant strategy document.
