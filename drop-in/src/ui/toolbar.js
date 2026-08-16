// The toolbar. Collapsed to a handle by default, because the reports put their
// table of contents at position:sticky; top:0 and an idle editor should cost
// the reader nothing.
Ryker.toolbar = (function () {
  'use strict';

  var handle = null, bar = null, expanded = false;
  var els = {};

  function d() { return Ryker.dom; }

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

    els.mode = d().el('button', {
      class: 'rk', text: 'Edit', title: 'Turn Edit Mode on or off',
      onclick: toggleEdit
    });
    els.save = d().el('button', { class: 'rk', text: 'Save', onclick: function () { Ryker.save.start(); } });
    els.comments = d().el('button', {
      class: 'rk', onclick: function () { Ryker.panel.toggle('comments'); }
    });
    els.showHide = d().el('button', {
      class: 'rk', onclick: function () {
        Ryker.comments.setVisible(!Ryker.comments.isVisible());
        sync();
      }
    });
    els.revisions = d().el('button', {
      class: 'rk', onclick: function () { Ryker.panel.toggle('revisions'); }
    });
    els.exportBtn = d().el('button', { class: 'rk', text: 'Export', onclick: exportMenu });
    els.pkg = d().el('button', { class: 'rk', text: 'Package', onclick: function () { Ryker.packager.open(); } });
    els.auth = d().el('button', { class: 'rk', onclick: function () { Ryker.onboard.open(); } });
    els.where = d().el('span', { class: 'where' }, [
      d().el('span', { class: 'dot' }),
      d().el('span', { class: 'lbl' })
    ]);
    els.collapse = d().el('button', {
      class: 'rk', text: 'Hide', title: 'Collapse the toolbar',
      onclick: function () { expand(false); }
    });

    bar = d().el('div', { class: 'bar', role: 'toolbar', 'aria-label': 'Ryker' }, [
      d().el('span', { class: 'brand', text: 'Ryker' }),
      els.mode, els.save,
      d().el('span', { class: 'sep' }),
      els.comments, els.showHide, els.revisions,
      d().el('span', { class: 'sep' }),
      els.exportBtn, els.pkg,
      d().el('span', { class: 'spacer' }),
      els.where, els.auth, els.collapse
    ]);
    bar.style.display = 'none';
    Ryker.shell.add(bar);
  }

  function expand(open) {
    expanded = !!open;
    bar.style.display = expanded ? 'flex' : 'none';
    handle.style.display = expanded ? 'none' : 'flex';
    handle.setAttribute('aria-expanded', String(expanded));
    if (expanded) {
      // Measured rather than assumed, because the bar wraps at narrow widths.
      Ryker.shell.setOffset(bar.getBoundingClientRect().height);
    } else {
      Ryker.formatbar.hide();
      Ryker.shell.releaseOffset();
      Ryker.panel.close();
    }
    sync();
  }

  function toggleEdit() {
    if (Ryker.editable.isOn()) {
      if (Ryker.editable.isDirty()) {
        Ryker.dialog.confirm('Leave Edit Mode?',
          '<p>You have unsaved changes. Leaving Edit Mode keeps them in the page; it does not ' +
          'discard them and it does not save them.</p>',
          'Leave Edit Mode', function () { Ryker.editable.disable(); sync(); });
        return;
      }
      Ryker.editable.disable();
      sync();
      return;
    }

    if (!Ryker.storage.canWrite()) {
      var cfg = Ryker.config.load();
      if (cfg._state === 'configured') {
        Ryker.dialog.confirm('Sign in before editing',
          '<p>This report saves to <code>' + d().escapeHtml(Ryker.config.repoSlug(cfg)) + '</code>, ' +
          'and Ryker has not confirmed you can write there yet.</p>' +
          '<p>You can edit anyway. Changes stay in this browser and are clearly marked as local ' +
          'and uncommitted until you sign in.</p>',
          'Edit locally', function () { Ryker.editable.enable(); sync(); });
        return;
      }
    }
    Ryker.editable.enable();
    sync();
  }

  function exportMenu() {
    var base = Ryker.exportHtml.baseName();
    Ryker.dialog.open({
      title: 'Export',
      body: '<p><b>Clean HTML</b> is the report on its own, with Ryker taken out. This is what ' +
        'you send to someone who should read it rather than edit it.</p>' +
        '<p><b>With Ryker</b> keeps the editor attached, so whoever opens it can carry on ' +
        'commenting and editing.</p>' +
        '<p><b>Journal</b> is the revision and comment record as JSON, for handing your work back ' +
        'to the author when you have no repository to commit to.</p>',
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Journal JSON',
          action: function () {
            Ryker.exportHtml.download(Ryker.exportHtml.journalJson(),
              base + '-ryker-journal.json', 'application/json');
          }
        },
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

  function sync() {
    if (!bar) return;
    var counts = Ryker.comments.counts();
    var editing = Ryker.editable.isOn();
    var dirty = Ryker.editable.isDirty() || Ryker.comments.hasPending();
    var cfg = Ryker.config.load();

    els.mode.textContent = editing ? 'Editing' : 'Edit';
    els.mode.classList.toggle('on', editing);
    els.save.disabled = !dirty;
    els.save.textContent = dirty ? 'Save changes' : 'Save';
    els.save.classList.toggle('on', dirty);

    els.comments.textContent = 'Comments';
    els.comments.appendChild(d().el('span', {
      class: 'count' + (counts.open ? ' warn' : ''),
      text: String(counts.open)
    }));
    els.comments.classList.toggle('on', Ryker.panel.isOpen('comments'));
    els.comments.title = counts.open + ' open, ' + counts.resolved + ' resolved' +
      (counts.unanchored ? ', ' + counts.unanchored + ' unanchored' : '');

    els.showHide.textContent = Ryker.comments.isVisible() ? 'Hide marks' : 'Show marks';

    els.revisions.textContent = 'Revisions';
    els.revisions.appendChild(d().el('span', { class: 'count', text: String(Ryker.journal.count()) }));
    els.revisions.classList.toggle('on', Ryker.panel.isOpen('revisions'));

    var backend = Ryker.storage.current();
    els.where.querySelector('.lbl').textContent = backend.describe();
    var dot = els.where.querySelector('.dot');
    dot.className = 'dot ' + (Ryker.storage.canWrite() ? 'ok' : 'warn');
    els.where.title = backend.detail ? backend.detail() : '';

    var gh = Ryker.storage.get('github');
    if (cfg._state === 'configured') {
      els.auth.textContent = gh && gh.canWrite() ? (gh.identity() ? gh.identity().login : 'Signed in') : 'Sign in';
      els.auth.classList.toggle('on', !!(gh && gh.canWrite()));
    } else {
      els.auth.textContent = 'Set up';
      els.auth.classList.remove('on');
    }

    var badge = handle.querySelector('.badge');
    badge.textContent = counts.open ? String(counts.open) : '';
    badge.style.display = counts.open ? '' : 'none';
    handle.querySelector('.dot').classList.toggle('on', editing);
    handle.title = 'Open Ryker' + (counts.open ? ' (' + counts.open + ' open comments)' : '');

    if (expanded) {
      Ryker.shell.setOffset(bar.getBoundingClientRect().height);
      if (Ryker.panel.isOpen()) Ryker.panel.reflow();
    }
  }

  function isExpanded() { return expanded; }

  return { build: build, sync: sync, expand: expand, isExpanded: isExpanded };
})();
