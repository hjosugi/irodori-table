---
name: irodori-workstream-planner
description: Use when planning, splitting, assigning, or coordinating Irodori Table work across Codex agents/worktrees, or when a task touches shared contracts, generated docs, connector extensions, or multiple repo areas. Do not use for small single-file fixes.
---

# Irodori Workstream Planner

Use this skill to turn broad or parallel Irodori Table work into scoped,
verifiable tasks.

## Required Context

Read these files before proposing or changing a plan:

1. `AGENTS.md`
2. `docs/agent-workstreams.json`
3. `docs/repository-boundaries.md`
4. `README.md` sections relevant to setup, repo map, and commands
5. `CONTRIBUTING.md` when the work involves external references, licensing, or
   clean-room risk

If the user already named a workstream, read that workstream and its referenced
shared contracts from `docs/agent-workstreams.json` first.

## Planning Steps

1. Identify the primary workstream by matching requested behavior to
   `exclusiveWriteGlobs`.
2. List any shared contracts the task touches.
3. Separate writable paths from read-only paths.
4. Call out generated files and the source data or generator that owns them.
5. Decide whether the task can run in parallel with other workstreams.
6. Choose the narrowest verification commands from the workstream `checks`
   field and `AGENTS.md`.

## Output Shape

For planning-only requests, respond with:

- `Workstream`: id, title, and why it owns the work.
- `Writable paths`: exact folders or files the agent may edit.
- `Read-only paths`: contracts or nearby areas the agent may inspect only.
- `Contract risk`: shared contracts that require serialization.
- `Verification`: commands to run before handoff.
- `Parallelization`: whether this can run alongside other agents and any
  worktree/checkout requirement.

For implementation requests, state the chosen workstream and writable scope
before editing files.

## Rules

- Connector implementation work writes only inside its assigned
  `../irodori-extensions/{repository}/` checkout unless the user explicitly
  asks for coordinator/registry changes.
- Coordinator work owns `knowledge/engines.json` and generated extension catalog
  snapshots.
- Frontend work must not change Rust command DTOs or generated bindings unless
  the task explicitly includes a desktop-command-api contract change.
- Generated docs/catalog snapshots change with their source data or generator,
  then the relevant check runs.
- When a task would cross workstream ownership, propose a serialized order
  instead of merging all changes into one broad edit.

