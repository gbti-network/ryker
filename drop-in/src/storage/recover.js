// Refresh recovery for the current editor, plus import of the retired journal.
Ryker.recover = (function () {
  'use strict';

  var timer = null;
  var applying = false;
  var offered = false;
  var lastStorageError = null;

  function documentKey() {
    return Ryker.logger.documentKey(Ryker.config.load().RYKER_DOCUMENT_ID);
  }

  function baseDraftKey() { return 'ryker:draft:' + documentKey(); }
  function baseSeenKey() { return 'ryker:recovery-seen:' + documentKey(); }
  function sessionSuffix() {
    var id = Ryker.instructions.sessionId && Ryker.instructions.sessionId();
    return id ? ':' + String(id).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 96) : '';
  }
  // The worker scopes extension recovery by sender.tab.id. The drop-in uses a
  // tab-scoped sessionStorage token so two tabs sharing one file origin cannot
  // overwrite or consume each other's draft.
  function draftKey() {
    return baseDraftKey() + (Ryker.SURFACE === 'extension' ? '' : sessionSuffix());
  }
  function seenKey() {
    return baseSeenKey() + (Ryker.SURFACE === 'extension' ? '' : sessionSuffix());
  }
  function legacyKey() { return 'ryker:' + Ryker.config.load().RYKER_DOCUMENT_ID + ':journal'; }

  function extensionStore() {
    return Ryker.SURFACE === 'extension' && Ryker.extensionStorage;
  }

  function extensionKey(key) { return 'recovery:' + key; }

  function storageFailure(action, error) {
    var message = error && error.message ? error.message : String(error);
    var signature = action + ':' + message;
    if (signature === lastStorageError) return;
    lastStorageError = signature;
    if (Ryker.log) Ryker.log('recovery storage ' + action + ': ' + message);
    if (Ryker.pane && Ryker.pane.flash) {
      Ryker.pane.flash('Recovery could not be ' + action + ' in local Ryker storage: ' + message, 'warn');
    }
  }

  function get(key) {
    if (extensionStore()) {
      return Ryker.extensionStorage.get(extensionKey(key)).then(function (out) {
        lastStorageError = null;
        return out == null ? null : out;
      }).catch(function (error) { storageFailure('read', error); return null; });
    }
    try { return Promise.resolve(localStorage.getItem(key)); }
    catch (e) { return Promise.resolve(null); }
  }

  function set(key, value) {
    if (extensionStore()) {
      return Ryker.extensionStorage.set(extensionKey(key), value).then(function () {
        lastStorageError = null;
        return true;
      }).catch(function (error) { storageFailure('saved', error); return false; });
    }
    try { localStorage.setItem(key, value); return Promise.resolve(true); }
    catch (e) { return Promise.resolve(false); }
  }

  function remove(key) {
    if (extensionStore()) {
      return Ryker.extensionStorage.remove(extensionKey(key)).then(function () {
        lastStorageError = null;
        return true;
      }).catch(function (error) { storageFailure('removed', error); return false; });
    }
    try { localStorage.removeItem(key); return Promise.resolve(true); }
    catch (e) { return Promise.resolve(false); }
  }

  function parse(raw) {
    if (!raw) return null;
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch (e) { return null; }
  }

  function fingerprint(found) {
    if (!found) return 'none';
    var count = Array.isArray(found.changes) ? found.changes.length : 0;
    var moves = Array.isArray(found.moves) ? found.moves.length : 0;
    return found.kind + '@' + found.baselineId + '@' + found.savedAt + '@' + count + '@' + moves;
  }

  function checkpoint() {
    if (applying) return Promise.resolve(false);
    var changes = Ryker.instructions.recoveryChanges();
    var snapshot = Ryker.blocks.snapshot();
    // Changes and moves must share the authored baseline. editable.baselineOf()
    // is rebased after Save, which would otherwise drop a saved move whenever
    // a later unsaved text edit caused the draft to win recovery selection.
    var moves = Ryker.instructions.recoveryMoves ? Ryker.instructions.recoveryMoves() : [];
    if (!changes.length && !moves.length) return remove(draftKey());
    var draft = {
      version: 1, kind: 'draft',
      documentId: Ryker.config.load().RYKER_DOCUMENT_ID,
      sessionId: Ryker.instructions.sessionId ? Ryker.instructions.sessionId() : null,
      baselineId: Ryker.instructions.baselineId(),
      savedAt: new Date().toISOString(), changes: changes,
      order: Object.keys(snapshot), moves: moves
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
      Array.isArray(found.changes) &&
      (found.changes.length || (Array.isArray(found.moves) && found.moves.length) ||
        (Array.isArray(found.order) && found.order.length));
  }

  function draft() {
    return get(draftKey()).then(function (raw) {
      if (!raw && Ryker.SURFACE !== 'extension' && draftKey() !== baseDraftKey()) {
        return get(baseDraftKey()).then(function (legacyRaw) {
          var legacyFound = parse(legacyRaw);
          if (!legacyFound) return null;
          legacyFound.kind = 'draft';
          return legacyFound;
        });
      }
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
          if (!found || !Array.isArray(found.changes) ||
              (!found.changes.length && !(Array.isArray(found.moves) && found.moves.length) &&
                !(Array.isArray(found.order) && found.order.length))) {
            return next(i + 1);
          }
          found.kind = 'saved';
          return found;
        }).catch(function () { return next(i + 1); });
      }
      return next(0);
    });
  }

  function legacy() {
    // The retired drop-in journal belonged to the authored page. Reading it
    // from an injected extension would cross back into the visited origin and
    // let page-controlled storage impersonate extension recovery state.
    if (Ryker.SURFACE === 'extension') return null;
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

  // A move record says which kind it is, so a draft written before the unit
  // model still replays through the block-run path that produced it rather
  // than being handed to a reader that cannot understand it.
  function replayMoves(records, out) {
    if (!Array.isArray(records) || !records.length) {
      return { applied: out.moved || 0, missed: out.orderMissed || 0,
               unchanged: 0, skipped: [] };
    }
    if (records[0] && records[0].kind === 'unit') return Ryker.units.replay(records);
    var older = Ryker.move.replay(records);
    older.skipped = older.skipped || [];
    return older;
  }

  function apply(found) {
    applying = true;
    var before = Ryker.blocks.snapshot();
    var out, moveOut, changes;
    try {
      // Records carry explicit moves so parent changes can be replayed. Flat
      // order remains the compatibility path for records written during the
      // short-lived order-only format.
      out = Ryker.blocks.applyRecords([{
        changes: found.changes,
        order: Array.isArray(found.moves) ? null : found.order
      }]);
      moveOut = replayMoves(found.moves, out);
      changes = Ryker.blocks.diffSnapshots(before, Ryker.blocks.snapshot());
    } finally {
      applying = false;
    }
    settle(found);
    if (!changes.length && !moveOut.applied) {
      if (out.missed + moveOut.missed) {
        Ryker.dialog.alert('Changes could not be restored',
          (out.missed + moveOut.missed) +
          ' saved change(s) did not match a safe element or position in this document.', 'warn');
      } else {
        Ryker.dialog.alert('Nothing to restore',
          'Those changes are already reflected in this document.', 'ok');
      }
      return false;
    }
    Ryker.instructions.record();
    Ryker.editable.rebase();
    Ryker.pane.refresh(true);
    if (!Ryker.pane.isOpen()) Ryker.pane.toggle();
    Ryker.boot.sync();
    checkpoint();
    // Everything that could be restored is, and anything that could not is
    // named rather than counted. A position that cannot be resolved is left
    // alone: placing it on a guess is what damages a document, and the saved
    // change request still has the instruction for it.
    var lost = out.missed + moveOut.missed;
    var named = (moveOut.skipped || []).length
      ? ' Left where they are: ' + moveOut.skipped.join(', ') +
        '. The saved change request still describes ' +
        (moveOut.skipped.length > 1 ? 'them' : 'it') + '.'
      : '';
    Ryker.dialog.alert('Changes restored',
      changes.length + ' block(s) and ' + moveOut.applied + ' move(s) were restored.' +
      (lost ? ' ' + lost + ' change(s) could not be placed and were skipped.' : '') +
      named, lost ? 'warn' : 'ok');
    return true;
  }

  function present(found) {
    if (!found) return Promise.resolve(false);
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
          Ryker.dom.el('p', { text: found.changes.length + ' content change(s)' +
            (found.moves && found.moves.length ? ' plus ' + found.moves.length + ' move(s)' :
              (found.order ? ' plus saved block order' : '')) + ' were found' + when + '.' }),
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
