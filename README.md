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
npx --yes @gbti/ryker@next doctor ./report.html
npx --yes @gbti/ryker@next sync ./report.html
npx --yes @gbti/ryker@next remove ./report.html
```

`remove` deletes the managed block from that document and retains the browser
bundle because other documents in the same folder may share it.

Ryker requires Node.js 20 or newer for installation. The resulting HTML and
classic browser script work offline and from `file://` without Node.js.

## License

Ryker is source-available under the custom license included with the package.
Internal-team use, internal commercial use and inclusion with client
deliverables are permitted. Ryker, its forks and its derivatives may not be
sold or shipped or featured as part of a commercial product or software as a
service offering without prior written permission from GETHSEMANE LLC. The
license and copyright notice must remain intact.

Version `0.1.1` is the current release on npm's default `latest` tag, so a
plain install gets it. It supersedes the `0.1.1-rc.1` candidate.
