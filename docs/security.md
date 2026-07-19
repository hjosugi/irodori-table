# Security

Three separate mechanisms, often confused. This page keeps them apart and is
explicit about what each does and does not protect.

For vulnerability reporting and project security scope, see
[SECURITY.md](../SECURITY.md).

## Passkey lock

**Settings ▸ Security.** A launch-time gate: with it enabled, the workbench does
not render until a registered passkey verifies.

### Setting it up

The **Passkey** status row reports what the runtime supports — **A
user-verifying platform authenticator is available.**, **WebAuthn is available
for this desktop runtime.**, or **This runtime does not expose passkey APIs.**
— with a **Ready** or **Unavailable** pill.

| Control | Effect |
| --- | --- |
| **Set up passkey** / **Replace passkey** | Registers a platform authenticator and enables the lock |
| **Require passkey on launch** | *Lock the local workbench until the registered passkey verifies.* Disabled until a passkey is registered |
| **Verify** | Test assertion against the registered passkey |
| **Remove passkey** | Clears the credential and disables the lock |
| **Registered passkey** | Shows `{label} · created {date}`, or **No passkey registered.** |

Registration uses `userVerification: "required"` with ES256 or RS256 and no
attestation. Only the public key is stored; the private key stays in the
authenticator.

### The lock screen

**Irodori is locked** / *Verify your passkey to continue.* with an **Unlock**
button. Verification happens locally against the stored public key, checking the
signature, the challenge, and the origin.

**There is no retry limit, no lockout, no backup code, and no recovery path.**
Failures render the underlying message verbatim.

### What it actually protects

**Only the UI, and only at launch.** Be clear about this:

- Nothing is encrypted. Connection profiles, query history, snippets, keymap
  overrides, themes, and the installed-extension registry all remain in plain
  local storage and app-data JSON.
- The lock state itself is a local-storage flag. Anyone with file-system or
  developer-tools access can clear it.
- The backend command surface is unaffected — it stays reachable while the lock
  screen is displayed.

Treat it as a convenience screen that keeps a passer-by out of your workbench,
not as a security boundary. For real protection use full-disk encryption and OS
account separation.

## Where secrets live

| Secret | Storage |
| --- | --- |
| Connection password | **Not stored.** Blanked before profiles are persisted, and stripped from connection strings. Re-entered each session |
| AI provider API key | **OS keychain.** Persisted and reloaded at startup |
| Passkey credential | Local storage — public key and metadata only |

The AI provider key field's placeholder still says *"kept in memory only"*. That
text is stale: the key is written to the OS keychain. See
[AI chat](ai-chat.md).

## Read-only connections

Ticking **Read-only mode** on a connection profile blocks Irodori's own write
paths — grid editing is refused and the results **Import** button is disabled.

It does not restrict what you can type and run in the editor, and it is not a
server-side permission. Use a restricted database role when you need a real
guarantee. See [Connections](connections.md).

## Network behaviour

The app does not upload telemetry or crash reports. It connects to endpoints you
configure, plus a small set of documented project endpoints — the extension
catalog and the knowledge pack on `raw.githubusercontent.com`, extension release
downloads, and update checks.

Two cases send data further than you might assume:

- **A cloud AI provider** receives your prompts and any schema context. The app
  shows a one-time disclosure naming the host before you save such a provider.
- **The CLI AI provider** spawns a local subprocess using the program name and
  arguments you configure.

## Gaps

- **The passkey lock encrypts nothing** and can be disabled by editing local
  storage.
- **The Unlock button stays enabled even when the runtime reports passkeys as
  unavailable**, so it fails with a raw error and no in-app recovery.
- **Connection secrets have no keychain path**, unlike the AI provider key.
- **No SSH or proxy transport diagnostics.** Those stages report
  *"runtime dialer integration for SSH/proxy transports is pending"*; only
  direct TCP is actually probed.
- **The cloud-provider consent is per-machine and cannot be revoked in-app**
  once accepted, and any OpenAI-compatible endpoint is treated as cloud even
  when it is a local server.
