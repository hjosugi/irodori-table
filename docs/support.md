# Support

Irodori Table is a development-preview, open-source database workbench. Use this
page as the public support text for app stores, package managers, release pages,
and the project site.

## Public support channels

- Project site: <https://hjosugi.github.io/irodori-table/>
- Documentation: <https://hjosugi.github.io/irodori-table/docs.html>
- Releases: <https://github.com/hjosugi/irodori-table/releases>
- Issues: <https://github.com/hjosugi/irodori-table/issues>
- Security reports: follow [SECURITY.md](../SECURITY.md)

For suspected vulnerabilities, do not open a public issue with exploit details,
credentials, database dumps, connection strings, customer data, or private logs.
Use the private disclosure path described in `SECURITY.md`.

## What to include in a bug report

Include enough detail to reproduce the behavior without exposing secrets:

- Irodori Table version and install channel.
- Operating system and architecture.
- Database engine and version, if relevant.
- The smallest query, schema shape, file, or workflow that reproduces the issue.
- A screenshot or redacted error message.
- Whether the issue happens in a clean workspace.

Do not include passwords, access tokens, private keys, database dumps, customer
records, or unredacted production connection URLs.

## Support scope

Supported project areas:

- install and startup problems;
- connection profile setup;
- SQL editor behavior, Vim mode, shortcuts, formatting, and execution;
- result grid display, export, and row inspection;
- schema metadata, completion, ERD, query plan, and migration/diff workflows;
- release artifacts, package-manager manifests, and updater behavior;
- extension SDK and connector-extension issues.

Out of scope for public issue support:

- recovering damaged production data;
- tuning private database infrastructure;
- debugging proprietary SQL or schemas that cannot be reduced to a public
  reproduction;
- account, tax, certificate, and signing issues for store maintainers.

## Response expectations

Irodori Table is not yet a commercial support product. Public issues are handled
on a best-effort basis. Security-sensitive reports and regressions in released
installers take priority over feature requests.

## Store listing support text

Short support statement:

> Report bugs and request help through the GitHub issue tracker. Do not share
> credentials or private database data in public reports.

Japanese support statement:

> 不具合報告とサポート依頼は GitHub Issues で受け付けます。公開 Issue に認証情報や
> 非公開のデータベース内容を含めないでください。
