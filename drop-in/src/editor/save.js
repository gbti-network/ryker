// The save flow. Edits accumulate in a working state and land as one revision,
// after a confirmation that states exactly what is about to be written and
// where.
Ryker.save = (function () {
  'use strict';

  function pending() {
    var changes = Ryker.editable.changes();
    var cm = Ryker.comments.pendingCounts();
    return {
      changes: changes,
      commentsAdded: cm.added,
      commentsResolved: cm.resolved,
      any: changes.length > 0 || Ryker.comments.hasPending()
    };
  }

  function start() {
    var p = pending();
    if (!p.any) {
      Ryker.dialog.alert('Nothing to save', 'No text has changed and no comments are waiting.');
      return;
    }
    if (Ryker.identity.needsName()) {
      Ryker.identity.promptForName(function () { start(); });
      return;
    }

    var gh = Ryker.storage.current();
    if (gh && gh.name === 'github' && gh.checkConflict) {
      gh.checkConflict().then(function (res) {
        if (res.conflict) { conflictDialog(res); return; }
        confirmDialog(p);
      });
      return;
    }
    confirmDialog(p);
  }

  function conflictDialog(res) {
    var d = Ryker.dom;
    Ryker.dialog.open({
      title: 'The document changed on GitHub',
      body: d.el('div', {}, [
        d.el('div', { class: 'note bad' }, [
          d.el('div', {
            text: 'The document changed on GitHub since you began editing. Saving now would ' +
              'overwrite whatever that change was.'
          })
        ]),
        d.el('p', {
          text: 'Ryker will not merge two versions of a report automatically, because a wrong ' +
            'merge here loses someone\'s work silently. Export your version, reload the page to ' +
            'pick up theirs, and reapply your edits.'
        }),
        d.el('p', { class: 'muted', text: 'Loaded at ' + short(res.loadedSha) + ', now at ' + short(res.liveSha) + '.' })
      ]),
      buttons: [
        { label: 'Close' },
        {
          label: 'Export my version', primary: true,
          action: function () {
            var out = Ryker.exportHtml.scanned('clean');
            if (out.hits.length) { Ryker.dialog.leak(out.hits); return; }
            Ryker.exportHtml.download(out.html, Ryker.exportHtml.baseName() + '-mine.html');
          }
        }
      ]
    });
  }

  function short(sha) { return sha ? String(sha).slice(0, 8) : 'unknown'; }

  function confirmDialog(p) {
    var d = Ryker.dom;
    var cfg = Ryker.config.load();
    var backend = Ryker.storage.current();

    var msg = d.el('input', {
      class: 'rk', type: 'text',
      placeholder: 'What changed, in a few words',
      value: 'Update ' + cfg.RYKER_DOCUMENT_PATH
    });

    var list = d.el('div', { class: 'filelist' });
    p.changes.forEach(function (c) {
      var n = Ryker.diff.countChange(c);
      list.appendChild(d.el('div', { class: 'filerow' }, [
        d.el('span', { class: 'nm', text: Ryker.blocks.label(c.id) }),
        d.el('span', { class: 'sz', text: '+' + n.additions + ' / -' + n.removals })
      ]));
    });
    if (!p.changes.length) {
      list.appendChild(d.el('div', { class: 'filerow' }, [
        d.el('span', { class: 'nm muted', text: 'No text changes, comments only' })
      ]));
    }

    Ryker.dialog.open({
      title: 'Save changes',
      body: d.el('div', {}, [
        d.el('div', { class: 'note ' + (Ryker.storage.canWrite() ? 'ok' : 'warn') }, [
          d.el('div', {
            text: 'Saving to: ' + backend.describe() + '. ' + (backend.detail ? backend.detail() : '')
          })
        ]),
        d.el('label', { class: 'rk', text: 'Blocks changing' }),
        list,
        d.el('label', { class: 'rk', text: 'Comments' }),
        d.el('div', {
          text: p.commentsAdded + ' added, ' + p.commentsResolved + ' resolved'
        }),
        d.el('label', { class: 'rk', text: 'Author' }),
        d.el('div', { text: Ryker.identity.label() }),
        d.el('label', { class: 'rk', text: 'Message' }),
        msg
      ]),
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Save', primary: true,
          action: function (api) {
            commit(msg.value.trim(), api);
            return false;
          },
          keepOpen: true
        }
      ]
    });
  }

  function commit(message, api) {
    var p = pending();
    var cfg = Ryker.config.load();
    var drained = Ryker.comments.drain();

    var record = Ryker.journal.make({
      documentId: cfg.RYKER_DOCUMENT_ID,
      author: Ryker.identity.current(),
      message: message,
      changes: p.changes,
      commentsAdded: drained.added,
      commentsResolved: drained.resolved,
      commentsReopened: drained.reopened,
      commentsDeleted: drained.deleted
    });
    Ryker.journal.append(record);

    // The document written out is the clean copy, with Ryker's own chrome and
    // editing attributes removed, so what lands in storage is the report rather
    // than the report plus an editor session.
    var out = Ryker.exportHtml.scanned('ryker');
    if (out.hits.length) {
      Ryker.dialog.leak(out.hits);
      return;
    }

    Ryker.storage.save({
      records: Ryker.journal.serialize(),
      appended: [record],
      documentHtml: out.html,
      message: message,
      summary: Ryker.journal.summarize(record)
    }).then(function (res) {
      Ryker.editable.rebase();
      Ryker.comments.rebuild();
      if (api) api.close();
      Ryker.toolbar.sync();
      Ryker.panel.refresh();
      Ryker.dialog.alert('Saved',
        'Revision ' + record.seq + ' written to ' + Ryker.dom.escapeHtml(res.where || 'storage') + '.', 'ok');
    }).catch(function (err) {
      // The record stays in the journal and the working copy stays in the page.
      // Nothing is discarded because a write failed, per spec section 36.
      if (api) api.close();
      Ryker.dialog.open({
        title: 'Could not save',
        body: '<div class="note bad">' + Ryker.dom.escapeHtml(err.message) + '</div>' +
          '<p>Your edits and comments are still here. Nothing was discarded. ' +
          'Export them if you need to leave this page before the problem is fixed.</p>',
        buttons: [
          { label: 'Close' },
          {
            label: 'Export a copy', primary: true,
            action: function () {
              var o = Ryker.exportHtml.scanned('clean');
              if (o.hits.length) { Ryker.dialog.leak(o.hits); return; }
              Ryker.exportHtml.download(o.html, Ryker.exportHtml.baseName() + '-unsaved.html');
            }
          }
        ]
      });
    });
  }

  return { start: start, pending: pending };
})();
