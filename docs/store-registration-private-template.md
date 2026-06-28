# Private Store Registration Runbook Template

Copy this file to `docs/private/store-registration-runbook.md` before filling it
in. The `docs/private/` directory is intentionally ignored by git.

Do not commit real account IDs, addresses, certificates, private keys, signing
passwords, tax records, banking records, recovery codes, or review messages that
contain account-specific details.

## Owners

- Release owner:
- Security reviewer:
- Legal/account owner:
- Backup maintainer:

## Accounts

| Channel | Account owner | Login location | MFA owner | Notes |
| --- | --- | --- | --- | --- |
| Apple Developer / App Store Connect |  |  |  |  |
| Microsoft Partner Center |  |  |  |  |
| Homebrew tap |  |  |  |  |
| Scoop bucket |  |  |  |  |
| winget |  |  |  |  |
| Chocolatey |  |  |  |  |
| AUR |  |  |  |  |
| Flathub |  |  |  |  |
| Snapcraft |  |  |  |  |
| crates.io |  |  |  |  |

## Signing and credentials

Record where secrets live, not the secret values.

| Secret | Storage location | Rotation owner | Last rotated | Recovery path |
| --- | --- | --- | --- | --- |
| macOS Developer ID certificate |  |  |  |  |
| Apple app-specific password |  |  |  |  |
| Windows code-signing certificate |  |  |  |  |
| Tauri updater private key |  |  |  |  |
| Package registry tokens |  |  |  |  |

## Release submission checklist

- Confirm version and tag.
- Confirm release notes.
- Confirm artifact names.
- Confirm sha256 values.
- Confirm signatures/notarization.
- Confirm public support/privacy/disclaimer URLs.
- Confirm package manager manifest diffs.
- Confirm rollback plan.
- Submit package/store update.
- Save review IDs and private review notes in this private doc.

## Review notes

Use one section per submission.

### YYYY-MM-DD channel version

- Submission ID:
- Reviewer feedback:
- Required changes:
- Public docs changed:
- Private account changes:
- Final status:
