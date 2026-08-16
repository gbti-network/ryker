// The side panel. One surface, two views: comments and revisions.
Ryker.panel = (function () {
  'use strict';

  var node = null, bodyEl = null, titleEl = null, footEl = null;
  var view = null;
  var filter = 'open';
  var activeRev = null;

  function d() { return Ryker.dom; }

  function ensure() {
    if (node) return node;
    titleEl = d().el('h2', { text: 'Comments' });
    bodyEl = d().el('div', { class: 'body' });
    footEl = d().el('div', { class: 'foot' });
    node = d().el('div', { class: 'panel', role: 'complementary' }, [
      d().el('header', {}, [
        titleEl,
        d().el('div', { class: 'spacer' }),
        d().el('button', { class: 'rk', text: 'Close', onclick: close })
      ]),
      bodyEl,
      footEl
    ]);
    Ryker.shell.add(node);
    return node;
  }

  function open(which) {
    ensure();
    view = which;
    node.style.display = 'flex';
    render();
    reflow();
    Ryker.toolbar.sync();
  }

  // The panel prefers to sit in the layout's own right margin. Only when the
  // margin is too narrow does the report give up any width, and only as much as
  // the shortfall.
  function reflow() {
    if (!node || node.style.display === 'none') return;
    Ryker.shell.setPanelSpace(node);
  }

  function close() {
    if (node) node.style.display = 'none';
    view = null;
    Ryker.shell.releasePanelSpace();
    if (activeRev) { Ryker.review.exit(); activeRev = null; }
    Ryker.toolbar.sync();
  }

  function toggle(which) {
    if (view === which) close(); else open(which);
  }

  function isOpen(which) { return view != null && (!which || view === which); }

  function render() {
    if (!view) return;
    if (view === 'comments') renderComments();
    else renderRevisions();
  }

  // ---- comments -----------------------------------------------------------

  function renderComments() {
    titleEl.textContent = 'Comments';
    bodyEl.innerHTML = '';
    footEl.innerHTML = '';

    var counts = Ryker.comments.counts();
    var all = Ryker.comments.list();
    var shown = all.filter(function (c) {
      if (filter === 'open') return c.status !== 'resolved';
      if (filter === 'resolved') return c.status === 'resolved';
      return true;
    });

    ['open', 'resolved', 'all'].forEach(function (f) {
      footEl.appendChild(d().el('button', {
        class: 'rk' + (filter === f ? ' on' : ''),
        text: f === 'open' ? 'Open (' + counts.open + ')'
          : f === 'resolved' ? 'Resolved (' + counts.resolved + ')'
          : 'All (' + counts.total + ')',
        onclick: function () { filter = f; render(); }
      }));
    });
    footEl.appendChild(d().el('button', {
      class: 'rk', text: 'Next open',
      onclick: function () {
        var n = Ryker.comments.nextOpen();
        if (!n) return;
        Ryker.comments.setActive(n.id);
        Ryker.highlight.scrollTo(n.id);
        render();
      }
    }));

    if (counts.unanchored) {
      bodyEl.appendChild(d().el('div', { class: 'note warn' }, [
        d().el('div', {
          text: counts.unanchored + (counts.unanchored === 1 ? ' comment is' : ' comments are') +
            ' unanchored. The text they were attached to is no longer findable, so they are ' +
            'listed here rather than pointed at content that may not be what was meant.'
        })
      ]));
    }

    if (!shown.length) {
      bodyEl.appendChild(d().el('div', {
        class: 'empty',
        text: filter === 'open' ? 'No open comments.' : 'Nothing here.'
      }));
      return;
    }

    shown.forEach(function (c) { bodyEl.appendChild(commentCard(c)); });
  }

  function commentCard(c) {
    var orphan = Ryker.comments.isUnanchored(c.id);
    var active = Ryker.comments.getActive() === c.id;
    var cls = 'card' + (active ? ' active' : '') +
      (c.status === 'resolved' ? ' resolved' : '') + (orphan ? ' orphan' : '');

    var tags = d().el('div', {}, [
      d().el('span', {
        class: 'tag ' + (c.status === 'resolved' ? 'resolved' : 'open'),
        text: c.status === 'resolved' ? 'Resolved' : 'Open'
      }),
      orphan ? d().el('span', { class: 'tag orphan', text: 'Unanchored' }) : null
    ]);

    var who = d().el('div', { class: 'who' });
    who.appendChild(d().el('b', { text: (c.author && c.author.name) || 'Unknown' }));
    who.appendChild(document.createTextNode(
      ' ' + d().fmtDate(c.createdAt) +
      (c.author && c.author.source === 'self' ? ' (self-asserted)' : '')));

    var acts = d().el('div', { class: 'acts' });
    if (!orphan) {
      acts.appendChild(d().el('button', {
        class: 'rk', text: 'Show',
        onclick: function () {
          Ryker.comments.setActive(c.id);
          Ryker.highlight.scrollTo(c.id);
          render();
        }
      }));
    }
    acts.appendChild(d().el('button', {
      class: 'rk',
      text: c.status === 'resolved' ? 'Reopen' : 'Resolve',
      onclick: function () {
        var me = Ryker.identity.current();
        if (c.status === 'resolved') Ryker.comments.reopen(c.id, me);
        else Ryker.comments.resolve(c.id, me);
        render();
      }
    }));
    acts.appendChild(d().el('button', {
      class: 'rk danger', text: 'Delete',
      onclick: function () {
        Ryker.dialog.confirm('Delete this comment?',
          '<p>The deletion is recorded in the next save, so the comment stays visible in ' +
          'the revision history. Nothing is erased from the record.</p>',
          'Delete', function () {
            Ryker.comments.remove(c.id, Ryker.identity.current());
            render();
          });
      }
    }));

    return d().el('div', { class: cls }, [
      tags,
      d().el('div', { class: 'quote', text: '"' + c.quote + '"' }),
      who,
      // textContent, never innerHTML. This is what closes the injection path
      // left open by writing the sanitiser rather than vendoring one.
      d().el('div', { class: 'text', text: c.body }),
      acts
    ]);
  }

  // ---- revisions ----------------------------------------------------------

  function renderRevisions() {
    titleEl.textContent = 'Revisions';
    bodyEl.innerHTML = '';
    footEl.innerHTML = '';

    var records = Ryker.journal.all().slice().reverse();
    if (!records.length) {
      bodyEl.appendChild(d().el('div', {
        class: 'empty',
        text: 'No revisions yet. The first save creates one.'
      }));
      return;
    }

    footEl.appendChild(d().el('button', {
      class: 'rk', text: 'Exit revision view',
      onclick: function () { Ryker.review.exit(); activeRev = null; render(); }
    }));

    records.forEach(function (r) {
      var s = Ryker.journal.summarize(r);
      var row = d().el('div', {
        class: 'revrow' + (activeRev === r.id ? ' on' : ''),
        role: 'button', tabindex: '0',
        onclick: function () { showRevision(r); }
      }, [
        d().el('div', { class: 'seq', text: 'Revision ' + r.seq }),
        d().el('div', {
          class: 'meta',
          text: ((r.author && r.author.name) || 'Unknown') + '  |  ' + d().fmtDate(r.timestamp) +
            (r.author && r.author.source === 'self' ? '  |  self-asserted' : '')
        }),
        d().el('div', { class: 'stats' }, [
          d().el('span', { class: 'stat-add', text: s.additions + ' additions' }),
          d().el('span', { class: 'stat-del', text: s.removals + ' removals' }),
          s.commentsAdded ? d().el('span', { class: 'stat-cm', text: s.commentsAdded + ' comments added' }) : null,
          s.commentsResolved ? d().el('span', { class: 'stat-cm', text: s.commentsResolved + ' comments resolved' }) : null
        ])
      ]);
      if (r.message) row.appendChild(d().el('div', { class: 'meta', text: r.message }));
      bodyEl.appendChild(row);
    });
  }

  function showRevision(r) {
    activeRev = r.id;
    render();
    Ryker.review.show(r);
  }

  function refresh() { if (view) render(); }

  return {
    open: open, close: close, toggle: toggle, isOpen: isOpen, reflow: reflow,
    render: render, refresh: refresh,
    view: function () { return view; }
  };
})();
