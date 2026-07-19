# Knowledge panel

A bundled, offline set of short facts about database products, opened from the
sidebar rail (**Knowledge**) or the command palette (**Toggle Knowledge
Panel**). No default keyboard shortcut.

## What is actually in it

A fact pack compiled into the app: **63 products, 309 facts**, dated at build
time. Each fact carries a product, an area, a title, a summary, an impact note,
a priority, and a link to its source page.

Be clear about what these facts are. They are **not** SQL tips, dialect
references, or how-to material. They are automatically generated notes aimed at
the development team, tracking what changed in each product's documentation and
what that might mean for Irodori's roadmap. A representative summary reads:

> The latest Amazon S3 Tables documentation snapshot has administration,
> monitoring, or cost feature material matching monitoring that should be
> checked before related implementation work.

The pack also covers products that are not databases at all — competing GUI
clients, and developer tooling unrelated to querying.

If you are looking for engine syntax help, this is the wrong panel. Use the
cheatsheets in
[`registry/cheatsheets/`](../registry/cheatsheets/README.md) or the engine
syntax reference at <https://hjosugi.github.io/irodori-docs/>.

## Using it

| Control | Effect |
| --- | --- |
| **Filter facts** | Substring search over product, area, title, and summary |
| **Knowledge scope** | **Connection** (facts for the connected engine) or **All products** |
| **Refresh from the published knowledge pack** | Downloads the current pack from the project repository |
| **Open the official source page** | Opens that fact's source in a browser |

The header shows **{count} facts** and **Updated {date}**.

**Refresh** fetches over the network directly from the webview. The refreshed
pack lives in memory only — close the panel and you are back to the bundled
copy. At present the published pack and the bundled copy carry identical
content, so refreshing changes nothing in practice.

## Gaps

- **Search is capped at 200 matches** out of 309 facts, with no indication that
  the list was truncated. The **{count} facts** readout then shows the capped
  number as though it were the total.
- **Scope filtering silently gives up.** With scope set to **Connection** and no
  facts for that engine, the panel shows **No facts for {engine} yet…** and
  then lists every fact in the pack below it anyway.
- **Refresh is never persisted.**
- **The refresh URL is not configurable.**
- **Area and priority badges are untranslated raw values** — you will see
  `sql_dialect`, `admin_monitoring`, `client_market` verbatim in both locales.
- **Cheatsheets are not wired into the app.** The generated per-engine
  cheatsheets in `registry/cheatsheets/` never reach this panel or any other
  part of the UI; they are repository documents only.
