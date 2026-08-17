// An in-memory File System Access implementation, injected into the page.
//
// Everything downstream of the folder grant was untestable: the picker needs a
// real click that CDP cannot supply, so the change-request log, the merged
// export and the clear button all shipped unverified. This replaces
// showDirectoryPicker with one that resolves immediately against a fake tree,
// which turns the entire path into something the suite can drive.
//
// It implements only what storage/logger.js actually calls. That is deliberate:
// a fuller fake would pass even if the logger started using an API no browser
// grants from a file:// page.
export const FAKE_FS = `(function () {
  function FileHandle(name) {
    this.kind = 'file';
    this.name = name;
    this._data = '';
    this._modified = 1755000000000;
  }
  FileHandle.prototype.createWritable = function () {
    var self = this;
    return Promise.resolve({
      write: function (contents) { self._data = String(contents); return Promise.resolve(); },
      close: function () {
        return new Promise(function (resolve) {
          setTimeout(function () { self._modified += 1000; resolve(); }, window.__fakeFsWriteDelay || 0);
        });
      }
    });
  };
  FileHandle.prototype.getFile = function () {
    var self = this;
    return Promise.resolve({
      size: self._data.length,
      lastModified: self._modified,
      text: function () { return Promise.resolve(self._data); },
      arrayBuffer: function () {
        return Promise.resolve(new TextEncoder().encode(self._data).buffer);
      }
    });
  };

  function DirHandle(name) {
    this.kind = 'directory';
    this.name = name;
    this._children = {};
  }
  DirHandle.prototype.getDirectoryHandle = function (name, opts) {
    var c = this._children[name];
    if (!c && !(opts && opts.create)) return Promise.reject(new Error('no such directory: ' + name));
    if (!c) { c = this._children[name] = new DirHandle(name); }
    if (c.kind !== 'directory') return Promise.reject(new Error('not a directory: ' + name));
    return Promise.resolve(c);
  };
  DirHandle.prototype.getFileHandle = function (name, opts) {
    var c = this._children[name];
    if (!c && !(opts && opts.create)) return Promise.reject(new Error('no such file: ' + name));
    if (!c) { c = this._children[name] = new FileHandle(name); }
    if (c.kind !== 'file') return Promise.reject(new Error('not a file: ' + name));
    return Promise.resolve(c);
  };
  DirHandle.prototype.removeEntry = function (name) {
    if (!this._children[name]) return Promise.reject(new Error('no such entry: ' + name));
    delete this._children[name];
    return Promise.resolve();
  };
  // The async iterator logger.list() walks.
  DirHandle.prototype.values = function () {
    var items = Object.keys(this._children).map(function (k) { return this._children[k]; }, this);
    var i = 0;
    return {
      next: function () {
        return Promise.resolve(i < items.length
          ? { done: false, value: items[i++] }
          : { done: true, value: undefined });
      }
    };
  };
  DirHandle.prototype.queryPermission = function () { return Promise.resolve('granted'); };
  DirHandle.prototype.requestPermission = function () { return Promise.resolve('granted'); };

  var root = new DirHandle('FakeReports');

  // A handle the browser will refuse to persist.
  //
  // The fake's methods live on prototypes, and structured clone copies own
  // enumerable properties only, so the ordinary fake clones into IndexedDB
  // happily. Real browsers hit the opposite case: a genuine
  // FileSystemDirectoryHandle is cloneable, but IndexedDB itself can be
  // unavailable in private browsing, disabled by policy, or over quota, and
  // logger.js awaits remember() before it emits. An own-property function makes
  // put() throw DataCloneError, which is the same shape of failure and is the
  // only way to reach that path from a test.
  window.__fakeFsUncloneable = function () {
    root.poison = function () { return 1; };
  };

  // A test drives the grant by flipping this, so the "someone cancelled the
  // picker" path is reachable too.
  window.__fakeFsCancel = false;
  window.__fakeFsWriteDelay = 0;

  window.showDirectoryPicker = function () {
    if (window.__fakeFsCancel) {
      var err = new Error('The user aborted a request.');
      err.name = 'AbortError';
      return Promise.reject(err);
    }
    return Promise.resolve(root);
  };

  // Inspection for assertions. Walks the tree and returns paths to contents, so
  // a test can say where a record landed rather than only that one exists.
  window.__fakeFsDump = function () {
    var out = {};
    (function walk(dir, prefix) {
      Object.keys(dir._children).forEach(function (k) {
        var c = dir._children[k];
        if (c.kind === 'directory') walk(c, prefix + k + '/');
        else out[prefix + k] = c._data;
      });
    })(root, '');
    return out;
  };
})();`;
