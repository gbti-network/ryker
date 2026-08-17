# Ryker

Ryker adds inline editing to authored HTML and produces prompt-ready,
machine-readable change requests.

## Install into an HTML document

```bash
npx --yes @gbti/ryker@next insert ./report.html
```

Preview first with `--dry-run`. The installer creates a recoverable
`report.html.ryker-backup`, copies the dependency-free browser bundle beside the
document, and adds one identifiable managed block before `</body>`.

```bash
npx ryker doctor ./report.html
npx ryker sync ./report.html
npx ryker remove ./report.html
```

Ryker requires Node.js 20 or newer for installation. The resulting HTML and
classic browser script work offline and from `file://` without Node.js.

## License

Ryker is source-available under the custom license included with the package.
Internal-team use, internal commercial use and inclusion with client
deliverables are permitted. Ryker, its forks and its derivatives may not be
sold or shipped or featured as part of a commercial product or software as a
service offering without prior written permission from GETHSEMANE LLC. The
license and copyright notice must remain intact.

This package is not published yet. The `@next` command above becomes available
after the first release candidate is published. The `@latest` tag is reserved
for a release that has passed public-package acceptance testing.
