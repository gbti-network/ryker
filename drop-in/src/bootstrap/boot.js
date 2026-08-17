// The entry point: boot sequence, failure isolation and the toolbar.
//
// Nothing here is durable, by design rather than by omission. No journal, no
// revision browser, no comment engine, no storage backend. A save writes
// nowhere. It folds the edit into a set of instructions in the pane, and that
// text is the artifact the person leaves with.
//
// This was two files until the 2026-08-16 decommission: bootstrap/boot.js
// booted the full build and ui/toolbar.js drew its bar, while the instruction
// build carried its own smaller copy of both in lite/lite.js. That build is now
// the only build, so its copy took this name. The two-build tree is at the
// v0.1.0-two-builds tag if the older shape is ever needed.
Ryker.boot = (function () {
  'use strict';

  var handle = null, bar = null, expanded = false;
  var els = {};
  var started = false;
  // Whether the folder grant has been offered in this session. One prompt, on
  // the first save that needs it; see the comment in save() for why not more.
  var askedForGrant = false;

  function d() { return Ryker.dom; }

  // Spec section 42: Ryker must not be able to destroy the report merely
  // because a module fails, and the document must stay readable either way.
  //
  // This lived in bootstrap/boot.js, which was the full build's entry point and
  // went with it in the decommission. Three of the five failure domains section
  // 42 names went too (GitHub, comments, revisions, authentication), but
  // packaging remains and so does the principle, and start() below calls eleven
  // initialisers in a row where any one throwing would leave a half-mounted
  // editor over someone's document. Ryker.log survived the deletion as a
  // reference in history.js with nothing defining it, so it is restored here.
  var problems = [];

  function log(msg) {
    problems.push(msg);
    if (window.console && console.warn) console.warn('[ryker] ' + msg);
  }

  function guard(label, fn) {
    try { return fn(); }
    catch (e) { log(label + ': ' + (e && e.message)); return null; }
  }

  function build() {
    if (bar) return;

    handle = d().el('button', {
      class: 'handle', title: 'Open Ryker', 'aria-expanded': 'false',
      onclick: function () { expand(true); }
    }, [
      d().el('span', { class: 'dot' }),
      d().el('span', { text: 'Ryker' }),
      d().el('span', { class: 'badge', text: '' })
    ]);
    Ryker.shell.add(handle);

    // No Edit toggle. Ryker exists to edit, and a mode switch that is always in
    // the same position is a control nobody ever needs to touch.
    els.save = d().el('button', { class: 'rk', text: 'Save', onclick: save });
    els.pane = d().el('button', { class: 'rk count-only',
      onclick: function () { Ryker.pane.toggle(); } });

    // Export is gone: the instruction pane is what someone leaves with. What
    // remains is occasional, so it sits behind the ellipsis rather than taking
    // permanent room in the bar.
    els.more = Ryker.icons.button('more', 'More actions');
    els.more.setAttribute('aria-haspopup', 'menu');
    els.more.setAttribute('aria-expanded', 'false');
    els.more.addEventListener('click', buildMenu);
    buildMenu();

    els.note = d().el('button', { class: 'where', type: 'button',
      onclick: function () { if (!Ryker.logger.isOn()) startLogging(); } }, [
      d().el('span', { class: 'dot' }),
      d().el('span', { class: 'lbl', text: 'Nothing is saved anywhere' })
    ]);
    els.collapse = d().el('button', { class: 'rk', text: 'Hide', onclick: function () { expand(false); } });

    // Left of the name, not among the actions on the right: the outline is a
    // view of the document rather than a thing done to it. Ghost, so it reads as
    // part of the name beside it. The active state still paints, because .on is
    // declared after .ghost at equal specificity.
    els.outline = Ryker.icons.button('outline', 'Show or hide the outline', function () {
      Ryker.rail.toggle();
    }, 'ghost rail-toggle');
    Ryker.rail.onToggle(sync);

    bar = d().el('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Ryker' }, [
      els.outline,
      d().el('span', { class: 'brand', text: 'Ryker' }),
      d().el('span', { class: 'spacer' }),
      els.note, els.more, els.pane, els.collapse, els.save
    ]);

    Ryker.tooltip.attach(els.save, 'Save the edits into the instructions (Ctrl+S)');
    Ryker.tooltip.attach(els.pane, 'Show or hide the instructions');
    Ryker.tooltip.attach(els.outline, 'Show or hide the outline');
    Ryker.tooltip.attach(els.more, 'More actions');
    Ryker.tooltip.attach(els.collapse, 'Collapse the toolbar');
    bar.style.display = 'none';
    Ryker.shell.add(bar);
  }

  // Rebuilt on open so the logging entry reflects whether it is currently on.
  function buildMenu() {
    Ryker.menu.attach(els.more, [
      { label: 'Export report...', icon: 'download', run: exportMenu },
      { label: 'Package report', icon: 'package', run: function () { Ryker.packager.open(); } },
      { label: 'Download instructions', icon: 'download', run: function () { Ryker.pane.download(); } },
      { label: 'Copy instructions', icon: 'copy', run: function () { Ryker.pane.copy(); } },
      null,
      { label: 'Change requests...', icon: 'package', run: function () { Ryker.browser.open(); } },
      Ryker.logger.isOn()
        ? { label: 'Logging to ' + Ryker.logger.where(), icon: 'download', disabled: true }
        : { label: 'Choose the folder to log to...', icon: 'download', run: startLogging },
      null,
      { label: 'Clear document', icon: 'trash', danger: true,
        run: function () { Ryker.pane.confirmClear(); } }
    ]);
  }

  // Spec section 21, restored 2026-08-16.
  //
  // exportHtml.clean() and withRyker() survived the decommission intact and the
  // test suite proves clean() round-trips a document character for character,
  // but the menu that reached them lived in ui/toolbar.js and was deleted with
  // the full build. So a required capability was fully implemented, fully
  // tested, documented in README and named in AGENT.md as the way to verify an
  // install, and reachable by nobody. sow-006 retired comments, revisions and
  // GitHub; it never retired export.
  //
  // Lifted from the deleted toolbar.js with the Journal button dropped, since
  // exportHtml.journalJson() went with the revision journal.
  function exportMenu() {
    var base = Ryker.exportHtml.baseName();
    Ryker.dialog.open({
      title: 'Export',
      body: '<p><b>Clean HTML</b> is the report on its own, with Ryker taken out. This is what ' +
        'you send to someone who should read it rather than edit it.</p>' +
        '<p><b>With Ryker</b> keeps the editor attached, so whoever opens it can carry on ' +
        'editing and leave with their own instruction set.</p>',
      buttons: [
        { label: 'Cancel' },
        {
          label: 'With Ryker',
          action: function () {
            var o = Ryker.exportHtml.scanned('ryker');
            if (o.hits.length) { Ryker.dialog.leak(o.hits); return; }
            Ryker.exportHtml.download(o.html, base + '-ryker.html');
          }
        },
        {
          label: 'Clean HTML', primary: true,
          action: function () {
            var o = Ryker.exportHtml.scanned('clean');
            if (o.hits.length) { Ryker.dialog.leak(o.hits); return; }
            Ryker.exportHtml.download(o.html, base + '.html');
          }
        }
      ]
    });
  }

  function startLogging() {
    if (!Ryker.logger.supported()) {
      Ryker.dialog.alert('Not available in this browser',
        'Writing to a folder needs the File System Access API, which Chrome and Edge ' +
        'have and other browsers do not. Use Download instructions instead.', 'warn');
      return;
    }
    var held = Ryker.logger.pendingCount();
    Ryker.dialog.open({
      title: 'Choose where change requests are written',
      body: '<p>Pick the folder this report is in. Every save is then written to ' +
        '<code>' + Ryker.logger.LIB + '/' + Ryker.logger.DIR_NAME + '/</code>.</p>' +
        (held ? '<p class="muted">' + held + ' save(s) are waiting and will be written ' +
          'straight away.</p>' : '') +
        '<p class="muted">A browser cannot write to a folder it has not been shown. ' +
        'This is asked once.</p>',
      buttons: [
        { label: 'Cancel' },
        { label: 'Choose folder', primary: true, action: function () {
            Ryker.logger.choose().then(function (ok) {
              sync();
              if (ok) Ryker.pane.flash('Logging to ' + Ryker.logger.where() +
                (held ? '. ' + held + ' held save(s) written.' : '.'), 'ok');
              else if (Ryker.logger.error()) Ryker.dialog.alert('Could not use that folder',
                Ryker.dom.escapeHtml(Ryker.logger.error()), 'bad');
            });
          } }
      ]
    });
  }

  // Polls rather than subscribes, because a dialog can be closed by Escape, by
  // the backdrop or by any of its own buttons, and one timer is cheaper than
  // teaching every one of those paths to notify.
  function askWhenClear() {
    var tries = 0;
    (function wait() {
      if (Ryker.logger.isOn()) return;
      if (!Ryker.dialog.isOpen()) { startLogging(); return; }
      if (++tries > 240) return;
      setTimeout(wait, 500);
    })();
  }

  function expand(open) {
    // build() runs under guard(), so there may be no toolbar. sync() has always
    // returned early on this; expand() dereferenced `bar` regardless, which is
    // how a cosmetic failure used to take editing down with it.
    if (!bar || !handle) return;
    expanded = !!open;
    if (!expanded && Ryker.rail && Ryker.rail.isOpen()) Ryker.rail.toggle(false);
    bar.style.display = expanded ? 'flex' : 'none';
    handle.style.display = expanded ? 'none' : 'flex';
    handle.setAttribute('aria-expanded', String(expanded));
    if (!expanded) {
      Ryker.formatbar.hide();
      Ryker.shell.releaseOffset();
    }
    sync();
  }

  // Only one row now that formatting floats over the selection, so the offset
  // is simply the bar's own height.
  function layout() {
    if (!expanded) return;
    Ryker.shell.setOffset(bar.getBoundingClientRect().height);
    Ryker.pane.reflow();
  }

  // A save writes nothing. It takes the edits made since the last one,
  // folds them into the instruction set, and rebases so the next save records
  // only what changed after this point. The instructions themselves still quote
  // the document as authored, not as it was at the previous save.
  function save(quiet) {
    var changes = Ryker.editable.changes();
    // A move rewrites no block, so changes() is empty after one and this used
    // to refuse the save that would have recorded it. Order is the other half
    // of what a save captures.
    var moves = Ryker.move.count();
    if (!changes.length && !moves) {
      // A keyboard save that found nothing should not put a dialog in the way.
      // Someone pressing Ctrl+S out of habit gets a note, not an interruption.
      if (quiet) {
        if (!Ryker.pane.isOpen()) Ryker.pane.toggle();
        Ryker.pane.flash('Nothing to save. The instructions are already current.');
        return;
      }
      Ryker.dialog.alert('Nothing to save', 'No text has changed since the last save.');
      return;
    }
    Ryker.instructions.record();
    Ryker.editable.rebase();
    Ryker.pane.refresh(true);
    if (!Ryker.pane.isOpen()) Ryker.pane.toggle();
    sync();
    // Fire and forget. A logging failure is reported in the pane and never
    // interrupts the save that produced it.
    Ryker.logger.record(Ryker.pane.value()).then(function (ok) {
      if (!ok && !Ryker.logger.isOn() && Ryker.logger.supported()) {
        // Ask once per session, then never again.
        //
        // This used to ask never, and the reasoning is worth keeping because it
        // is still true of the case it described: a modal over the report
        // "covered the document, swallowed clicks, and arrived at the moment
        // someone had just finished working". What made that intolerable was
        // that it arrived on EVERY save.
        //
        // The owner decided on 2026-08-16 that a save needing a grant should
        // prompt for one, since a browser cannot write to a folder it has not
        // been shown and silently holding the work teaches nobody that. Asking
        // on the first save only keeps that decision and keeps what the old one
        // was protecting against, because the chip and the held count still
        // carry every save after it.
        if (!askedForGrant) {
          askedForGrant = true;
          startLogging();
          sync();
          return;
        }
        Ryker.pane.flash(Ryker.logger.pendingCount() +
          ' save(s) held in this tab. Click "held in this tab only" to write them.', 'warn');
        sync();
        return;
      }
      if (ok) Ryker.pane.flash('Saved. Copy written to ' + Ryker.logger.where() + '.', 'ok');
      else if (Ryker.logger.error()) Ryker.pane.flash('Could not write the log copy: ' +
        Ryker.logger.error(), 'warn');
      sync();
    });
  }

  function sync() {
    if (!bar) return;
    var editing = Ryker.editable.isOn();
    var dirty = Ryker.editable.isDirty();
    var edits = Ryker.instructions.edits().length + Ryker.instructions.moves().length;

    // Save keeps the same plain treatment as Hide. It sits beside it and they
    // are both ordinary actions; colouring one of them made it read as a state.
    els.save.disabled = !dirty;
    els.save.textContent = 'Save';

    els.pane.textContent = '';
    els.pane.appendChild(d().el('span', {
      class: 'count' + (edits ? ' warn' : ''), text: String(edits)
    }));
    els.pane.classList.toggle('on', Ryker.pane.isOpen());
    if (els.outline) {
      els.outline.classList.toggle('on', Ryker.rail.isOpen());
      Ryker.tooltip.attach(els.outline,
        Ryker.rail.isOpen() ? 'Hide the outline' : 'Show the outline');
    }

    var held = Ryker.logger.pendingCount();
    els.note.querySelector('.lbl').textContent = Ryker.logger.isOn()
      ? 'Writing to ' + Ryker.logger.where()
      : (held
          ? held + ' save(s) held in this tab only'
          : (edits ? edits + ' edit(s) held in this tab only' : 'Nothing is saved anywhere'));
    els.note.disabled = Ryker.logger.isOn() || !Ryker.logger.supported();
    els.note.querySelector('.dot').className = 'dot ' + (edits ? 'warn' : '');
    Ryker.tooltip.attach(els.note, Ryker.logger.isOn()
      ? 'Every save also writes a copy to ' + Ryker.logger.where() + '.'
      : 'Nothing has been written to disk yet. Click to choose the folder, ' +
        'and every save held in this tab is written straight away.');
    els.note.querySelector('.dot').classList.toggle('ok', Ryker.logger.isOn());

    Ryker.tooltip.attach(els.pane,
      edits + ' edit(s) recorded. Show or hide the instructions.');

    var badge = handle.querySelector('.badge');
    badge.textContent = edits ? String(edits) : '';
    badge.style.display = edits ? '' : 'none';
    handle.querySelector('.dot').classList.toggle('on', editing);

    layout();
  }

  function start() {
    if (started) return;
    started = true;
    var cfg = guard('config', function () { return Ryker.config.load(); });
    if (!cfg) return;
    if (cfg.RYKER_ENABLED === false) return;
    if (cfg._leaked && cfg._leaked.length) {
      Ryker.shell.mount();
      Ryker.dialog.open({
        title: 'Ryker did not start',
        body: '<div class="note bad">This report ships configuration keys that must never ' +
          'leave a build machine: <b>' + Ryker.dom.escapeHtml(cfg._leaked.join(', ')) + '</b>.</div>',
        dismissable: false
      });
      return;
    }

    // The shell is the one stage with no fallback: everything below draws into
    // it, so a failure here stops the boot rather than degrading it.
    if (guard('shell', function () { Ryker.shell.mount(); return true; }) === null) return;
    // Taken before Edit Mode opens, so every instruction can quote the document
    // as authored rather than as it stood at the previous save.
    guard('origin', function () { Ryker.instructions.captureOrigin(); });
    guard('toolbar', build);
    guard('pane', function () { Ryker.pane.build(); });
    guard('formatbar', function () { Ryker.formatbar.init(); });
    guard('pick', function () { Ryker.pick.init(); });
    guard('multi', function () { Ryker.multi.init(); });
    guard('rail', function () { Ryker.rail.build(); Ryker.rail.init(); });
    guard('history', function () { Ryker.history.bind(); });
    guard('tooltip', function () { Ryker.tooltip.init(); });

    guard('wire', function () {
      Ryker.editable.onChange(sync);
      Ryker.instructions.onChange(function () { Ryker.pane.refresh(); sync(); });
    });

    document.addEventListener('keydown', function (e) {
      // Ctrl+S, or Cmd+S. Taken over because in a document with an editor
      // attached it plainly means "save my edits", not "write this page to
      // disk", and the browser's own dialog would do the wrong thing.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        save(true);
        return;
      }
      if (e.key !== 'Escape') return;
      if (Ryker.menu.isOpen()) { Ryker.menu.close(); e.stopPropagation(); e.preventDefault(); return; }
      if (Ryker.dialog.isOpen()) { Ryker.dialog.closeTop(); e.stopPropagation(); e.preventDefault(); }
    }, true);

    // Ryker opens ready to work and stays that way: expanded, editing, pane
    // showing. Its whole purpose is the pane, so starting collapsed would hide
    // the point of it, and a mode switch would only ever be turned back on.
    //
    // Guarded stage by stage rather than as one block, and the order matters.
    // Editing is the capability worth protecting, so it must not sit behind
    // anything cosmetic: an earlier version of this ran the whole tail bare, and
    // a failure inside build() left `bar` null, expand() threw dereferencing it,
    // and the document was never made editable at all. Toolbar chrome failing
    // now costs the toolbar and nothing else.
    guard('expand', function () { expand(true); });
    guard('editable', function () { Ryker.editable.enable(); });
    guard('sync', sync);
    guard('recover', function () { Ryker.recover.offer(); });
    Ryker.logger.resume().then(function (ok) {
      sync();
      // Asking on load is the only honest reading of "always on": the picker
      // needs a click, so the click has to be offered rather than waited for.
      // Deliberately not asked here. A modal on load covers the report with a
      // backdrop that swallows every click before anyone has done anything,
      // which is a poor trade for a grant that is only needed once a save
      // exists to write. Saves are queued until it arrives, so nothing is lost
      // by waiting for the first one.
    });
    Ryker.logger.onChange(buildMenu);
  }

  return {
    start: start, sync: sync, save: save, expand: expand,
    log: log, problems: function () { return problems.slice(); }
  };
})();

// history.js calls this behind an `if (Ryker.log)` guard. bootstrap/boot.js used
// to define it and no longer exists, so without this line the guard is
// permanently false and the diagnostic silently does nothing.
Ryker.log = Ryker.boot.log;

(function () {
  'use strict';
  function go() { Ryker.boot.start(); }
  function schedule() {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    setTimeout(go, 50);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule);
  else schedule();
})();
