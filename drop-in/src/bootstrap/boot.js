// Boot. Asynchronous and defensive: the report must remain fully usable if
// Ryker fails to initialise, so every stage is wrapped and a failure downgrades
// the toolbar rather than taking the document down.
Ryker.boot = (function () {
  'use strict';

  var started = false;
  var problems = [];

  function log(msg) {
    problems.push(msg);
    if (window.console && console.warn) console.warn('[ryker] ' + msg);
  }

  function guard(label, fn) {
    try { return fn(); }
    catch (e) { log(label + ': ' + (e && e.message)); return null; }
  }

  function start() {
    if (started) return Promise.resolve();
    started = true;

    var cfg = guard('config', function () { return Ryker.config.load(); });
    if (!cfg) return Promise.resolve();
    if (cfg.RYKER_ENABLED === false) return Promise.resolve();

    // A secret in shipped configuration is a hard stop rather than a warning.
    // Ryker refuses to run rather than operate a report that is leaking one.
    if (cfg._leaked && cfg._leaked.length) {
      guard('shell', function () { Ryker.shell.mount(); });
      guard('leak', function () {
        Ryker.dialog.open({
          title: 'Ryker did not start',
          body: '<div class="note bad">This report ships configuration keys that must never ' +
            'leave a build machine: <b>' + Ryker.dom.escapeHtml(cfg._leaked.join(', ')) + '</b>.</div>' +
            '<p>Anything in Ryker configuration is readable by anyone who opens the report, so ' +
            'these are already exposed. Rotate them, remove them from the config, and rebuild.</p>',
          dismissable: false
        });
      });
      return Promise.resolve();
    }

    guard('shell', function () { Ryker.shell.mount(); });
    guard('toolbar', function () { Ryker.toolbar.build(); });
    guard('select', function () { Ryker.select.init(); });
    guard('formatbar', function () { Ryker.formatbar.init(); });
    guard('multi', function () { Ryker.multi.init(); });
    guard('history', function () { Ryker.history.bind(); });
    guard('tooltip', function () { Ryker.tooltip.init(); });
    guard('keys', bindKeys);

    guard('wire', function () {
      Ryker.comments.onChange(function () { Ryker.toolbar.sync(); Ryker.panel.refresh(); });
      Ryker.editable.onChange(function () { Ryker.toolbar.sync(); });
      Ryker.storage.onChange(function () { Ryker.toolbar.sync(); });
    });

    return reload().then(function () {
      guard('sync', function () { Ryker.toolbar.sync(); });
    });
  }

  // Picks the backend, loads its journal, folds comments, anchors them. Called
  // again after sign-in, when a better backend becomes available.
  function reload() {
    return Promise.resolve()
      .then(function () {
        var gh = Ryker.storage.get('github');
        if (gh && gh.hasToken() && !gh.access()) return gh.verify();
        return null;
      })
      .then(function () { Ryker.storage.detect(); })
      .then(function () { return Ryker.storage.load(); })
      .then(function (res) {
        Ryker.journal.reset(res.records || []);

        // Identity is derived from the document's own text, so it has to be
        // computed while the document still IS its own text, before any saved
        // edit is put back on top of it.
        Ryker.blocks.seedIds();

        // A backend that rewrites the document has already put the edits back;
        // one that only holds a journal has not, and the file on disk is still
        // the original. Replaying before the baseline is taken is what makes a
        // save survive a reload in browser-only mode.
        var backend = Ryker.storage.current();
        if (backend && !backend.ownsDocument && Ryker.journal.count()) {
          var out = Ryker.blocks.applyRecords(Ryker.journal.all());
          if (out.missed) {
            log('restored ' + out.applied + ' change(s), ' + out.missed +
                ' could not be placed and were skipped');
          }
        }

        Ryker.editable.setBaseline(Ryker.blocks.snapshot());
        Ryker.comments.rebuild();
        if (res && res.error) log('journal load: ' + (res.error.message || res.error));
      })
      .catch(function (e) { log('reload: ' + (e && e.message)); });
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      // Ctrl+S, or Cmd+S. Only while editing: a reader pressing it means "save
      // this page to disk" and should keep the browser's own behaviour.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
        if (!Ryker.editable.isOn()) return;
        e.preventDefault();
        e.stopPropagation();
        if (Ryker.editable.isDirty() || Ryker.comments.hasPending()) Ryker.save.start();
        return;
      }
      if (e.key !== 'Escape') return;
      // Ryker's own overlays close first, and the event stops here so the
      // report's Escape handler does not also fire and close its lightbox.
      if (Ryker.dialog.isOpen()) {
        Ryker.dialog.closeTop();
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (Ryker.panel.isOpen()) {
        Ryker.panel.close();
        e.stopPropagation();
      }
    }, true);
  }

  function status() {
    return { started: started, problems: problems.slice() };
  }

  return { start: start, reload: reload, status: status, log: log };
})();

Ryker.log = Ryker.boot.log;

// Deferred so the report paints before Ryker does any work, per spec section
// 41. requestAnimationFrame is the right signal when the page is visible and
// the wrong one to depend on: it does not fire in a background tab, during a
// headless render, or while printing, and Ryker would then never initialise at
// all. So a timer races it and whichever arrives first wins, with start()
// idempotent so the loser is harmless.
(function () {
  'use strict';
  function go() { Ryker.boot.start(); }
  function schedule() {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    setTimeout(go, 50);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule);
  } else {
    schedule();
  }
})();
