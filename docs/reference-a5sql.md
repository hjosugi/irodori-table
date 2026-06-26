# A5:SQL Mk-2 Reference Notes

Last reviewed: 2026-06-26 JST.

Source: <https://a5m2.mmatsubara.com/>

## License Boundary

A5:SQL Mk-2 is distributed as freeware, and the official site says development
happens in a private GitHub repository. Treat it as public site / public behavior
reference only. Do not copy source code, screenshots, icons, UI wording, exact
layout, or private implementation details.

Use this note to turn A5's useful database-development workflows into
Irodori-owned requirements and tests. Its UI is not the target.

## Useful Reference Points

- **Oracle-aware workflows:** A5 supports Oracle client and direct connection
  modes, explain plans, PL/SQL procedure execution, and PL/SQL debugging. Irodori
  should keep Oracle first-class instead of treating it as an enterprise afterthought.
- **Deep SQL completion:** The official site calls out table/column completion
  driven by SQL parsing, including CTEs and subqueries. This is a good bar for
  deterministic completion depth.
- **Execution plan workflows:** A5 exposes access plans for Oracle, DB2, SQL
  Server, MySQL, and PostgreSQL. Irodori should normalize explain entry points
  while letting each dialect keep its plan-specific details.
- **SQL designer and analysis:** GUI query design is useful for users who inspect
  or explain joins visually. Irodori can support this later through schema-aware
  query builders without copying A5's layout.
- **Multi-statement execution:** A5 handles semicolon, slash-only lines, and
  `GO`-style delimiters, with run-current, run-after-caret, and run-all modes.
  Irodori should keep statement parsing explicit and dialect-aware.
- **Result comparison:** Running the same SQL twice and comparing multiple result
  sets is useful for integration/regression evidence. This maps to Irodori's
  result diff and saved-run history model.
- **Excel evidence workflows:** A5 can export multiple result sets to Excel and
  use that output as test evidence. Irodori should offer structured evidence
  export, but avoid making Excel the only durable artifact.
- **Comment pseudo-instructions:** A5 can read directives from SQL comments to
  set result titles and behavior. Irodori already has Query Magics; the useful
  idea is an auditable, visible command layer, not hidden magic that changes
  execution unexpectedly.
- **Table editor + spreadsheet bridge:** Excel output and paste-back editing are
  strong operator workflows. Irodori should keep clipboard and tabular paste
  semantics first-class while preserving safe transaction review.
- **Bulk import/export and dummy data:** CSV-compatible import/export, whole-table
  transfer, and dummy test-data generation are worth tracking under IO and QA.
- **ERD and definition documents:** A5 can reverse-generate ER diagrams, emit DDL,
  print/export diagrams, and produce table definition documents. Irodori should
  connect ERD, DDL generation, and docs export as one schema-comprehension flow.
- **Control panels:** Oracle, PostgreSQL, and MySQL management panels are useful
  as source-specific admin plugins, not as hardwired core UI.
- **Read-only / AI-disabled editions:** A5's separate read-only and AI-disabled
  downloads are a strong product signal. Irodori should expose workspace policies
  for read-only mode, production guardrails, and AI-disabled environments.

## Not Directly Portable

- A5 is Windows-first, while Irodori must stay cross-platform.
- A5's interface density and workflow shape are not the target; use the feature
  coverage, not the UI expression.
- Excel-centric evidence is valuable, but Irodori should also support neutral
  artifacts such as CSV/JSON/Markdown/Parquet and signed run metadata.
- Oracle/DB2/SQL Server-specific features should remain dialect plugins or
  adapter-owned panels, not cross-engine assumptions.
- Comment directives must be visible, testable, and safe. Hidden behavior changes
  inside ordinary SQL comments can surprise users.

## Candidate Backlog Follow-Ups

- `CMPL-003/004`: add CTE, subquery, function/procedure, and overload completion
  tests that match A5's advertised SQL input-assistance depth.
- `CMPL-007`: build a dialect-normalized explain-plan view, then add
  dialect-specific details for Oracle, DB2, SQL Server, MySQL, and PostgreSQL.
- `EXEC/QA`: add saved-run comparison and evidence export for repeated query
  validation, including multiple result sets.
- `AI-005`: keep Query Magics visible and auditable; consider comment directives
  only when they render as explicit commands before execution.
- `IO`: add spreadsheet paste/import previews, Excel-compatible export, and
  dummy-data generation without bypassing transaction review.
- `ADV-003/004`: connect table designer, ERD reverse generation, DDL generation,
  diagram export, and table-definition documents.
- `SEC/AI`: add workspace-level read-only mode, production DML/DDL confirmation,
  and AI-disabled policy switches.
