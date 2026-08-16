# Ryker

A drop-in editing, commenting and revision layer for authored HTML reports.

Ryker is not the report. Ryker travels with the report. Add one script tag and
the document gains an editor, inline comments and a revision history, while
staying a valid HTML file that anyone can open years later with Ryker gone.

Version 0.1.0. Built against the Phase 1 specification in
`../.data/sow/0_queue/sow-004-assets/phase-1-spec.md`.

## Two builds from one source tree

| | `dist/ryker.js` | `dist/ryker-lite.js` |
|---|---|---|
| Editing | yes | yes |
| Comments | yes | no |
| Revision history | yes | no |
| Saves to disk or GitHub | yes | no |
| AI instruction pane | no | yes, open by default |
| Size | ~177 KB | ~103 KB |

**Ryker** is for a document with a home: it commits, it keeps history, and a
team argues in the margins. **Ryker Lite** is for a document without one. It
writes nothing anywhere. Every save folds the edit into a set of instructions
in the right-hand pane, phrased for an AI to apply to the source, and that text
is the only thing you leave with. The pane is editable and copyable, and a
Clear button resets the document with a warning that says plainly that nothing
can be restored afterwards.

The shared modules are byte-identical in both bundles. Only the load list in
`build/bundle.mjs` differs.

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

- **Reader mode by default** in the full build. The toolbar is a small handle
  in the corner until someone opens it. Nothing else changes. Lite starts
  expanded and editing, because the pane is the point of it.
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
- **Comments** anchor to the quoted words plus the text around them, not to a
  position, so they survive edits elsewhere. When the quoted text genuinely goes,
  the comment is listed as unanchored rather than moved onto something else.
- **Revisions** show what changed, who changed it and when, as prose diffs
  rather than a diff of the HTML.
- **Export** produces the report with Ryker removed, the report with Ryker
  attached, the journal as JSON, or a ZIP with whatever else you choose.

## Storage

One adapter, three backends, and the active one is always named in the toolbar.
A comment written into browser storage by someone who believed they were
committing is the worst failure this tool can produce.

| Backend | When it is used | What it needs |
|---|---|---|
| Local | Always available, the floor | Nothing |
| Folder | After "Choose report folder" | A click to grant access |
| GitHub | Repository configured and a verified token | A fine-grained token |

## The revision journal

Git is not the revision store. Ryker needs revision tracking across saves and
comments on record; it does not need branching, refs, actions or a CLI.

Every save appends one record: the blocks that changed as before and after pairs
keyed by block id, the comment events of that save, plus author, timestamp and
message. Records are separate numbered files under `.ryker/revisions/`.

Four things follow. The revision panel reads straight off a record instead of
comparing two whole documents. The inline diff needs no document differ, because
the delta was captured at write time. Revision review works identically with no
repository at all. And write contention disappears, because appending a numbered
record never conflicts with someone else appending theirs.

In GitHub mode the journal is committed alongside the document, so git carries
the record even though it is not the record.

## GitHub

Authentication is a fine-grained personal access token, not the device flow.
`github.com/login/device/code` and `login/oauth/access_token` send no CORS
headers, so the device flow cannot complete in a page without a relay, and a
relay would make Ryker infrastructure mandatory. A fine-grained token also
carries the repository restriction natively, since GitHub scopes it to selected
repositories with Contents read and write as a permission in its own right.

`api.github.com` does answer browser requests, including from `Origin: null`,
which is what a `file://` page sends. So a report opened from disk can commit,
with no server anywhere.

The token lives in `sessionStorage` and nowhere else. It is never written into
the HTML, the configuration, an export, a commit, or `localStorage`.

## Secrets

Anything in Ryker configuration ships inside the report and is readable by
anyone who opens it. A repository owner, a repository name and a client id are
public by design and belong there. A client secret, an app private key or a
token does not, and Ryker refuses to start if it finds one, because by then it
is already exposed and the right response is to rotate it.

Every generated artifact is scanned for credential patterns before it leaves:
the clean HTML, the with-Ryker copy, the journal, and every member of a ZIP. That is
defence in depth, not a substitute for never putting a credential in a report.

## Building

```bash
node build/bundle.mjs
```

Concatenation, on purpose. Each source file assigns onto the `Ryker` namespace
rather than importing, so there is no build dependency, nothing to vendor, and
output anyone can read.

The build refuses to emit when a source file breaks a rule:

- Over 600 lines.
- Missing from, or absent in, the load order.
- Containing a literal control character. Invisible in an editor and harmless in
  an external script, fatal when inlined: the HTML tokenizer rewrites NUL to
  U+FFFD in script data and the script silently never runs. This check exists
  because that bug shipped once during development and cost an hour.
- Containing `</script`, `<script` or `<!--`, which move the tokenizer out of
  script-data state and swallow the rest of the document.

## Layout

```
src/
  bootstrap/   boot and failure isolation
  config/      configuration intake, detection states, identity
  editor/      blocks, sanitiser, contenteditable, save flow
  comments/    anchoring, highlighting, state, selection
  revisions/   journal, diff, review
  storage/     adapter, local, folder, github
  export/      html, zip, packager
  security/    credential scan
  ui/          styles, shadow shell, toolbar, panel, dialogs
  github/      onboarding
build/bundle.mjs
dist/ryker.js
```

## Not in this version

Google Drive and Docs export, pull request workflow, simultaneous multiplayer
editing, a source code editor, and any Ryker-hosted account or storage. The
Google work is scoped separately in
`../.data/sow/_staging/sow-005-ryker-google-docs-export.md`.
