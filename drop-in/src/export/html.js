// Producing the document as a file, in the two shapes section 21 asks for.
//
// Every artifact leaving here passes the credential scan first. The spec scans
// packages; a with-Ryker export carries configuration and an offline working
// copy can be exported while GitHub is unreachable, so both would otherwise
// leave without the packager seeing them.
Ryker.exportHtml = (function () {
  'use strict';

  function isWorkspace() {
    return Ryker.SURFACE === 'extension' &&
      !!document.getElementById('workspace-document') &&
      document.body.classList.contains('workspace-loaded');
  }

  function sourceDocumentClone() {
    if (!isWorkspace()) return document.documentElement.cloneNode(true);

    // The workspace is extension chrome around an uploaded document. HTML
    // uploads retain a sanitised clone of their authored document shell so safe
    // title/meta/html/body metadata and comments survive; Markdown deliberately
    // uses the small default shell below.
    var supplied = window.RykerWorkspace &&
      typeof window.RykerWorkspace.sourceShell === 'function'
      ? window.RykerWorkspace.sourceShell() : null;
    if (supplied) {
      var suppliedBody = supplied.querySelector('body');
      if (!suppliedBody) throw new Error('The uploaded HTML document has no exportable body.');
      suppliedBody.innerHTML = document.getElementById('workspace-document').innerHTML;
      return supplied;
    }

    var clean = document.implementation.createHTMLDocument(
      Ryker.config.load().RYKER_DOCUMENT_PATH || document.title || 'Ryker document');
    clean.documentElement.setAttribute('lang', document.documentElement.lang || 'en');
    clean.head.insertBefore(clean.createElement('meta'), clean.head.firstChild);
    clean.head.firstChild.setAttribute('charset', 'utf-8');
    clean.body.innerHTML = document.getElementById('workspace-document').innerHTML;
    return clean.documentElement;
  }

  // A clone of the live document with everything Ryker added taken back out.
  // Ryker's chrome lives in one element and its edits live in the report's own
  // markup, so removing the element and the attributes is the whole job.
  function prepared(keepRyker) {
    var doc = sourceDocumentClone();

    // Both of these are rebuilt at boot, so neither is kept in either export.
    // Leaving the stylesheet behind would put Ryker's highlight rules in a file
    // that carries no Ryker.
    var owner = Ryker.shell && Ryker.shell.owner ? Ryker.shell.owner() : null;
    var owned = owner ? '[data-ryker-owner="' + owner.replace(/"/g, '') + '"]' : null;
    [owned].forEach(function (sel) {
      if (!sel) return;
      var n = doc.querySelector(sel);
      while (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
        n = doc.querySelector(sel);
      }
    });

    Array.prototype.forEach.call(doc.querySelectorAll('[contenteditable]'), function (n) {
      n.removeAttribute('contenteditable');
      n.removeAttribute('spellcheck');
    });
    Array.prototype.forEach.call(doc.querySelectorAll('.ryker-editing, .ryker-dirty, .ryker-pick'), function (n) {
      n.classList.remove('ryker-editing');
      n.classList.remove('ryker-dirty');
      n.classList.remove('ryker-pick');
      if (!n.getAttribute('class')) n.removeAttribute('class');
    });
    // The <mark> fallback wraps report content, so it has to be unwrapped
    // rather than deleted or the words inside it would be lost.
    Array.prototype.forEach.call(doc.querySelectorAll('mark.ryker-mark'), function (n) {
      while (n.firstChild) n.parentNode.insertBefore(n.firstChild, n);
      n.parentNode.removeChild(n);
    });
    // The reserved space is inline on body and would otherwise ship in the
    // export as a stray padding rule with no panel to justify it. Restore the
    // authored inline declaration, including !important, when the live shell
    // remembers one instead of erasing it with Ryker's temporary value.
    var exportBody = doc.body || doc.querySelector('body');
    if (exportBody) {
      ['padding-left', 'padding-right', 'padding-top'].forEach(function (prop) {
        var authored = Ryker.shell && Ryker.shell.originalBodyPadding
          ? Ryker.shell.originalBodyPadding(prop) : null;
        // Remembering a property is the ONLY evidence Ryker claimed it. The
        // data-ryker-pushed attribute is one flag on body covering all three
        // sides, so consulting it per property made an open pane on the right
        // erase an authored padding-left the rail never touched. A property
        // Ryker did not claim is the page's own and must ship untouched.
        if (!authored) return;
        if (authored.value) {
          exportBody.style.setProperty(prop, authored.value, authored.priority || '');
        } else {
          exportBody.style.removeProperty(prop);
        }
      });
      if (exportBody.className === '') exportBody.removeAttribute('class');
      exportBody.removeAttribute('data-ryker-rail');
      exportBody.removeAttribute('data-ryker-pushed');
      if (!exportBody.getAttribute('style')) exportBody.removeAttribute('style');
    }
    Array.prototype.forEach.call(doc.querySelectorAll('[data-ryker-offset]'), function (n) {
      n.removeAttribute('data-ryker-offset');
      n.style.removeProperty('top');
      if (!n.getAttribute('style')) n.removeAttribute('style');
    });
    // Same leak a third time, on the element the clone IS rather than one it
    // contains, so neither the body pass above nor the querySelectorAll below
    // could ever have reached it. shell.js sets both of these on
    // documentElement when the toolbar claims vertical space, and releases them
    // only on collapse. The build that has since been decommissioned started
    // collapsed and never set them, so this shipped invisibly for months; the
    // surviving build starts expanded, so every export carried them. Found by
    // the fixture harness on its first run, 2026-08-16.
    doc.style.removeProperty('--ryker-offset');
    doc.style.removeProperty('scroll-padding-top');
    if (!doc.getAttribute('style')) doc.removeAttribute('style');

    if (!keepRyker) {
      Array.prototype.forEach.call(doc.querySelectorAll('script[data-ryker], #ryker-config, script[src*="ryker"]'), function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
      });
    }

    return doc;
  }

  // The Markdown source map the workspace stamps on a document it rendered from
  // Markdown. It exists so an export can put back the authored bytes and so an
  // instruction can quote text the reader can actually find. It is Ryker's own
  // bookkeeping and belongs in no file that leaves here.
  //
  // Stripped on the way OUT rather than inside prepared(), because
  // exportMarkdown walks the same cleaned document and the map is the whole
  // reason it can. Removing it earlier would leave that caller with nothing to
  // read and no error to explain why.
  function stripMarkdownMap(doc) {
    Array.prototype.forEach.call(
      doc.querySelectorAll('[data-ryker-md-src], [data-ryker-md-from]'), function (n) {
        n.removeAttribute('data-ryker-md-src');
        n.removeAttribute('data-ryker-md-from');
        n.removeAttribute('data-ryker-md-to');
      });
    return doc;
  }

  // The cleaned document as a node, for callers that need to walk it rather
  // than ship it. exportMarkdown builds from this so it sees exactly what a
  // clean HTML export would, minus the map, which it still needs.
  function snapshotDoc(keepRyker) { return prepared(keepRyker); }

  function snapshot(keepRyker) {
    return '<!DOCTYPE html>\n' + stripMarkdownMap(prepared(keepRyker)).outerHTML;
  }

  function clean() { return snapshot(false); }
  function canAttach() { return !isWorkspace(); }
  function withRyker() {
    if (!canAttach()) {
      throw new Error('With Ryker export is unavailable for extension workspace uploads. ' +
        'Install the drop-in in the source file to create a portable editable copy.');
    }
    return snapshot(true);
  }

  // Returns { html, hits }. A caller that ignores hits is a bug, so the scan
  // result travels with the content rather than being a separate call someone
  // can forget.
  function scanned(kind) {
    var html = kind === 'clean' ? clean() : withRyker();
    return { html: html, hits: Ryker.scan.text(html, kind === 'clean' ? 'clean HTML' : 'with Ryker') };
  }

  function download(text, filename, mime) {
    var blob = new Blob([text], { type: mime || 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // Every extension Ryker will open, not just the HTML ones. Stripping only
  // /\.html?$/ left `notes.md` whole, so the workspace offered `notes.md.html`
  // as the filename for its own export.
  function baseName() {
    var p = Ryker.config.load().RYKER_DOCUMENT_PATH || 'report.html';
    return p.replace(/\.(html?|md|markdown)$/i, '');
  }

  function manifest(files) {
    var cfg = Ryker.config.load();
    return JSON.stringify({
      packageVersion: 1,
      rykerVersion: Ryker.VERSION,
      sourceDocument: cfg.RYKER_DOCUMENT_PATH,
      documentId: cfg.RYKER_DOCUMENT_ID,
      createdAt: Ryker.dom.now(),
      files: files.map(function (f) {
        return { name: f.name, bytes: f.bytes, crc32: f.crc32 };
      })
    }, null, 2);
  }

  return {
    clean: clean, withRyker: withRyker, scanned: scanned,
    canAttach: canAttach, snapshotDoc: snapshotDoc,
    download: download, baseName: baseName,
    manifest: manifest
  };
})();
