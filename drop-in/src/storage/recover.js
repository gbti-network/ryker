// Finding work left behind by the build that was decommissioned.
//
// Until 2026-08-16 a second build saved a revision journal into browser storage
// under this document's id. That build is gone and nothing reads the key any
// more, so a report last edited with it would load pristine with previously
// saved edits looking as though they had simply vanished, and nothing saying
// why.
//
// Rather than pretend that cannot happen, this looks for the key directly, says
// what it found, and offers to bring the work across as a starting point. It
// reads and never writes, so declining leaves the stored journal exactly as it
// was.
//
// This is a migration path with an expiry rather than a feature. Once no report
// in circulation has a journal in browser storage, the module and its entry in
// the bundle can go.
Ryker.recover = (function () {
  'use strict';

  function key() {
    return 'ryker:' + Ryker.config.load().RYKER_DOCUMENT_ID + ':journal';
  }

  function seenKey() {
    return 'ryker:' + Ryker.config.load().RYKER_DOCUMENT_ID + ':journal-seen';
  }

  // Keyed on what the journal IS, not just that one was seen. Declining the
  // offer settles this journal; a later one, with more records or a newer
  // timestamp, is a different question and gets asked again.
  function fingerprint(found) {
    return (found.records.length + '@' + (found.savedAt || ''));
  }

  function settled(found) {
    try { return localStorage.getItem(seenKey()) === fingerprint(found); } catch (e) { return false; }
  }

  function settle(found) {
    try { localStorage.setItem(seenKey(), fingerprint(found)); } catch (e) {}
  }

  // Called when the document is cleared. Someone who has just thrown away every
  // edit this session does not want the same edits offered back on reload.
  function dismiss() {
    var found = stored();
    if (found) settle(found);
  }

  function stored() {
    var raw;
    try { raw = localStorage.getItem(key()); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      var records = (parsed && parsed.records) || [];
      return records.length ? { records: records, savedAt: parsed.savedAt } : null;
    } catch (e) { return null; }
  }

  function countBlocks(records) {
    var ids = {};
    records.forEach(function (r) {
      (r.changes || []).forEach(function (c) { ids[c.id] = true; });
    });
    return Object.keys(ids).length;
  }

  function offer() {
    var found = stored();
    if (!found) return false;

    var blocks = countBlocks(found.records);
    if (!blocks) return false;
    if (settled(found)) return false;

    var d = Ryker.dom;
    Ryker.dialog.open({
      title: 'Bring in earlier edits?',
      body: d.el('div', {}, [
        d.el('p', {
          text: blocks + ' block(s) were edited here earlier' +
            (found.savedAt ? ', on ' + d.fmtDate(found.savedAt) : '') +
            ', and are still in this browser.'
        }),
        d.el('p', { class: 'muted', text: 'Nothing is deleted either way.' })
      ]),
      buttons: [
        { label: 'Cancel', action: function () { settle(found); } },
        { label: 'Restore', primary: true, action: function () {
            settle(found);
            apply(found.records);
          } }
      ]
    });
    return true;
  }

  // Applied on top of the pristine document, then recorded as one save, so every
  // instruction still quotes the document as authored.
  function apply(records) {
    var before = Ryker.blocks.snapshot();
    var out = Ryker.blocks.applyRecords(records);
    var changes = Ryker.blocks.diffSnapshots(before, Ryker.blocks.snapshot());

    if (!changes.length) {
      Ryker.dialog.alert('Nothing to bring in',
        'Those revisions are already reflected in this document.', 'ok');
      return;
    }

    Ryker.instructions.record();
    Ryker.editable.rebase();
    Ryker.pane.refresh(true);
    if (!Ryker.pane.isOpen()) Ryker.pane.toggle();
    Ryker.boot.sync();

    Ryker.dialog.alert('Edits restored',
      changes.length + ' block(s) applied and folded into the instructions.' +
      (out.missed ? ' ' + out.missed + ' change(s) could not be placed in this document and were skipped.' : ''),
      out.missed ? 'warn' : 'ok');
  }

  return { offer: offer, apply: apply, stored: stored, key: key, dismiss: dismiss };
})();
