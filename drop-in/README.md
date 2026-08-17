# Ryker

An editing layer for rendered documents. Edit the page the way you would mark up
a draft, and Ryker hands you the exact instructions an agent needs to make the
same change in the source.

Ryker is not the report. Ryker travels with the report. Add one script tag and
the document becomes editable in place, while staying a valid HTML file that
anyone can open years later with Ryker gone.

Version 0.1.0. Built against the Phase 1 specification in
`../.data/sow/0_queue/sow-004-assets/phase-1-spec.md`.

## What you leave with

Every save folds the edits made since the last one into a set of instructions in
the right-hand pane, phrased for an agent to apply to the source. Each one quotes
the document as it was authored, so the whole set applies cleanly to a fresh copy
of the file even where a block was edited several times. The pane is editable,
copyable and downloadable.

That is the product rather than a fallback. On a document whose source Ryker can
reach, the instructions can be applied for you. On one whose source it cannot,
they are the only output there could be, and they are the same artifact either
way.

Nothing is written anywhere unless you point Ryker at a folder. The toolbar says
which of those two states you are in at all times, and never implies the other.

The instruction sidebar and saved change requests are related but different.
The sidebar is the live, cumulative prompt for the current tab. **Saved change
requests** are one JSON record per save, written below `ryker/revisions/` in the
folder you granted. They preserve save comments and structured before/after
pairs across sessions, and can later be reviewed or merged. Open them from
**More → Saved change requests…**. If a record is still being written, the
dialog waits for it rather than reporting an empty history.

Ryker also checkpoints the complete current edit set while you work. After a
refresh or browser restart it offers to restore that draft, including changes
made since the last Save. Extension drafts live in extension-owned Chrome
storage; the drop-in build uses browser storage for the document origin. A
restore is offered only when the document baseline still matches. If the source
has changed, Ryker leaves it untouched and directs you to review the saved
change requests instead.

## Installing it

Three lines before `</body>`:

```html
<script type="application/json" id="ryker-config">
{"RYKER_DOCUMENT_ID":"my-report","RYKER_DOCUMENT_PATH":"my-report.html"}
</script>
<script src="ryker.config.js"></script>
<script src="ryker/dist/ryker.js" data-ryker></script>
```

Removing those three lines leaves the report exactly as it was.

`ryker.config.js` is the shared base for a set of reports. The inline block is
each document speaking for itself and overrides it, because the document id and
path are the only values that differ across a set.

## Why the configuration is a script and not JSON

A page opened from disk cannot read a sibling file. Measured 2026-08-13 in
Chrome from a `file://` URL: `fetch()` rejects with "Failed to fetch" and a
synchronous `XMLHttpRequest` throws `NetworkError`. A classic `<script src>`
does load. So configuration arrives as an assignment rather than as a request,
and the bundle is a classic script rather than a module, because
`<script type="module" src>` also fails from `file://`.

That is not a detail. The report handed over as a ZIP is opened from disk, and
it is the case Ryker most needs to work in.

## What it does

- **Edit mode** turns prose into editable blocks. Paragraphs, list items, table
  cells, headings, captions. Not the chart, not table structure, not any element
  the host page's own script reads, not image sources.
- **The outline rail** lists the document's own structure down the left edge:
  every section, heading, table, figure, quote and paragraph, collapsed below
  the second level. Clicking a row selects what it covers, right-clicking offers
  to move or delete it, and a row can be dragged to a new place.
- **Moving** is derived rather than recorded. Block identity comes from content,
  so a moved paragraph keeps its id and its markup and a block by block
  comparison sees nothing at all. What changes is order, which a snapshot
  already holds, so a move is found by comparing the order the document was
  authored in against the order it is in now. Move something out and back and
  Ryker correctly reports nothing.
- **A formatting row** floats over the selection while editing: Paragraph and
  H1–H5 block types, bold, italic, strikethrough, link and clear formatting.
  Block-type changes support undo/redo and are emitted as element-name changes,
  not as fictional text rewrites.
- **Export** produces the report with Ryker removed, the report with Ryker
  attached, or a ZIP with whatever else you choose.
