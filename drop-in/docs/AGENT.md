# Including Ryker in a report you are generating

Written for an agent building an HTML report, so that "include Ryker in
this report" is a routine instruction rather than a bespoke integration.

## The instruction

> Create the report as standalone HTML. Include Ryker using the standard
> integration. Configure the Ryker document id as `<some-stable-id>`. Preserve
> all assets using relative paths.

## What to add

Exactly three lines, immediately before `</body>`, after any script the report
already has:

```html
<script type="application/json" id="ryker-config">
{"RYKER_DOCUMENT_ID":"woo-placement-current-audit","RYKER_DOCUMENT_PATH":"report.html"}
</script>
<script src="ryker.config.js"></script>
<script src="ryker/dist/ryker.js" data-ryker></script>
```

Copy `dist/ryker.js` into `ryker/dist/` beside the report, and write a
`ryker.config.js` next to it. If the report is a one-off with no shared
settings, drop the middle line and put everything in the inline block.

There is one bundle. A second, larger build carrying comments, a revision
journal and a GitHub backend existed until 2026-08-16 and was decommissioned;
if you find a reference to `ryker-lite.js` anywhere, it predates that and the
file it names is `ryker.js`.

## Rules

**Put the tag in `<body>`, not in `<head>`, and not inside `<main>`.** Ryker
treats `main` as the report and everything in it as potentially editable.

**Set a document id that does not depend on the filename.** Comments and
revisions are keyed to it. Renaming `report.html` must not orphan them.

**Keep element ids stable.** An instruction locates a block by its quoted text
and cross-checks the position, which is expressed as "the 3rd `<p>` inside the
section with id=rationale". Renaming an id after instructions have been written
does not break them, since the quoted text is the key, but it does make the
cross-check point at nothing.

**Mark anything that must not be edited.** Ryker already excludes `svg`, `nav`,
`header`, `footer`, elements carrying `data-effort`, `data-sort`, `data-group`
or `data-impact`, and any block containing another block. For anything else, add
`data-ryker-lock` to the element or an ancestor.

```html
<p data-ryker-lock>Generated on 2026-08-13. Do not edit.</p>
```

Those four attributes are read differently on table structure. On `table`,
`thead`, `tbody`, `tfoot`, `tr`, `colgroup` or `col` they say how the container
behaves rather than what any one cell means, so the cells beneath them stay
editable: the sort or filter key is the attribute your script reads, and
rewording a cell does not change it. Put the attribute on the `<td>` or `<th>`
itself when that cell's text is the key. To lock a whole table, give the
`<table>` a `data-ryker-lock`.

**Keep report UI out of editable regions.** If the report has its own controls,
filters or navigation inside `main`, give them `data-ryker-lock`.

**Use relative paths for assets.** The packager and the export both rely on it.

## Configuration values

Public, and fine to ship inside the report:

```
RYKER_ENABLED    RYKER_DOCUMENT_ID    RYKER_DOCUMENT_PATH
```

The `RYKER_GITHUB_*` and `RYKER_GOOGLE_*` keys are still read by
`config/config.js` but nothing acts on them, because the backend that did was
decommissioned. Do not set them.

Never, under any circumstances, in a report:

```
client secrets    app private keys    access tokens
refresh tokens    service account credentials
```

Ryker refuses to start if it finds one, because by the time it is in the
configuration it has already shipped.

## If the report is self-contained

When the report inlines its images and datasets as data URIs, inline Ryker the
same way: replace the `<script src>` with an inline `<script data-ryker>` and the
file's contents. Two things will break it if you do this by hand:

- A literal control character anywhere in the code. The HTML tokenizer rewrites
  NUL to U+FFFD in script data and the script silently never runs, with no error.
- The sequences `</script`, `<script` or `<!--` in the code, which end or escape
  the script element early.

`dist/ryker.js` is checked for both at build time, so inlining the shipped
bundle is safe. Anything you add around it is not automatically safe.

## Checking it worked

Open the report. Ryker opens expanded, with editing on and the instruction pane
showing, because the pane is the point of the tool rather than something to go
and find. The toolbar reads "Nothing is saved anywhere" until you give it a
folder. Then confirm the report itself is untouched:

- Its own scripts still work: sorting, filtering, lightboxes.
- Printing produces the same page count as before. Ryker sets itself to
  `display: none` in print, so the PDF should be identical.
- Exporting the clean HTML gives back the file you started with. That is the
  strongest check available and it is what the test suite asserts, character for
  character, against `test/fixtures/report.html`.
