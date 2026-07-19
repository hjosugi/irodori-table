# Updater

Irodori Table can check for a signed update and install it in place — but only
in builds that were compiled with the updater enabled, which is a smaller set
than you might expect.

## Checking

**Automatically at startup.** Controlled by **Settings ▸ General ▸ Check for
updates on startup** — *"Look for a signed app update when Irodori starts."* It
is **on** by default and runs once per app session.

**Manually.** **Check for Updates**, from **Tools** or the command palette.
Turning off the startup check does not remove the manual command.

## What you see

Notifications only — there is no update dialog.

| Notice | When |
| --- | --- |
| **Update available** with `{current} -> {next}` and an **Install** button | A newer version exists |
| **Installing update** | After pressing **Install** |
| **Update installed** — *Restart Irodori to finish updating.* | Download and install finished |
| **No update available** | Manual check, nothing newer |
| **Update check failed** / **Update install failed** | Something went wrong |

The startup check is quiet: it reports nothing when there is no update, and a
failure is logged to the developer console rather than shown. Only the manual
command reports **No update available** and surfaces failures.

## Which builds can update

The updater plugin is compiled in **only when the release workflow explicitly
enables it**, which happens for signed **stable**-channel builds. It is
deliberately excluded elsewhere so that a missing updater configuration cannot
prevent the app starting.

In practice:

| Build | Updater |
| --- | --- |
| Stable channel, signed | Present |
| Preview channel | Absent |
| Lightweight Linux pre-release (AppImage, deb, rpm) | Absent |
| Local build from source | Absent unless you pass the feature flag |

In a build without it, both the startup check and **Check for Updates** fail and
report **Update check failed**. That is expected, not a fault in the app —
update those installs by downloading a new build from
<https://github.com/hjosugi/irodori-table/releases>.

On Windows the installer runs in passive mode. Release and signing mechanics are
documented in [RELEASING.md](../RELEASING.md).

## Gaps

- **The failure message does not distinguish "no updater in this build" from "the
  check failed".** Both surface as **Update check failed**, so users of preview
  or lightweight builds get an error that reads like a bug.
- **Startup failures are invisible.** A permanently broken update endpoint
  produces no user-facing signal until the manual command is run.
- **No release notes, no changelog, and no version history** in the update
  notice — only the two version numbers.
- **No channel selector.** You cannot switch between stable and preview from
  inside the app.
