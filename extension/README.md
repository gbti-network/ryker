# Ryker Chrome extension

Ryker adds inline editing to html and markdown files where user changes are
either saved directly to the loaded asset or made exportable as a prompt-ready
machine-readable change request.

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
injection is prohibited—including New Tab—the action migrates that tab to
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
change requests** are the durable JSON copies written to the granted folder on
each save. Use **More → Saved change requests…** to review, merge, export, or
clear that cross-session history. URL-based documents use a stable,
filesystem-safe directory key, and the browser waits for any save still being
written before it lists the records.

After pulling or rebuilding changes, click **Reload** for Ryker on
`chrome://extensions`, then refresh the article tab before testing again.
See `icons/README.md` for the visual-reference and generation note.

## Current phase boundary

This remains a development build. It now includes reversible toolbar
activation, article/full-page outline scopes, revision logging and optional
save-round context, but arbitrary pages can still expose site-specific editing
edge cases. Use disposable or recoverable content for manual editing tests.
