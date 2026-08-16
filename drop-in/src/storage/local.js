// localStorage backend. The floor: always available, needs nothing configured,
// and works from a ZIP on a machine with no repository and no network.
//
// Keyed by document id rather than by filename, per spec section 34, so
// renaming the report does not orphan its comments.
Ryker.storage.register('local', (function () {
  'use strict';

  function key() {
    return 'ryker:' + Ryker.config.load().RYKER_DOCUMENT_ID + ':journal';
  }

  function available() {
    try {
      var k = 'ryker:probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  }

  return {
    // The file on disk is never rewritten, so the journal has to be replayed
    // into the document at boot or a reload silently loses every saved edit.
    ownsDocument: false,

    isReady: function () { return available(); },
    canWrite: function () { return available(); },

    describe: function () {
      return available() ? 'This browser only' : 'Memory only, nothing is being saved';
    },

    detail: function () {
      return 'Saved in this browser under ' + key() + '. Nothing leaves this machine, ' +
        'and clearing site data removes it. Use Export to hand the work to someone else.';
    },

    load: function () {
      if (!available()) return Promise.resolve({ records: [] });
      var raw = localStorage.getItem(key());
      if (!raw) return Promise.resolve({ records: [] });
      try {
        var parsed = JSON.parse(raw);
        return Promise.resolve({ records: parsed.records || [] });
      } catch (e) {
        return Promise.resolve({ records: [], error: e });
      }
    },

    save: function (payload) {
      if (!available()) {
        return Promise.reject(new Error('This browser is refusing local storage, so nothing can be saved here.'));
      }
      try {
        localStorage.setItem(key(), JSON.stringify({
          documentId: Ryker.config.load().RYKER_DOCUMENT_ID,
          savedAt: Ryker.dom.now(),
          records: payload.records
        }));
        return Promise.resolve({ ok: true, where: 'this browser' });
      } catch (e) {
        // Quota is the realistic failure, and losing the edit to it would be
        // the offline-behaviour violation section 36 forbids. The working copy
        // stays in memory; only persistence failed.
        return Promise.reject(new Error(
          'Local storage refused the write (' + e.name + '). Your edits are still ' +
          'here in the page. Export them before closing this tab.'));
      }
    }
  };
})());
