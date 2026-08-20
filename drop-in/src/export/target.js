// Where "Save Document" writes, when writing back to the opened file is
// possible at all.
//
// Until 2026-08-20 every way out of Ryker was a download: four buttons, one
// blob, one anchor click. The export dialog told a Markdown reader it "writes
// your edits back into the file you opened", which described the diff (true:
// untouched lines come back byte for byte) in the vocabulary of a save
// (false: nothing was ever written back). This module is the half that was
// missing, so the sentence can become true rather than be softened.
//
// SURFACE-AGNOSTIC BY CONSTRUCTION. The File System Access API does not appear
// here and must not. A drop-in page is the document; it holds no handle to
// itself and cannot acquire one, so on that surface there is no target and
// Save Document does not appear. The extension workspace opens a real file and
// registers what it got. Everything above this module asks `available()` and
// stays out of the question of how a given surface writes.
Ryker.saveTarget = (function () {
  'use strict';

  // { name, write(text) -> Promise, ensureWritable() -> Promise<boolean> }
  var current = null;

  /** Adopt a writable document, or clear with no argument. The workspace calls
   *  this once per opened file, and again with null when a write is refused,
   *  so a revoked permission stops advertising a Save that cannot happen. */
  function set(target) {
    if (!target || typeof target.write !== 'function') { current = null; return null; }
    current = target;
    return current;
  }

  function clear() { current = null; }

  function available() { return !!current; }

  /** The file name to put in front of a person before overwriting their work.
   *  Never a path: the handle knows where it came from and Ryker does not. */
  function name() {
    return (current && current.name) ? String(current.name) : '';
  }

  /** Raise a read handle to a writable one. Split out from write() because the
   *  grant needs a user gesture, and the gesture we have is the click on the
   *  confirmation, not the click that opened it. Targets without a permission
   *  model resolve true. */
  function ensureWritable() {
    if (!current) return Promise.reject(new Error('No document is open for saving.'));
    if (typeof current.ensureWritable !== 'function') return Promise.resolve(true);
    return Promise.resolve().then(function () { return current.ensureWritable(); });
  }

  /** Overwrite the opened file. Resolves with the name written, so a caller can
   *  report what happened without holding the target itself. */
  function write(text) {
    if (!current) return Promise.reject(new Error('No document is open for saving.'));
    var target = current;
    return Promise.resolve().then(function () { return target.write(text); })
      .then(function () { return target.name; });
  }

  return {
    set: set, clear: clear, available: available,
    name: name, ensureWritable: ensureWritable, write: write
  };
})();
