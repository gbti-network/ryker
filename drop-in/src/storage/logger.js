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
  var KEY = 'log-dir';

  var dir = null;
  var seq = 0;
  var lastError = null;
  var listeners = [];
  // Saves made before the folder was granted. Logging is not optional, so a
  // save that happens while the grant is still outstanding is held rather than
  // dropped, and written the moment the folder arrives. Without this, "always
  // on" would quietly mean "on from the second save onward".
  var pending = [];
  // Serialises writes and gives the browser a completion boundary. Opening the
  // Change requests dialog immediately after Save used to list the directory
  // while createWritable().close() was still pending and report an empty log.
  var writeTail = Promise.resolve();

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  function supported() { return Ryker.fs.supported(); }
  function isOn() { return !!dir; }
  function folderName() { return dir ? dir.name : null; }
  function error() { return lastError; }
  function count() { return seq; }

  // ---- turning it on ------------------------------------------------------

  function choose() {
    if (!supported()) {
      lastError = 'This browser cannot write to a folder. Logging needs Chrome or Edge.';
      emit();
      return Promise.resolve(false);
    }
    return Ryker.fs.grant({ mode: 'readwrite', id: 'ryker-log', startIn: 'documents' })
      .then(function (handle) {
        dir = handle;
        lastError = null;
        return Ryker.fs.remember(KEY, handle)
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
    return Ryker.fs.recall(KEY).then(function (handle) {
      if (!handle) return false;
      return Ryker.fs.permission(handle, false).then(function (state) {
        if (state !== 'granted') return false;
        dir = handle;
        Ryker.fs.setHandle(handle);
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
  function documentKey(value) {
    var raw = String(value || 'untitled');
    if (/^[A-Za-z0-9._-]{1,80}$/.test(raw)) return raw;
    var label = raw.replace(/^https?:\/\//i, '').toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52) || 'document';
    var h = 2166136261;
    for (var i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return label + '-' + (h >>> 0).toString(16).padStart(8, '0');
  }

  function documentDir() {
    var prefix = dir && dir.name.toLowerCase() === LIB ? '' : LIB + '/';
    return prefix + DIR_NAME + '/' + documentKey(Ryker.config.load().RYKER_DOCUMENT_ID);
  }

  // The path as it will actually read on disk, for saying out loud.
  function where() {
    if (!dir) return LIB + '/' + DIR_NAME;
    return dir.name.toLowerCase() === LIB
      ? dir.name + '/' + DIR_NAME
      : dir.name + '/' + LIB + '/' + DIR_NAME;
  }

  // Called after every save. Failures are recorded and surfaced in the pane
  // rather than thrown: a logging problem must never cost someone their edit.
  // Separated from the write so the shape of the training data can be checked
  // without a filesystem, which is the only part of this worth testing.
  function buildPayload(promptText, saveNote) {
    var cfg = Ryker.config.load();
    var edits = Ryker.instructions.edits();
    return {
      rykerVersion: Ryker.VERSION,
      build: Ryker.BUILD || 'Ryker',
      documentId: cfg.RYKER_DOCUMENT_ID,
      documentPath: cfg.RYKER_DOCUMENT_PATH,
      documentTitle: document.title,
      savedAt: new Date().toISOString(),
      // Which document text every FROM in this record is quoting.
      //
      // Records sharing a baseline are cumulative supersets of one another, so
      // merging them means keeping the last. Records with different baselines
      // quote different starting text and have to be composed instead. Without
      // this field neither case can be told from the other: saveNumber below
      // resets on reload, so the 17 records written before this was added run
      // 1 to 5, reset to 2, reset to 1, then continue at 6.
      baselineId: Ryker.instructions.baselineId(),
      saveNumber: Ryker.instructions.saveCount(),
      saveNote: String(saveNote || '').trim() || null,
      saveNotes: Ryker.instructions.saveNotes(),
      editCount: edits.length,
      // The prose prompt, exactly as the pane shows it.
      prompt: promptText,
      // Machine replay data is deliberately separate from the prompt-facing
      // edits below. Earlier records omitted block ids and could be reviewed
      // but not safely restored after refresh; guessing by position risks
      // applying text to a different element when the source has changed.
      changes: Ryker.instructions.recoveryChanges(),
      // And the pairs behind it, which is the part worth training on.
      edits: edits.map(function (e) {
        return {
          kind: e.kind, tag: e.tag,
          beforeTag: e.beforeTag || null,
          afterTag: e.afterTag || e.tag || null,
          before: e.before, after: e.after,
          position: Ryker.instructions.where(e.id) || null
        };
      })
    };
  }

  function record(promptText, saveNote) {
    seq += 1;
    var payload = buildPayload(promptText, saveNote);
    if (!dir) {
      pending.push({ name: stamp() + '-save-' + payload.saveNumber + '.json', payload: payload });
      emit();
      return Promise.resolve(false);
    }
    return queuePut(stamp() + '-save-' + payload.saveNumber + '.json', payload);
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
        return queuePut(item.name, item.payload).then(function (ok) {
          if (ok) done += 1; else pending.push(item);
        });
      });
    }, Promise.resolve()).then(function () { return done; });
  }

  function pendingCount() { return pending.length; }

  function queuePut(name, payload) {
    var job = writeTail.then(function () { return put(name, payload); });
    writeTail = job.catch(function () { return false; });
    return job;
  }

  function settled() { return writeTail.then(function () { return true; }); }

  function put(name, payload) {
    return Ryker.fs.write(dir, documentDir() + '/' + name, JSON.stringify(payload, null, 2))
      .then(function () { lastError = null; emit(); return true; })
      .catch(function (e) {
        lastError = e && e.message ? e.message : String(e);
        // A revoked permission is worth forgetting, so the next attempt offers
        // the picker again rather than failing the same way forever.
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
          dir = null;
          Ryker.fs.setHandle(null);
          Ryker.fs.forget(KEY);
        }
        emit();
        return false;
      });
  }

  // ---- reading the log back ------------------------------------------------

  // The folder handle can list its own contents, so the log is browsable from
  // inside the report without going anywhere near the file system dialog again.
  function list() {
    if (!dir) return Promise.resolve([]);
    return settled().then(function () { return Ryker.fs.list(dir, documentDir()); }).then(function (out) {
      lastError = null;
      return out.filter(function (entry) {
        return entry.kind === 'file' && /\.json$/.test(entry.name);
      }).map(function (entry) {
        entry.path = documentDir() + '/' + entry.name;
        return entry;
      }).sort(function (a, b) { return b.name.localeCompare(a.name); });
    }).catch(function (e) {
      // A granted folder with no per-document directory is a genuinely empty
      // log. Every other failure must be visible; treating permission and path
      // errors as an empty array produced the misleading popup this fixes.
      if (e && (e.name === 'NotFoundError' || /no such directory/i.test(e.message || ''))) return [];
      lastError = e && e.message ? e.message : String(e);
      emit();
      throw e;
    });
  }

  function read(entry) {
    return Ryker.fs.read(dir, entry.path);
  }

  // Delete every logged record for this document.
  //
  // Only this document's directory, and only the .json files list() reports, so
  // a folder somebody granted for a report cannot lose anything else in it to a
  // button inside that report. Rejects on the first failure rather than
  // reporting success over a partial delete, because "cleared" that left half
  // the log behind is worse than an error.
  function clear() {
    if (!dir) return Promise.resolve(0);
    return list().then(function (files) {
      return files.reduce(function (chain, f) {
        return chain.then(function (n) {
          return Ryker.fs.remove(dir, f.path).then(function () { return n + 1; });
        });
      }, Promise.resolve(0));
    }).then(function (n) {
      seq = 0;
      emit();
      return n;
    });
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
    flush: flush, settled: settled, pendingCount: pendingCount, where: where, LIB: LIB,
    list: list, read: read, clear: clear, folderUrl: folderUrl,
    folderName: folderName, error: error,
    count: count, onChange: onChange, DIR_NAME: DIR_NAME, documentKey: documentKey
  };
})();
