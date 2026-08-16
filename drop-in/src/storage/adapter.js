// Storage adapter. Every backend implements the same four calls, so the editor,
// the comment engine and the revision panel never know which one is live.
//
// The active backend is always named in the toolbar. A comment written to
// localStorage by someone who believed they were committing is the worst
// failure this tool can produce, so the destination is stated rather than
// inferred.
Ryker.storage = (function () {
  'use strict';

  var backends = {};
  var active = null;
  var listeners = [];

  function register(name, backend) { backends[name] = backend; }
  function get(name) { return backends[name]; }
  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  // Order matters: the most durable available backend wins, and local storage
  // is the floor that is always present.
  function detect() {
    var cfg = Ryker.config.load();
    if (cfg.RYKER_GITHUB_ENABLED && cfg.RYKER_GITHUB_OWNER && cfg.RYKER_GITHUB_REPO &&
        backends.github && backends.github.isReady()) {
      return use('github');
    }
    if (backends.fs && backends.fs.isReady()) return use('fs');
    return use('local');
  }

  function use(name) {
    if (!backends[name]) return active;
    active = backends[name];
    active.name = name;
    emit();
    return active;
  }

  function current() { return active || use('local'); }

  function label() {
    var b = current();
    return b ? b.describe() : 'No storage';
  }

  function canWrite() {
    var b = current();
    return !!(b && b.canWrite());
  }

  function load() {
    var b = current();
    if (!b) return Promise.resolve({ records: [] });
    return b.load().catch(function (err) {
      // A backend that cannot load must not take the document down with it.
      Ryker.log('storage load failed on ' + b.name + ': ' + (err && err.message));
      return { records: [], error: err };
    });
  }

  function save(payload) {
    var b = current();
    if (!b) return Promise.reject(new Error('No storage backend'));
    return b.save(payload);
  }

  return {
    register: register, get: get, detect: detect, use: use, current: current,
    label: label, canWrite: canWrite, load: load, save: save, onChange: onChange,
    names: function () { return Object.keys(backends); }
  };
})();
