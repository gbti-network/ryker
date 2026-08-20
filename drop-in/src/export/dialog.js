// The two ways a document leaves Ryker: over the top of itself, or beside it.
//
// This lived inside bootstrap/boot.js until 2026-08-19, when adding the
// Markdown branch pushed that file past its 600 line cap. The cap is doing its
// job here: the dialog is about what a file becomes on the way out, which is
// this folder's subject and was never boot's.
//
// RENAMED FROM "Export" ON 2026-08-20, because the old name hid a real
// difference behind one word. Every button in this file used to end at
// exportHtml.download(), a blob and an anchor click, while the Markdown copy
// told the reader it "writes your edits back into the file you opened". That
// sentence described the diff and named a destination it did not write to:
// untouched lines really do come back byte for byte, and the file on disk was
// really never touched. Two verbs fix what one could not:
//
//   Save Document      overwrite the opened file, on confirmation
//   Save Document As   a new file beside it, which is what always happened
Ryker.exportDialog = (function () {
  'use strict';

  // What to call the open document in the interface. A file Ryker rendered from
  // Markdown is not a report and is not HTML, and calling it either is how the
  // export dialog came to explain a .md file in terms of tags it does not have.
  function documentWord() {
    return Ryker.config.isMarkdown() ? 'Markdown' : 'report';
  }

  /** True when the surface handed Ryker a writable document. Only the extension
   *  workspace does; a drop-in page is the document and holds no handle to
   *  itself, so Save Document never appears there. */
  function canSave() {
    return !!(Ryker.saveTarget && Ryker.saveTarget.available());
  }

  /** The bytes to write, in the format the document was authored in. Markdown
   *  round-trips through the source map so untouched lines survive; anything
   *  else is the cleaned document with Ryker taken out. */
  function contents() {
    var asMarkdown = Ryker.config.isMarkdown() &&
      Ryker.exportMarkdown && Ryker.exportMarkdown.available();
    if (asMarkdown) {
      var text = Ryker.exportMarkdown.build();
      return { text: text, hits: Ryker.scan.text(text, 'Markdown') };
    }
    var o = Ryker.exportHtml.scanned('clean');
    return { text: o.html, hits: o.hits };
  }

  // SAVE DOCUMENT. The confirmation is not a formality and is not skippable:
  // this is the only action in Ryker that destroys something the user did not
  // create in Ryker. It names the file, says the word overwrite, and puts the
  // consequence in the button rather than leaving "Continue" to carry it.
  function save() {
    if (!canSave()) {
      Ryker.dialog.alert('Save Document',
        '<p>This document was not opened from a file Ryker can write to, so there is ' +
        'nothing to overwrite. Use <b>Save Document As</b> to write a new file.</p>');
      return;
    }
    var name = Ryker.saveTarget.name();
    var safe = Ryker.dom.escapeHtml(name);
    Ryker.dialog.open({
      title: 'Save Document',
      body: '<div class="note bad">This overwrites <b>' + safe + '</b> on your disk with every ' +
        'change from this session.</div>' +
        '<p>The file is replaced where it sits. Ryker keeps no copy of what it held before, ' +
        'so take one yourself if you need it.</p>' +
        '<p>To keep the original and write a new file beside it, cancel and use ' +
        '<b>Save Document As</b>.</p>',
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Overwrite ' + name, danger: true,
          action: function () {
            // Built before the write so a credential stops the save without
            // having already asked for a permission it will not use.
            var out;
            try { out = contents(); }
            catch (error) { reportFailure(error); return; }
            if (out.hits.length) { Ryker.dialog.leak(out.hits); return; }
            // The grant needs a user gesture and this click is the last one
            // there will be, so it is requested here rather than at open.
            Ryker.saveTarget.ensureWritable().then(function (state) {
              // A dismissed permission dialog is not a refusal. Chrome leaves
              // the grant in 'prompt' when it is closed with Escape or a click
              // away, and treating that as denial would retire the target and
              // cost the person their Save Document over a stray keystroke.
              if (state === 'prompt') {
                Ryker.dialog.open({
                  title: 'Not saved',
                  body: '<div class="note bad">Ryker was not given permission to write to <b>' +
                    safe + '</b> this time.</div>' +
                    '<p>The file on disk is unchanged. Choose <b>Save Document</b> again to ask ' +
                    'for it.</p>'
                });
                return null;
              }
              if (state !== 'granted' && state !== true) {
                throw new Error('Ryker was not given permission to write to ' + name + '.');
              }
              return Ryker.saveTarget.write(out.text).then(function (written) {
                Ryker.dialog.alert('Saved',
                  '<p><b>' + Ryker.dom.escapeHtml(written) + '</b> now holds every change from ' +
                  'this session.</p>', 'ok');
              });
            }).catch(reportFailure);
          }
        }
      ]
    });
  }

  function reportFailure(error) {
    var message = (error && error.message) ? error.message : String(error);
    // A revoked or expired grant must not leave a Save Document in the menu
    // that cannot work. The surface re-registers when the file is reopened.
    if (/permission|not allowed|NotAllowed|SecurityError/i.test(message)) {
      Ryker.saveTarget.clear();
    }
    // dialog.open rather than dialog.alert: alert() wraps its body in a styled
    // .note of its own, so a .note bad inside it draws a red box inside an
    // accent box. leak() and boot.js use open() for the same reason.
    Ryker.dialog.open({
      title: 'Not saved',
      body: '<div class="note bad">' + Ryker.dom.escapeHtml(message) + '</div>' +
        '<p>The file on disk is unchanged.</p>'
    });
  }

  // SAVE DOCUMENT AS. Every branch here writes a NEW file through the browser's
  // download, which is what "Export" always did. The copy now says so.
  function saveAs() {
    var base = Ryker.exportHtml.baseName();
    var attach = !Ryker.exportHtml.canAttach || Ryker.exportHtml.canAttach();
    var asMarkdown = Ryker.config.isMarkdown() &&
      Ryker.exportMarkdown && Ryker.exportMarkdown.available();
    var body;
    if (asMarkdown) {
      body = '<p><b>Markdown</b> downloads a new <code>.md</code> file. Every line you did not ' +
        'touch is written exactly as you wrote it, so the change is reviewable.</p>' +
        '<p><b>HTML</b> downloads the rendered document instead, for sending to someone who ' +
        'should read it rather than edit it.</p>';
    } else {
      body = '<p><b>Clean HTML</b> downloads the ' + documentWord() + ' on its own, with Ryker ' +
        'taken out. This is what you send to someone who should read it rather than edit it.</p>';
      if (attach) {
        body += '<p><b>With Ryker</b> keeps the editor attached, so whoever opens it can carry on ' +
          'editing and leave with their own instruction set.</p>';
      } else {
        body += '<p>This extension workspace exports the document on its own. Install the Ryker ' +
          'drop-in in the source file when you need a portable editable copy.</p>';
      }
    }
    // Said once, here, rather than implied by a verb. The whole defect this
    // rename addresses was a reader believing a download had replaced a file.
    body += canSave()
      ? '<p>None of these touch <b>' + Ryker.dom.escapeHtml(Ryker.saveTarget.name()) +
        '</b>. Use <b>Save Document</b> to overwrite it.</p>'
      : '<p>Your original file is left where it is.</p>';

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
      title: 'Save Document As',
      body: body,
      buttons: buttons
    });
  }

  return {
    open: saveAs, saveAs: saveAs, save: save,
    canSave: canSave, documentWord: documentWord
  };
})();
