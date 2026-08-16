// Writing a copy of the instructions to disk on every save, as training data.
//
// "Silently" is achievable, with one honest caveat stated up front: a browser
// cannot write to a folder it has never been shown. Somebody grants access to
// the report's folder once, and from then on every save writes without a prompt,
// a dialog or a download. Chrome remembers the folder between visits, so the
// most a reload costs is a single click to confirm it again.
//
// Each save writes one JSON file holding the prose prompt AND the structured
// edits behind it. Training on the prompt alone would lose the before and after
// pairs, which are the part with signal in them.
Ryker.logger = (function () {
  'use strict';

  // Decided rather than asked. The only thing the browser insists on is being
  // shown a folder once; everything below that point is Ryker's choice, so it
  // is made here instead of being put to whoever is editing.
  var LIB = 'ryker';
  var DIR_NAME = 'revisions';
  var DB = 'ryker', STORE = 'handles', KEY = 'log-dir';

  var dir = null;
  var seq = 0;
  var lastError = null;
  var listeners = [];
  // Saves made before the folder was granted. Logging is not optional, so a
  // save that happens while the grant is still outstanding is held rather than
  // dropped, and written the moment the folder arrives. Without this, "always
  // on" would quietly mean "on from the second save onward".
  var pending = [];

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  function supported() { return typeof window.showDirectoryPicker === 'function'; }
  function isOn() { return !!dir; }
  function folderName() { return dir ? dir.name : null; }
  function error() { return lastError; }
  function count() { return seq; }

  // ---- remembering the folder across reloads ------------------------------

  function idb(mode, fn) {
    return new Promise(function (resolve) {
      var open;
      try { open = indexedDB.open(DB, 1); } catch (e) { resolve(null); return; }
      open.onupgradeneeded = function () {
        if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
      };
      open.onerror = function () { resolve(null); };
      open.onsuccess = function () {
        var db = open.result;
        var tx = db.transaction(STORE, mode);
        var req = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { db.close(); resolve(req ? req.result : null); };
        tx.onerror = function () { db.close(); resolve(null); };
      };
    });
  }

  function remember(handle) { return idb('readwrite', function (s) { return s.put(handle, KEY); }); }
  function forget() { return idb('readwrite', function (s) { return s.delete(KEY); }); }
  function recall() { return idb('readonly', function (s) { return s.get(KEY); }); }

  // ---- turning it on ------------------------------------------------------

  function choose() {
    if (!supported()) {
      lastError = 'This browser cannot write to a folder. Logging needs Chrome or Edge.';
      emit();
      return Promise.resolve(false);
    }
    return window.showDirectoryPicker({ mode: 'readwrite', id: 'ryker-log',
                                        startIn: 'documents' })
      .then(function (handle) {
        dir = handle;
        lastError = null;
        return remember(handle)
          .then(flush)
          .then(function () { emit(); return true; });
      })
      .catch(function (e) {
        // An abort is someone closing the picker, which is not an error.
        if (e && e.name !== 'AbortError') lastError = e.message;
        emit();
        return false;
      });
  }

  // Called at startup. Re-uses the remembered folder when permission is still
  // granted, and stays quiet when it is not: asking on load would be a prompt
  // nobody asked for.
  function resume() {
    if (!supported()) return Promise.resolve(false);
    return recall().then(function (handle) {
      if (!handle || !handle.queryPermission) return false;
      return handle.queryPermission({ mode: 'readwrite' }).then(function (state) {
        if (state !== 'granted') return false;
        dir = handle;
        return flush().then(function () { emit(); return true; });
      });
    }).catch(function () { return false; });
  }

  // There is deliberately no stop(). Logging is part of what this build is for,
  // and a switch that turns the record off is a switch that silently loses the
  // training data the record exists to collect. forget() survives only for the
  // revoked-permission path below, which re-asks rather than gives up.

  // ---- writing ------------------------------------------------------------

  function stamp() {
    var d = new Date();
    function p(n, w) { return String(n).padStart(w || 2, '0'); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  // The log belongs beside the library rather than beside the reports, so a
  // folder someone keeps documents in does not fill with machine output. When
  // the granted folder is already the library folder, it is used as-is instead
  // of nesting a second ryker inside itself.
  function libraryDir() {
    if (dir.name.toLowerCase() === LIB) return Promise.resolve(dir);
    return dir.getDirectoryHandle(LIB, { create: true });
  }

  function ensureDir() {
    return libraryDir()
      .then(function (lib) { return lib.getDirectoryHandle(DIR_NAME, { create: true }); })
      .then(function (logs) {
        var id = Ryker.config.load().RYKER_DOCUMENT_ID;
        return logs.getDirectoryHandle(id, { create: true });
      });
  }

  // The path as it will actually read on disk, for saying out loud.
  function where() {
    if (!dir) return LIB + '/' + DIR_NAME;
    return dir.name.toLowerCase() === LIB
      ? dir.name + '/' + DIR_NAME
      : dir.name + '/' + LIB + '/' + DIR_NAME;
  }

  function write(handle, name, contents) {
    return handle.getFileHandle(name, { create: true })
      .then(function (fh) { return fh.createWritable(); })
      .then(function (w) { return w.write(contents).then(function () { return w.close(); }); });
  }

  // Called after every save. Failures are recorded and surfaced in the pane
  // rather than thrown: a logging problem must never cost someone their edit.
  // Separated from the write so the shape of the training data can be checked
  // without a filesystem, which is the only part of this worth testing.
  function buildPayload(promptText) {
    var cfg = Ryker.config.load();
    var edits = Ryker.instructions.edits();
    return {
      rykerVersion: Ryker.VERSION,
      build: Ryker.BUILD || 'Ryker',
      documentId: cfg.RYKER_DOCUMENT_ID,
      documentPath: cfg.RYKER_DOCUMENT_PATH,
      documentTitle: document.title,
      savedAt: new Date().toISOString(),
      saveNumber: Ryker.instructions.saveCount(),
      editCount: edits.length,
      // The prose prompt, exactly as the pane shows it.
      prompt: promptText,
      // And the pairs behind it, which is the part worth training on.
      edits: edits.map(function (e) {
        return {
          kind: e.kind, tag: e.tag,
          before: e.before, after: e.after,
          position: Ryker.instructions.where(e.id) || null
        };
      })
    };
  }

  function record(promptText) {
    seq += 1;
    var payload = buildPayload(promptText);
    if (!dir) {
      pending.push({ name: stamp() + '-save-' + payload.saveNumber + '.json', payload: payload });
      emit();
      return Promise.resolve(false);
    }
    return put(stamp() + '-save-' + payload.saveNumber + '.json', payload);
  }

  // Everything held while the grant was outstanding, oldest first. A failure
  // part way through leaves the rest queued rather than discarding them.
  function flush() {
    if (!dir || !pending.length) return Promise.resolve(0);
    var queued = pending.slice();
    pending = [];
    var done = 0;
    return queued.reduce(function (chain, item) {
      return chain.then(function () {
        return put(item.name, item.payload).then(function (ok) {
          if (ok) done += 1; else pending.push(item);
        });
      });
    }, Promise.resolve()).then(function () { return done; });
  }

  function pendingCount() { return pending.length; }

  function put(name, payload) {
    return ensureDir()
      .then(function (docDir) {
        return write(docDir, name, JSON.stringify(payload, null, 2));
      })
      .then(function () { lastError = null; emit(); return true; })
      .catch(function (e) {
        lastError = e && e.message ? e.message : String(e);
        // A revoked permission is worth forgetting, so the next attempt offers
        // the picker again rather than failing the same way forever.
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) dir = null;
        emit();
        return false;
      });
  }

  // ---- reading the log back ------------------------------------------------

  // The folder handle can list its own contents, so the log is browsable from
  // inside the report without going anywhere near the file system dialog again.
  function list() {
    if (!dir) return Promise.resolve([]);
    return ensureDir().then(function (docDir) {
      var out = [];
      var it = docDir.values();
      function step() {
        return it.next().then(function (res) {
          if (res.done) return null;
          var entry = res.value;
          if (entry.kind !== 'file' || !/\.json$/.test(entry.name)) return step();
          return entry.getFile().then(function (f) {
            out.push({ name: entry.name, size: f.size, modified: f.lastModified, handle: entry });
            return step();
          }).catch(step);
        });
      }
      return step().then(function () {
        return out.sort(function (a, b) { return b.name.localeCompare(a.name); });
      });
    }).catch(function () { return []; });
  }

  function read(entry) {
    return entry.handle.getFile().then(function (f) { return f.text(); });
  }

  // A browser cannot open the operating system's file manager, and pretending
  // otherwise would be a button that does nothing. What it can do, when the
  // report is being read from disk, is open the folder as a directory listing
  // in a new tab, which is the closest thing available and is genuinely useful.
  function folderUrl() {
    if (location.protocol !== 'file:') return null;
    var base = location.href.replace(/[^/]*$/, '');
    return base + LIB + '/' + DIR_NAME + '/' +
      encodeURIComponent(Ryker.config.load().RYKER_DOCUMENT_ID) + '/';
  }

  function describe() {
    if (!supported()) return 'Logging needs Chrome or Edge';
    if (!dir) {
      return pending.length
        ? pending.length + ' save(s) waiting for a folder'
        : 'Waiting for a folder';
    }
    return 'Logging to ' + where();
  }

  return {
    supported: supported, isOn: isOn, choose: choose, resume: resume,
    record: record, buildPayload: buildPayload, describe: describe,
    flush: flush, pendingCount: pendingCount, where: where, LIB: LIB,
    list: list, read: read, folderUrl: folderUrl,
    folderName: folderName, error: error,
    count: count, onChange: onChange, DIR_NAME: DIR_NAME
  };
})();
