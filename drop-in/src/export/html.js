// Producing the document as a file, in the two shapes section 21 asks for.
//
// Every artifact leaving here passes the credential scan first. The spec scans
// packages; a with-Ryker export carries configuration and an offline working
// copy can be exported while GitHub is unreachable, so both would otherwise
// leave without the packager seeing them.
Ryker.exportHtml = (function () {
  'use strict';

  // A clone of the live document with everything Ryker added taken back out.
  // Ryker's chrome lives in one element and its edits live in the report's own
  // markup, so removing the element and the attributes is the whole job.
  function snapshot(keepRyker) {
    var doc = document.documentElement.cloneNode(true);

    // Both of these are rebuilt at boot, so neither is kept in either export.
    // Leaving the stylesheet behind would put Ryker's highlight rules in a file
    // that carries no Ryker.
    ['#ryker-root', '#ryker-document-css'].forEach(function (sel) {
      var n = doc.querySelector(sel);
      if (n && n.parentNode) n.parentNode.removeChild(n);
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
    // export as a stray padding rule with no panel to justify it.
    var exportBody = doc.body || doc.querySelector('body');
    if (exportBody) {
      exportBody.style.removeProperty('padding-left');
      exportBody.style.removeProperty('padding-right');
      // Pre-existing leak: the toolbar's vertical offset shipped in every
      // export as a stray body padding with no toolbar to justify it.
      exportBody.style.removeProperty('padding-top');
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
    // only on collapse. The full build starts collapsed and never set them, so
    // this shipped invisibly; Lite starts expanded, so EVERY Lite export
    // carried them. Found by the fixture harness, 2026-08-16.
    doc.style.removeProperty('--ryker-offset');
    doc.style.removeProperty('scroll-padding-top');
    if (!doc.getAttribute('style')) doc.removeAttribute('style');

    if (!keepRyker) {
      Array.prototype.forEach.call(doc.querySelectorAll('script[data-ryker], #ryker-config, script[src*="ryker"]'), function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
      });
    }

    return '<!DOCTYPE html>\n' + doc.outerHTML;
  }

  function clean() { return snapshot(false); }
  function withRyker() { return snapshot(true); }

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

  function baseName() {
    var p = Ryker.config.load().RYKER_DOCUMENT_PATH || 'report.html';
    return p.replace(/\.html?$/i, '');
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
    download: download, baseName: baseName,
    manifest: manifest
  };
})();
