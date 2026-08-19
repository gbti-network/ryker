# Ryker Privacy Policy

**Last updated: 18 August 2026**

Ryker is a browser extension published by Gethsemane LLC, operating as GBTI.

## The short version

Ryker does not send your data anywhere. It has no server, no account, no sync and no telemetry.
Everything it records stays in your own browser until you remove it.

## What Ryker records

Ryker keeps an editing history in your browser so you can restore unsaved work after a reload,
review what changed across sessions, merge change requests, and export them. That history includes:

- the content of the page you are editing
- the before and after text of every edit
- structural changes, such as moving a block or changing a heading level
- the document's identity, recorded as its origin and path
- any save comments you choose to write

## Where it is kept

In an IndexedDB database owned by Ryker's own extension origin, not by the site you are editing. The
page you are on cannot read it. Ryker creates no database, no localStorage entry and no
sessionStorage entry on the sites you visit.

## What is sent, and to whom

Nothing. There is no server to send it to. Nothing is transmitted to Gethsemane LLC or to any third
party, and no analytics or crash reporting is included.

Ryker makes one kind of network request, and only when you ask it to package a report for download:
it reads that page's own assets, such as its images and stylesheets, by their existing URLs, so it
can place them inside the ZIP file you are downloading. Those are requests the page already makes to
its own origin. Nothing leaves your machine as a result.

Exports and downloads happen only when you ask for them, and they go to your own disk.

## How long it is kept, and how to remove it

Nothing is deleted automatically, because these records are often the only durable copy of what you
changed. You control removal:

- Clearing is offered per document, and offers you an export first.
- The saved change request browser shows how much of your browser's local storage allowance Ryker is
  using, and warns you before it runs short.
- Removing the extension, or clearing its browser data, removes everything.

Recording is on by default and there is no switch to disable it, because a history that is sometimes
recording is worse than one that always is: you would discover which mode you were in only when you
needed a record that was never written. Per-document clearing is the control.

## Permissions

Ryker requests two Chrome permissions:

- **activeTab**, which gives it access to the page you are on only after you click the Ryker toolbar
  button on that tab. It cannot read tabs you have not activated it on.
- **scripting**, which is what allows it to place the editor into that page.

It requests no host permissions, so it has no standing access to any website.

## Children

Ryker is a developer and writing tool and is not directed at children.

## Changes to this policy

Any change will be posted at this URL with an updated date. Because Ryker stores nothing off your
device, a change here cannot retroactively affect data already collected: there is none.

## Contact

Questions about this policy: https://gbti.network/contact/
