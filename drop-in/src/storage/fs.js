// The one boundary around browser file access and persisted handles.
//
// The logger used to own a second copy of the picker, IndexedDB transaction,
// directory traversal, read, write, list and remove code. Besides drifting, that
// made the extension impossible: a content script's IndexedDB belongs to the
// host page. The persistence adapter below can be replaced by an
// extension-owned store while every filesystem consumer keeps the same API.
Ryker.fs = (function () {
  'use strict';

  var DB = 'ryker', STORE = 'handles';
  var root = null;

  // Extension records cross the isolated-world boundary as validated messages
  // to the service worker. Values here are JSON data, never filesystem handles:
  // Chrome versions using JSON extension messaging would turn a handle into an
  // empty object. A granted folder therefore remains useful for this tab while
  // revisions, recovery and preferences live durably in the extension store.
  function extensionRequest(operation, key, value) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      return Promise.reject(new Error('Ryker extension storage is unavailable.'));
    }
    var message = { channel: 'ryker.storage.v1', version: 1, operation: operation };
    // usage asks about the sender's own document, so it deliberately carries no
    // key for the worker to have to second-guess.
    if (operation !== 'usage') message.key = key;
    if (operation === 'set') message.value = value;
    return chrome.runtime.sendMessage(message).then(function (response) {
      if (!response || response.ok !== true) {
        var detail = response && response.error || {};
        var error = new Error(detail.message || 'Ryker extension storage rejected the operation.');
        error.code = detail.code || 'storage-failed';
        throw error;
      }
      return response.value;
    });
  }

  function installExtensionStorage() {
    if (Ryker.SURFACE !== 'extension') return null;
    var api = {
      get: function (key) { return extensionRequest('get', key); },
      set: function (key, value) { return extensionRequest('set', key, value); },
      remove: function (key) { return extensionRequest('remove', key); },
      list: function (prefix) { return extensionRequest('list', prefix); },
      usage: function () { return extensionRequest('usage'); }
    };
    Ryker.extensionStorage = api;
    Ryker.extensionPreferences = Ryker.extensionPreferences || {};
    connectWorkspacePort();
    [
      ['saveNotes', 'preference:save-notes'],
      ['paneWidth', 'preference:pane-width'],
      ['railWidth', 'preference:rail-width']
    ].forEach(function (pair) {
      api.get(pair[1]).then(function (value) {
        if (value !== null && value !== undefined) {
          Ryker.extensionPreferences = Ryker.extensionPreferences || {};
          Ryker.extensionPreferences[pair[0]] = value;
        }
      }).catch(function () { /* boot remains usable; writes surface their own error */ });
    });
    return api;
  }

  // tabs.sendMessage only reaches content scripts, not an extension-owned tab.
  // The workspace therefore opens a named runtime Port. Its sender carries the
  // owning tab id, allowing the worker to toggle exactly the clicked workspace
  // without reloading the HTML/Markdown document held in that tab.
  function connectWorkspacePort() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.connect ||
        !chrome.runtime.getURL || location.href.indexOf(chrome.runtime.getURL('workspace.html')) !== 0) return;
    var stopped = false;
    function connect() {
      if (stopped) return;
      var port;
      try { port = chrome.runtime.connect({ name: 'ryker.workspace.v1' }); }
      catch (error) { return; }
      port.onMessage.addListener(function (message) {
        if (!message || message.channel !== 'ryker.workspace.v1' || message.action !== 'toggle') return;
        var state = 'workspace-ready';
        if (Ryker.boot && Ryker.boot.isOpen && Ryker.boot.isOpen()) {
          state = Ryker.boot.toggle() ? 'mounted' : 'closed';
        } else if (Ryker.boot && Ryker.boot.toggle && Ryker.shell && Ryker.shell.host()) {
          state = Ryker.boot.toggle() ? 'mounted' : 'closed';
        }
        port.postMessage({ channel: 'ryker.workspace.v1', requestId: message.requestId, state: state });
      });
      port.onDisconnect.addListener(function () {
        if (!stopped) setTimeout(connect, 250);
      });
    }
    window.addEventListener('pagehide', function () { stopped = true; }, { once: true });
    connect();
  }

  var extensionStorage = installExtensionStorage();

  function supported() { return typeof window.showDirectoryPicker === 'function'; }
  function isReady() { return !!root; }
  function handle() { return root; }
  function setHandle(next) { root = next || null; return root; }

  // ---- persisted handles --------------------------------------------------

  function idb(mode, fn) {
    return new Promise(function (resolve) {
      var open;
      try { open = window.indexedDB.open(DB, 1); } catch (e) { resolve(null); return; }
      open.onupgradeneeded = function () {
        if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
      };
      open.onerror = function () { resolve(null); };
      open.onsuccess = function () {
        var db = open.result;
        var tx, req;
        try {
          tx = db.transaction(STORE, mode);
          req = fn(tx.objectStore(STORE));
        } catch (e) {
          try { db.close(); } catch (e2) { /* already closing */ }
          resolve(null);
          return;
        }
        tx.oncomplete = function () { db.close(); resolve(req ? req.result : null); };
        tx.onerror = function () { db.close(); resolve(null); };
        tx.onabort = function () { db.close(); resolve(null); };
      };
    });
  }

  function defaultPersistence() {
    return {
      get: function (key) { return idb('readonly', function (s) { return s.get(key); }); },
      set: function (key, value) {
        return idb('readwrite', function (s) { return s.put(value, key); });
      },
      remove: function (key) {
        return idb('readwrite', function (s) { return s.delete(key); });
      }
    };
  }

  // Never fall back to a visited website's IndexedDB on the extension surface.
  // Directory-handle persistence is deliberately session-only until the
  // extension requires structured-clone messaging or owns the picker itself.
  var persistence = extensionStorage ? {
    get: function () { return Promise.resolve(null); },
    set: function () { return Promise.resolve(false); },
    remove: function () { return Promise.resolve(true); }
  } : defaultPersistence();

  // An extension supplies an adapter whose storage belongs to the extension,
  // not to whichever page its content script happens to be editing.
  function usePersistence(next) {
    if (!next || typeof next.get !== 'function' || typeof next.set !== 'function' ||
        typeof next.remove !== 'function') {
      throw new Error('A persistence adapter needs get, set and remove methods.');
    }
    persistence = next;
  }

  // Persistence failure is a degradation, not a grant failure. In private
  // browsing, under policy or at quota, the handle still works for this session.
  function callPersistence(method, args) {
    var result;
    try { result = persistence[method].apply(persistence, args); }
    catch (e) { return Promise.resolve(null); }
    return Promise.resolve(result).catch(function () { return null; });
  }

  function remember(key, value) { return callPersistence('set', [key, value]); }
  function recall(key) { return callPersistence('get', [key]); }
  function forget(key) { return callPersistence('remove', [key]); }

  // ---- grant and permission ----------------------------------------------

  function grant(options) {
    if (!supported()) {
      return Promise.reject(new Error(
        'This browser has no directory picker. Use Export to download the edited file instead.'));
    }
    return window.showDirectoryPicker(options || { mode: 'readwrite' }).then(function (next) {
      root = next;
      return next;
    });
  }

  function permission(target, request) {
    if (!target || typeof target.queryPermission !== 'function') return Promise.resolve('denied');
    return target.queryPermission({ mode: 'readwrite' }).then(function (state) {
      if (state === 'prompt' && request && typeof target.requestPermission === 'function') {
        return target.requestPermission({ mode: 'readwrite' });
      }
      return state;
    });
  }

  // ---- paths --------------------------------------------------------------

  function parts(path) {
    var out = String(path || '').split('/').filter(Boolean);
    if (out.some(function (part) { return part === '.' || part === '..'; })) {
      throw new Error('File paths must stay inside the granted folder.');
    }
    return out;
  }

  function directory(base, path, create) {
    var names;
    try { names = parts(path); } catch (e) { return Promise.reject(e); }
    var p = Promise.resolve(base || root);
    names.forEach(function (name) {
      p = p.then(function (dir) {
        if (!dir) throw new Error('No folder has been granted.');
        return dir.getDirectoryHandle(name, { create: !!create });
      });
    });
    return p;
  }

  function file(base, path, create) {
    var names;
    try { names = parts(path); } catch (e) { return Promise.reject(e); }
    var name = names.pop();
    if (!name) return Promise.reject(new Error('A file path is required.'));
    return directory(base, names.join('/'), create).then(function (dir) {
      return dir.getFileHandle(name, { create: !!create });
    });
  }

  function readFile(base, path) {
    return file(base, path, false).then(function (fh) { return fh.getFile(); });
  }

  function read(base, path) {
    return readFile(base, path).then(function (f) { return f.text(); });
  }

  function readBytes(base, path) {
    return readFile(base, path).then(function (f) { return f.arrayBuffer(); })
      .then(function (buf) { return new Uint8Array(buf); });
  }

  function write(base, path, contents) {
    return file(base, path, true).then(function (fh) { return fh.createWritable(); })
      .then(function (w) {
        return w.write(contents).then(function () { return w.close(); })
          .catch(function (e) {
            if (!w.abort) throw e;
            return w.abort().catch(function () {}).then(function () { throw e; });
          });
      });
  }

  function list(base, path) {
    return directory(base, path, false).then(function (dir) {
      var out = [];
      var it = dir.values();
      function step() {
        return it.next().then(function (res) {
          if (res.done) return out;
          var entry = res.value;
          if (entry.kind !== 'file') {
            out.push({ name: entry.name, kind: entry.kind, handle: entry });
            return step();
          }
          return entry.getFile().then(function (f) {
            out.push({ name: entry.name, kind: entry.kind, size: f.size,
                       modified: f.lastModified, handle: entry });
            return step();
          }).catch(step);
        });
      }
      return step();
    });
  }

  // A bounded recursive traversal for packaging. list() intentionally returns
  // one complete directory, which is useful for the revision browser but lets
  // a single huge directory allocate without limit. walk() counts every entry
  // as it is yielded and stops before descending farther.
  function walk(base, path, options) {
    options = options || {};
    var max = Math.max(1, Number(options.maxEntries) || 5000);
    var seen = 0, out = [];

    function visit(dir, prefix) {
      var it = dir.values();
      function step() {
        return it.next().then(function (res) {
          if (res.done) return null;
          var entry = res.value;
          var full = prefix + entry.name;
          seen += 1;
          if (seen > max) {
            throw new Error('The selected folder contains more than ' + max +
              ' entries. Choose a narrower report folder.');
          }
          if (options.skip && options.skip(entry, full)) return step();
          if (entry.kind === 'directory') {
            return visit(entry, full + '/').then(step);
          }
          return entry.getFile().then(function (f) {
            out.push({ name: full, kind: 'file', size: f.size,
              modified: f.lastModified, handle: entry });
          }).then(step);
        });
      }
      return step();
    }

    return directory(base, path, false).then(function (dir) {
      return visit(dir, '').then(function () { return out; });
    });
  }

  function remove(base, path) {
    var names;
    try { names = parts(path); } catch (e) { return Promise.reject(e); }
    var name = names.pop();
    if (!name) return Promise.reject(new Error('A path to remove is required.'));
    return directory(base, names.join('/'), false).then(function (dir) {
      return dir.removeEntry(name);
    });
  }

  return {
    supported: supported, isReady: isReady, handle: handle, setHandle: setHandle,
    grant: grant, pick: grant, permission: permission,
    usePersistence: usePersistence, remember: remember, recall: recall, forget: forget,
    directory: directory, read: read, readBytes: readBytes, write: write,
    list: list, walk: walk, remove: remove
  };
})();
