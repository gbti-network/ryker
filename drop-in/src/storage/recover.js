// Refresh recovery for the current editor, plus import of the retired journal.
Ryker.recover = (function () {
  'use strict';

  var timer = null;
  var applying = false;
  var offered = false;

  function documentKey() {
    return Ryker.logger.documentKey(Ryker.config.load().RYKER_DOCUMENT_ID);
  }

  function draftKey() { return 'ryker:draft:' + documentKey(); }
  function seenKey() { return 'ryker:recovery-seen:' + documentKey(); }
  function legacyKey() { return 'ryker:' + Ryker.config.load().RYKER_DOCUMENT_ID + ':journal'; }

  function extensionStore() {
    return Ryker.SURFACE === 'extension' && typeof chrome !== 'undefined' &&
      chrome.storage && chrome.storage.local;
  }

  function get(key) {
    if (extensionStore()) {
      return chrome.storage.local.get(key).then(function (out) { return out && out[key] || null; });
    }
    try { return Promise.resolve(localStorage.getItem(key)); }
    catch (e) { return Promise.resolve(null); }
  }

  function set(key, value) {
    if (extensionStore()) {
      var item = {}; item[key] = value;
      return chrome.storage.local.set(item).then(function () { return true; });
    }
    try { localStorage.setItem(key, value); return Promise.resolve(true); }
    catch (e) { return Promise.resolve(false); }
  }

  function remove(key) {
    if (extensionStore()) return chrome.storage.local.remove(key).then(function () { return true; });
    try { localStorage.removeItem(key); return Promise.resolve(true); }
    catch (e) { return Promise.resolve(false); }
  }

  function parse(raw) {
    if (!raw) return null;
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch (e) { return null; }
  }

  function fingerprint(found) {
    return found.kind + '@' + found.baselineId + '@' + found.savedAt + '@' + found.changes.length;
  }

  function checkpoint() {
    if (applying) return Promise.resolve(false);
    var changes = Ryker.instructions.recoveryChanges();
    if (!changes.length) return remove(draftKey());
    var draft = {
      version: 1, kind: 'draft',
      documentId: Ryker.config.load().RYKER_DOCUMENT_ID,
      baselineId: Ryker.instructions.baselineId(),
      savedAt: new Date().toISOString(), changes: changes
    };
    return set(draftKey(), JSON.stringify(draft));
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(checkpoint, 180);
  }

  function init() {
    Ryker.editable.onChange(schedule);
    Ryker.instructions.onChange(schedule);
    window.addEventListener('pagehide', checkpoint);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') checkpoint();
    });
  }

  function compatible(found) {
    return found && found.baselineId &&
      found.baselineId === Ryker.instructions.baselineId() &&
      Array.isArray(found.changes) && found.changes.length;
  }

  function draft() {
    return get(draftKey()).then(function (raw) {
      var found = parse(raw);
      if (!found) return null;
      found.kind = 'draft';
      return found;
    });
  }

  function savedRound() {
    if (!Ryker.logger.isOn()) return Promise.resolve(null);
    return Ryker.logger.list().then(function (entries) {
      function next(i) {
        if (i >= entries.length) return null;
        return Ryker.logger.read(entries[i]).then(function (raw) {
          var found = parse(raw);
          if (!found || !Array.isArray(found.changes) || !found.changes.length) return next(i + 1);
          found.kind = 'saved';
          return found;
        }).catch(function () { return next(i + 1); });
      }
      return next(0);
    });
  }

  function legacy() {
    var raw;
    try { raw = localStorage.getItem(legacyKey()); } catch (e) { return null; }
    var old = parse(raw);
    var records = old && old.records || [];
    if (!records.length) return null;
    var changes = [];
    records.forEach(function (record) {
      (record.changes || []).forEach(function (change) { changes.push(change); });
    });
    return changes.length ? {
      kind: 'legacy', baselineId: Ryker.instructions.baselineId(),
      savedAt: old.savedAt || '', changes: changes
    } : null;
  }

  function settle(found) { return set(seenKey(), fingerprint(found)); }

  function alreadySettled(found) {
    return get(seenKey()).then(function (value) { return value === fingerprint(found); });
  }

  function apply(found) {
    applying = true;
    var before = Ryker.blocks.snapshot();
    var out = Ryker.blocks.applyRecords([{ changes: found.changes }]);
    var changes = Ryker.blocks.diffSnapshots(before, Ryker.blocks.snapshot());
    applying = false;
    settle(found);
    if (!changes.length) {
      Ryker.dialog.alert('Nothing to restore', 'Those changes are already reflected in this document.', 'ok');
      return false;
    }
    Ryker.instructions.record();
    Ryker.editable.rebase();
    Ryker.pane.refresh(true);
    if (!Ryker.pane.isOpen()) Ryker.pane.toggle();
    Ryker.boot.sync();
    checkpoint();
    Ryker.dialog.alert('Changes restored',
      changes.length + ' block(s) were restored.' +
      (out.missed ? ' ' + out.missed + ' change(s) could not be placed and were skipped.' : ''),
      out.missed ? 'warn' : 'ok');
    return true;
  }

  function present(found) {
    return alreadySettled(found).then(function (settled) {
      if (settled) return false;
      if (!compatible(found)) {
        settle(found);
        Ryker.dialog.alert('Saved changes need review',
          'Ryker found changes from an earlier version of this document, but the source has changed. They were not applied automatically. Open Saved change requests to review them.',
          'warn');
        return false;
      }
      var when = found.savedAt ? ', saved ' + Ryker.dom.fmtDate(found.savedAt) : '';
      Ryker.dialog.open({
        title: 'Restore earlier changes?',
        body: Ryker.dom.el('div', {}, [
          Ryker.dom.el('p', { text: found.changes.length + ' change(s) were found' + when + '.' }),
          Ryker.dom.el('p', { class: 'muted', text: 'The source matches their baseline. Nothing is applied unless you choose Restore.' })
        ]),
        buttons: [
          { label: 'Not now', action: function () { settle(found); } },
          { label: 'Restore', primary: true, action: function () { apply(found); } }
        ]
      });
      return true;
    });
  }

  function offer() {
    if (offered) return Promise.resolve(false);
    offered = true;
    return draft().then(function (found) {
      if (found) return found;
      return savedRound();
    }).then(function (found) {
      return present(found || legacy());
    }).catch(function (e) {
      if (Ryker.log) Ryker.log('recovery: ' + e.message);
      return false;
    });
  }

  function dismiss() {
    clearTimeout(timer);
    return remove(draftKey());
  }

  return {
    init: init, offer: offer, apply: apply, checkpoint: checkpoint,
    draft: draft, savedRound: savedRound, present: present, dismiss: dismiss,
    draftKey: draftKey, seenKey: seenKey
  };
})();
