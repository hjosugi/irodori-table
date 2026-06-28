# Disclaimer

Irodori Table is a development-preview, open-source database workbench. This
page provides public disclaimer text for release pages, app stores, package
manager submissions, and support references.

## Development preview

The application is pre-1.0. Features, file formats, extension APIs, and supported
database behavior may change. Preview builds can contain defects and incomplete
connectors.

## Database operations

Database clients can run destructive commands. Review generated SQL, edit
previews, migration plans, import/export settings, and target connections before
executing them. Use backups, transactions, read-only accounts, staging
databases, and least-privilege credentials when working with important data.

Irodori Table does not guarantee recovery from accidental data loss, incorrect
queries, migration mistakes, permission mistakes, network failures, or
third-party service behavior.

## AI-assisted features

AI-assisted SQL generation and explanation features can produce incomplete,
incorrect, insecure, or inefficient output. Treat generated SQL and explanations
as drafts. Verify syntax, permissions, query plans, and business impact before
running generated statements.

If an external AI provider is configured, prompts and related schema/query
context may be sent to that provider according to the user's configuration and
the provider's own terms.

## Third-party systems

Irodori Table connects to database engines, cloud APIs, SSH/proxy transports,
OS keychains, package managers, and optional model providers. Those systems are
owned and operated independently. Availability, compatibility, pricing, data
handling, and access controls are governed by the relevant third party.

## License and warranty

Project-authored code is licensed under `MIT OR 0BSD` unless a file says
otherwise. The software is provided without warranty. See [LICENSE](../LICENSE)
for the controlling license text.
