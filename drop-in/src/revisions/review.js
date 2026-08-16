// Revision review. Answers what changed, who changed it and when, without
// sending anyone to a raw commit listing.
//
// The panel lists revisions; this shows one. Because the journal captured each
// delta at write time, a revision renders as a set of block-level prose diffs
// rather than as a unified diff over the whole file.
Ryker.review = (function () {
  'use strict';

  var current = null;

  function show(record) {
    current = record;
    var d = Ryker.dom;
    var s = Ryker.journal.summarize(record);

    var wrap = d.el('div');

    wrap.appendChild(d.el('div', { class: 'note' }, [
      d.el('div', {
        text: 'Revision ' + record.seq + ', by ' + ((record.author && record.author.name) || 'Unknown') +
          (record.author && record.author.source === 'self' ? ' (self-asserted)' : '') +
          ', ' + d.fmtDate(record.timestamp) + '. ' +
          s.additions + ' additions, ' + s.removals + ' removals across ' +
          s.blocks + (s.blocks === 1 ? ' block' : ' blocks') +
          (s.commentsAdded ? ', ' + s.commentsAdded + ' comments added' : '') +
          (s.commentsResolved ? ', ' + s.commentsResolved + ' comments resolved' : '') + '.'
      })
    ]));

    if (record.message) {
      wrap.appendChild(d.el('p', { class: 'muted', text: record.message }));
    }

    if (!record.changes.length) {
      wrap.appendChild(d.el('p', { class: 'muted', text: 'No text changed in this revision.' }));
    }

    record.changes.forEach(function (c) {
      var box = d.el('div', { class: 'blockdiff' });
      box.appendChild(d.el('div', { class: 'lbl', text: Ryker.blocks.label(c.id) }));

      var txt = d.el('div', { class: 'txt' });
      if (c.kind === 'added') {
        txt.appendChild(d.el('ins', { text: textOf(c.after) }));
      } else if (c.kind === 'removed') {
        txt.appendChild(d.el('del', { text: textOf(c.before) }));
      } else {
        txt.appendChild(Ryker.diff.renderInline(Ryker.diff.words(c.before, c.after)));
      }
      box.appendChild(txt);

      if (c.before != null) {
        box.appendChild(d.el('div', { class: 'acts', style: 'margin-top:7px' }, [
          d.el('button', {
            class: 'rk', text: 'Restore this block to the earlier text',
            onclick: function () {
              if (!Ryker.editable.isOn()) {
                Ryker.dialog.alert('Edit Mode is off',
                  'Turn on Edit Mode before restoring, so the change is recorded as an edit ' +
                  'you made rather than applied silently.', 'warn');
                return;
              }
              Ryker.editable.revertBlock(c.id, c.before);
              Ryker.dialog.closeTop();
              Ryker.toolbar.sync();
            }
          })
        ]));
      }
      wrap.appendChild(box);
    });

    (record.comments.added || []).forEach(function (cm) {
      wrap.appendChild(d.el('div', { class: 'blockdiff' }, [
        d.el('div', { class: 'lbl', text: 'Comment added on "' + trim(cm.quote) + '"' }),
        d.el('div', { class: 'txt', text: cm.body })
      ]));
    });

    Ryker.dialog.open({ title: 'Revision ' + record.seq, body: wrap });
  }

  function textOf(html) {
    var t = document.createElement('div');
    t.innerHTML = html == null ? '' : html;
    return t.textContent || '';
  }

  function trim(s) {
    s = String(s || '');
    return s.length > 48 ? s.slice(0, 45) + '...' : s;
  }

  function exit() { current = null; }

  return { show: show, exit: exit, current: function () { return current; } };
})();
