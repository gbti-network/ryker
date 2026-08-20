// The export dialog, for both of the shapes a document can leave in.
//
// This lived inside bootstrap/boot.js until 2026-08-19, when adding the
// Markdown branch pushed that file past its 600 line cap. The cap is doing its
// job here: the dialog is about what a file becomes on the way out, which is
// this folder's subject and was never boot's.
Ryker.exportDialog = (function () {
  'use strict';

  // Spec section 21, restored 2026-08-16.
  //
  // exportHtml.clean() and withRyker() survived the decommission intact and the
  // test suite proves clean() round-trips a document character for character,
  // but the menu that reached them lived in ui/toolbar.js and was deleted with
  // the full build. So a required capability was fully implemented, fully
  // tested, documented in README and named in AGENT.md as the way to verify an
  // install, and reachable by nobody. sow-006 retired comments, revisions and
  // GitHub; it never retired export.
  //
  // Lifted from the deleted toolbar.js with the Journal button dropped, since
  // exportHtml.journalJson() went with the revision journal.
  // What to call the open document in the interface. A file Ryker rendered from
  // Markdown is not a report and is not HTML, and calling it either is how the
  // export dialog came to explain a .md file in terms of tags it does not have.
  function documentWord() {
    return Ryker.config.isMarkdown() ? 'Markdown' : 'report';
  }

  function open() {
    var base = Ryker.exportHtml.baseName();
    var attach = !Ryker.exportHtml.canAttach || Ryker.exportHtml.canAttach();
    var asMarkdown = Ryker.config.isMarkdown() &&
      Ryker.exportMarkdown && Ryker.exportMarkdown.available();
    var body;
    if (asMarkdown) {
      body = '<p><b>Markdown</b> writes your edits back into the file you opened. Every line you ' +
        'did not touch is returned exactly as you wrote it, so the change is reviewable.</p>' +
        '<p><b>HTML</b> is the rendered document instead, for sending to someone who should read ' +
        'it rather than edit it.</p>';
    } else {
      body = '<p><b>Clean HTML</b> is the ' + documentWord() + ' on its own, with Ryker taken ' +
        'out. This is what you send to someone who should read it rather than edit it.</p>';
      if (attach) {
        body += '<p><b>With Ryker</b> keeps the editor attached, so whoever opens it can carry on ' +
          'editing and leave with their own instruction set.</p>';
      } else {
        body += '<p>This extension workspace exports the document on its own. Install the Ryker ' +
          'drop-in in the source file when you need a portable editable copy.</p>';
      }
    }
    var buttons = [{ label: 'Cancel' }];
    if (attach) {
      buttons.push({
        label: 'With Ryker',
        action: function () {
          var o = Ryker.exportHtml.scanned('ryker');
          if (o.hits.length) { Ryker.dialog.leak(o.hits); return; }
          Ryker.exportHtml.download(o.html, base + '-ryker.html');
        }
      });
    }
    if (asMarkdown) {
      buttons.push({
        label: 'HTML',
        action: function () {
          var o = Ryker.exportHtml.scanned('clean');
          if (o.hits.length) { Ryker.dialog.leak(o.hits); return; }
          Ryker.exportHtml.download(o.html, base + '.html');
        }
      });
      buttons.push({
        label: 'Markdown', primary: true,
        action: function () {
          var text = Ryker.exportMarkdown.build();
          var hits = Ryker.scan.text(text, 'Markdown');
          if (hits.length) { Ryker.dialog.leak(hits); return; }
          Ryker.exportHtml.download(text, base + '.md', 'text/markdown;charset=utf-8');
        }
      });
    }
    if (!asMarkdown) {
      buttons.push({
        label: 'Clean HTML', primary: true,
        action: function () {
          var o = Ryker.exportHtml.scanned('clean');
          if (o.hits.length) { Ryker.dialog.leak(o.hits); return; }
          Ryker.exportHtml.download(o.html, base + '.html');
        }
      });
    }
    Ryker.dialog.open({
      title: 'Export',
      body: body,
      buttons: buttons
    });
  }
  return { open: open, documentWord: documentWord };
})();
