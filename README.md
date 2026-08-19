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

## Privacy

The Chrome extension keeps its editing history in your own browser and sends
nothing anywhere: no server, no account, no sync, no telemetry.
[privacy.md](privacy.md) is the full policy, and is the URL the Chrome Web Store
listing points at.

## License

Ryker is source-available under the custom license included with the package.
Internal-team use, internal commercial use and inclusion with client
deliverables are permitted. Ryker, its forks and its derivatives may not be
sold or shipped or featured as part of a commercial product or software as a
service offering without prior written permission from GETHSEMANE LLC. The
license and copyright notice must remain intact.

This repository is at version `0.2.0`. npm's default `latest` tag still
serves `0.1.1-rc.1`, because nothing newer has been published yet, so a plain
install gets the candidate rather than this code.

## Credits

Wing icon by [prasong tadoungsorn](https://thenounproject.com/creator/layersky/) from
[Noun Project](https://thenounproject.com/icon/wing-1382909/), licensed
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
