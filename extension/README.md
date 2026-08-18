# Ryker Chrome extension

Ryker adds inline editing to HTML and Markdown surfaces and makes user changes
exportable as prompt-ready, machine-readable change requests.

This is the unpacked development build for sow-007. It has no standing access
to pages and injects nothing until the Ryker toolbar action is clicked.

## Build

From the repository root:

```powershell
node drop-in/build/bundle.mjs
```

The build writes the shared source modules to `extension/ryker.js`. Do not edit
that generated file directly.

## Load unpacked

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked**.
4. Select this `extension` directory.
5. For the disposable fixture, run `node test/serve.mjs` from the repository
   root and open `http://127.0.0.1:8765/report.html`.
6. Pin Ryker and click the Ryker action.

The badge reads `ON` after the toolbar mounts. On Chrome-owned pages where
injection is prohibited, including New Tab, the action migrates that tab to
Ryker's local-document workspace instead.

The extension icon lives under `icons/` in the Ryker brand color `#e5383b`.

Click the toolbar icon once to open Ryker and again to close it. Closing removes
Ryker's chrome and editability from the page but retains the current in-memory
session; clicking again resumes the same unsaved work.

Reloading the unpacked extension while Ryker is open no longer strands the old
page-side bundle. The next toolbar click closes and retires that stale session;
the following click loads the current bundle without requiring a page refresh.

## Local documents

Click Ryker from Chrome's New Tab page to open the extension-owned document
workspace in that tab. Choose or drag in an `.html`, `.htm`, `.md`, or
`.markdown` file. HTML is stripped of scripts, event handlers and layout styles
before it becomes editable. Markdown is rendered into semantic headings,
paragraphs, lists, block quotes and fenced code. The normal Ryker toolbar then
replaces the workspace header and the rendered document becomes the editing
surface.

An uploaded document is identified by its filename and a content hash, keeping
its change requests separate from pages edited by URL.

## Outline scope

On article pages, Ryker starts in **Article** scope when it finds a credible
semantic article. The outline follows the visible heading hierarchy inside that
article and includes a title placed immediately outside the `<article>` element.
Use **Full page** in the outline rail when the change request concerns the page
template rather than the article alone. Headings outside Ryker's editable
content remain navigation-only and cannot be moved or deleted.

## Save comments

Saving an edited round opens a small context dialog by default. The comment is
optional: choose **Save with comment** to attach the note to that save round, or
**Save without comment** to continue immediately. Comments appear in the
instruction artifact and revision record so a later reviewer or agent can see
why that round of changes was made.

Use the toolbar's ellipsis menu and choose **Disable save comments** when the
extra prompt is not useful. The menu changes to **Enable save comments** while
the feature is off, and the preference persists across extension sessions.
Disabling the prompt does not remove notes already attached to earlier rounds.

## Formatting and saved change requests

Select text within one editable block to open the floating formatting toolbar.
Its first control changes that block between **Paragraph** and **H1** through
**H5**. The conversion keeps the content and attributes, supports undo/redo,
and is represented in instructions as an HTML element-name change.

The instruction sidebar is the live artifact for the current tab. **Saved
change requests** are durable JSON records written on each save to
extension-owned storage in this browser. No folder grant is required, the
visited page cannot read the records, and Ryker does not transmit them. Each
record can include document identity and title, source and edited content,
structural changes, and an optional save comment.

Use **More → Saved change requests...** to review, merge, download, or clear
that cross-session history. Records remain until you clear them, remove the
extension, or clear its browser data; this release does not expire them
automatically. A downloaded record can be supplied deliberately to an agent or
used as editing or voice-training context, but no export or training use occurs
without the user's explicit action.

After pulling or rebuilding changes, click **Reload** for Ryker on
`chrome://extensions`, then refresh the article tab before testing again.
See `icons/README.md` for the visual-reference and generation note.

## What Ryker stores

Ryker keeps an editing history in this browser. That history includes the page
content it was given, the before and after of every edit, the structural changes
such as block moves and tag conversions, the document's identity as origin plus
path, and any save comments you choose to write.

It is kept so you can restore unsaved work after a reload, review what changed
across sessions, merge a set of change requests, export them, and, if you want
to, hand the corpus to your own AI tools as editing or voice-training context.

Three facts about where it lives:

- **It belongs to the extension, not to the site you are editing.** The records
  sit in an IndexedDB database owned by Ryker's own extension origin. The page
  cannot read them, and Ryker creates no database, no localStorage key and no
  sessionStorage key on the site you visit.
- **Nothing leaves the machine.** Ryker makes no network request. Nothing is
  sent to GETHSEMANE LLC or to any third party, and there is no account, no
  telemetry and no sync. An export happens only when you ask for one, and it is
  a download to your own disk.
- **You decide when it goes.** Nothing is pruned automatically, because the
  records are often the only durable copy of what changed. The saved change
  request browser reports how much of the browser's local allowance Ryker is
  using and warns you before it runs short. Clearing is per document and offers
  the export first. Removing the extension or clearing its browser data removes
  everything.

Capture is on by default. There is no switch to turn it off, because a history
that is sometimes recording is worse than one that always is: you would find out
which mode you were in only when you needed a record that was never written.
Per-document clear is the control.

## Clearing data from development builds

Builds before the extension-owned store wrote some Ryker state into the visited
site's own storage. The current build never does, but it deliberately does not
delete what an older build left behind, because that namespace belongs to the
site rather than to Ryker. Removing it is a manual step:

1. Open the site in a tab and open DevTools.
2. Under **Application**, then **Storage**, delete any IndexedDB database named
   `ryker` and any localStorage or sessionStorage key beginning `ryker:`.
3. If an older build was granted a folder through the directory picker, revoke
   it under **Application**, then **Permissions**, or from the padlock in the
   address bar.

To clear the current build's own data instead, use the per-document clear inside
the saved change request browser, or remove the extension.

## Current phase boundary

This remains a development build. It now includes reversible toolbar
activation, article/full-page outline scopes, revision logging and optional
save-round context, but arbitrary pages can still expose site-specific editing
edge cases. Use disposable or recoverable content for manual editing tests.
