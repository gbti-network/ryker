// File System Access backend. Writes the report and the journal straight to the
// folder the report lives in, once a person has granted access to it.
//
// A page cannot scan its own directory unasked, which is correct and is why
// section 23 asks for a "Choose report folder" step. showDirectoryPicker was
// confirmed exposed from file:// with isSecureContext true on 2026-08-13; the
// grant itself still needs a click.
Ryker.storage.register('fs', (function () {
  'use strict';

  var dir = null;
  var granted = false;

  function supported() { return typeof window.showDirectoryPicker === 'function'; }

  function pick() {
    if (!supported()) {
      return Promise.reject(new Error(
        'This browser has no directory picker. Use Export to download the edited file instead.'));
    }
    return window.showDirectoryPicker({ mode: 'readwrite' }).then(function (handle) {
      dir = handle;
      granted = true;
      Ryker.storage.detect();
      return handle;
    });
  }

  function handle() { return dir; }

  function getDir(path, create) {
    var parts = path.split('/').filter(Boolean);
    var p = Promise.resolve(dir);
    parts.forEach(function (part) {
      p = p.then(function (d) { return d.getDirectoryHandle(part, { create: !!create }); });
    });
    return p;
  }

  function readFile(d, name) {
    return d.getFileHandle(name).then(function (fh) { return fh.getFile(); })
      .then(function (f) { return f.text(); });
  }

  function writeFile(d, name, contents) {
    return d.getFileHandle(name, { create: true }).then(function (fh) {
      return fh.createWritable();
    }).then(function (w) {
      return w.write(contents).then(function () { return w.close(); });
    });
  }

  function pad(n) { return String(n).padStart(4, '0'); }

  return {
    ownsDocument: true,

    isReady: function () { return granted && !!dir; },
    canWrite: function () { return granted && !!dir; },
    supported: supported,
    pick: pick,
    handle: handle,
    readFile: readFile,
    writeFile: writeFile,
    getDir: getDir,

    describe: function () {
      return dir ? 'Folder: ' + dir.name : 'No folder chosen';
    },

    detail: function () {
      return dir
        ? 'Saving into ' + dir.name + '. The report is rewritten in place and each save appends a ' +
          'new file under .ryker/revisions/.'
        : 'Choose the folder the report sits in to save changes straight to disk.';
    },

    load: function () {
      if (!dir) return Promise.resolve({ records: [] });
      return getDir('.ryker/revisions', false).then(function (d) {
        var reads = [];
        var it = d.values();
        function step() {
          return it.next().then(function (res) {
            if (res.done) return null;
            var entry = res.value;
            if (entry.kind === 'file' && /\.json$/.test(entry.name)) {
              reads.push(readFile(d, entry.name).then(function (t) {
                try { return JSON.parse(t); } catch (e) { return null; }
              }));
            }
            return step();
          });
        }
        return step().then(function () { return Promise.all(reads); });
      }).then(function (list) {
        return { records: (list || []).filter(Boolean) };
      }).catch(function () {
        // No .ryker directory yet is the ordinary first-run case, not an error.
        return { records: [] };
      });
    },

    // Only the newly appended records are written. Rewriting the whole log on
    // every save would defeat the point of an append-only journal.
    save: function (payload) {
      if (!dir) return Promise.reject(new Error('No folder chosen yet.'));
      var cfg = Ryker.config.load();
      return getDir('.ryker/revisions', true).then(function (d) {
        var writes = (payload.appended || []).map(function (rec) {
          return writeFile(d, pad(rec.seq) + '.json', JSON.stringify(rec, null, 2));
        });
        return Promise.all(writes);
      }).then(function () {
        return getDir('.ryker', true);
      }).then(function (d) {
        return writeFile(d, 'document.json', JSON.stringify({
          documentId: cfg.RYKER_DOCUMENT_ID,
          documentPath: cfg.RYKER_DOCUMENT_PATH,
          updatedAt: Ryker.dom.now(),
          revisions: payload.records.length
        }, null, 2));
      }).then(function () {
        if (!payload.documentHtml) return null;
        return writeFile(dir, cfg.RYKER_DOCUMENT_PATH, payload.documentHtml);
      }).then(function () {
        return { ok: true, where: dir.name };
      });
    }
  };
})());