- **Failure isolation.** Every stage of the boot is wrapped. A module that
  throws is named in the console and skipped, and the document stays readable
  and exportable, which the test suite proves by poisoning one on purpose.

## Secrets

Anything in Ryker configuration ships inside the report and is readable by
anyone who opens it. A document id and a path are public by design and belong
there. A client secret, an app private key or a token does not, and Ryker
refuses to start if it finds one, because by then it is already exposed and the
right response is to rotate it.

Every generated artifact is scanned for credential patterns before it leaves:
the clean HTML, the with-Ryker copy, and every member of a ZIP. That is defence
in depth, not a substitute for never putting a credential in a report.

## Building

```bash
node build/bundle.mjs
```

Concatenation, on purpose. Each source file assigns onto the `Ryker` namespace
rather than importing, so there is no build dependency, nothing to vendor, and
output anyone can read. The drop-in and extension artifacts are generated from
the same 31-module load order; `dist/ryker.js` is roughly 289 KB.

The build refuses to emit when a source file breaks a rule:

- Over 600 lines.
- Missing from, or absent in, the load order. A file no bundle loads has to be
  named in the `UNBUNDLED` exemption with a reason, and a stale exemption whose
  file no longer exists also fails, so an exemption cannot start hiding a real
  orphan.
- Containing a literal control character. Invisible in an editor and harmless in
  an external script, fatal when inlined: the HTML tokenizer rewrites NUL to
  U+FFFD in script data and the script silently never runs. This check exists
  because that bug shipped once during development and cost an hour.
- Containing `</script`, `<script` or `<!--`, which move the tokenizer out of
  script-data state and swallow the rest of the document.

## Testing

```bash
node ../test/run.mjs
```

Real Chrome over the DevTools Protocol, driven through Node's built-in
`WebSocket`. No `package.json`, no `node_modules`, nothing vendored. Set
`RYKER_CHROME` if Chrome is not at `/usr/bin/google-chrome`.

The suite loads `test/fixtures/report.html`, captures the document before Ryker
exists, injects the bundle, and then requires that a clean export is
character-for-character identical to that capture. Everything Ryker adds has to
come back out: the chrome element, the stylesheet, the editable attributes, the
block stamps and the offsets it sets on the root element. The fixture also pins
which elements are editable, so a change to the exclusion rules cannot pass by
restoring the count through some other route.

## Placement Audits mirror

The repository's `drop-in/` directory is the source of truth for the deployed
copy under Codeable Placement Audits. From Windows, build and sync it through
WSL with:

```powershell
npm run sync
```

The underlying PowerShell alternative is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\sync-placement-audits.ps1
```

The command mirrors only `README.md`, `build/`, `dist/`, `docs/`, and `src/`.
It removes retired files inside those managed paths, but deliberately preserves
`revisions/` and any other deployment data. Use `-WhatIf` to preview the file
operations or `-SkipBuild` when `dist/ryker.js` is already current.

## Layout

```
src/
  bootstrap/     boot, failure isolation, toolbar
  config/        configuration intake and detection states
  editor/        blocks, sanitiser, contenteditable, outline, move
  instructions/  the instruction set and the change-request browser
  export/        html, zip, packager
  storage/       shared filesystem access, the change-request log, recovery
  security/      credential scan
  ui/            styles, shadow shell, rail, pane, dialogs
  utils/         dom helpers
build/bundle.mjs
dist/ryker.js
test/
```

## Not in this version

Markdown, publish and the app are scoped in
`../.data/sow/1_progressing/sow-006-ryker-one-product-app-and-markdown.md`.
The first unpacked Chrome extension scaffold is under `../extension/`, governed
by `../.data/sow/1_progressing/sow-007-ryker-chrome-extension.md`. Google Drive and Docs
export is staged in `../.data/sow/_staging/sow-005-ryker-google-docs-export.md`.

Comments, the revision journal, revision review and the GitHub backend were
built and then decommissioned on 2026-08-16, per sow-006. They are recoverable
at the `v0.1.0-two-builds` tag.
