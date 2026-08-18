// The outline rail: the document's own structure, down the left edge.
//
// The report already carries a table of contents, and it lists eight sections.
// This lists all of them, every heading beneath them, and every table, figure,
// quote and paragraph between, which is the difference between navigating a
// document and being able to operate on it.
//
// It shares its selection with the drag layer rather than mirroring it. Clicking
// a row picks the blocks that row covers, and a drag in the page marks the rows
// those blocks belong to. One selection, two ways to reach it.
Ryker.rail = (function () {
  'use strict';

  var node = null, body = null, countEl = null, scopeLabelEl = null;
  var scopeButtons = {};
  var open = false, built = false;
  var closed = {};
  var rebuildTimer = 0;
  var MIN_W = 260, DEFAULT_W = 320;
  var toggleListeners = [];

  function d() { return Ryker.dom; }
  function docId() { return Ryker.config.load().RYKER_DOCUMENT_ID; }
  function closedKey() { return 'ryker:rail-closed:' + docId() + ':' + Ryker.outline.mode(); }
  function extensionClosedKey(mode) {
    return 'preference:rail-closed:' + docId() + ':' + (mode || Ryker.outline.mode());
  }
  function widthKey() { return 'ryker:rail-width'; }

  function loadClosed() {
    var raw = null;
    if (Ryker.SURFACE === 'extension') {
      var mode = Ryker.outline.mode();
      var preferences = Ryker.extensionPreferences || {};
      var saved = preferences.railClosed && preferences.railClosed[mode];
      closed = saved && typeof saved === 'object' ? saved : null;
      if (!closed && Ryker.extensionStorage) {
        Ryker.extensionStorage.get(extensionClosedKey(mode)).then(function (value) {
          if (!value || typeof value !== 'object') return;
          Ryker.extensionPreferences = Ryker.extensionPreferences || {};
          Ryker.extensionPreferences.railClosed = Ryker.extensionPreferences.railClosed || {};
          Ryker.extensionPreferences.railClosed[mode] = value;
          if (Ryker.outline.mode() === mode) {
            closed = value;
            if (built) render();
          }
        }).catch(function (error) {
          if (Ryker.pane) Ryker.pane.flash('Outline state could not be read: ' + error.message, 'warn');
        });
      }
    } else {
      try {
        raw = localStorage.getItem(closedKey());
        closed = raw ? JSON.parse(raw) : null;
      } catch (e) { closed = null; }
    }
    // Default: the h2 rows open, everything below shut. That gives a list the
    // length of the report's own contents rather than a wall of 150 rows.
    if (!closed) {
      closed = {};
      Ryker.outline.tree().forEach(function (n) { shutBelow(n, 2); });
    }
  }

  function shutBelow(n, level) {
    if (n.rank && n.rank > level) closed[n.key] = 1;
    n.children.forEach(function (c) { shutBelow(c, level); });
  }

  function saveClosed() {
    if (Ryker.SURFACE === 'extension') {
      Ryker.extensionPreferences = Ryker.extensionPreferences || {};
      Ryker.extensionPreferences.railClosed = Ryker.extensionPreferences.railClosed || {};
      Ryker.extensionPreferences.railClosed[Ryker.outline.mode()] = closed;
      if (Ryker.extensionStorage) {
        Ryker.extensionStorage.set(extensionClosedKey(), closed).catch(function (error) {
          if (Ryker.pane) Ryker.pane.flash('Outline state could not be stored: ' + error.message, 'warn');
        });
      }
      return;
    }
    try { localStorage.setItem(closedKey(), JSON.stringify(closed)); } catch (e) {}
  }

  function storedWidth() {
    var v = 0;
    if (Ryker.SURFACE === 'extension') {
      v = parseInt((Ryker.extensionPreferences || {}).railWidth || '0', 10);
      return v >= MIN_W ? v : DEFAULT_W;
    }
    try { v = parseInt(localStorage.getItem(widthKey()) || '0', 10); } catch (e) {}
    return v >= MIN_W ? v : DEFAULT_W;
  }

  // ---- building -----------------------------------------------------------

  function build() {
    if (built) return node;
    built = true;
    loadClosed();

    countEl = d().el('span', { class: 'rail-count' });
    body = d().el('div', { class: 'rail-body', role: 'tree', 'aria-label': 'Document outline' });

    var parts = [
      d().el('div', { class: 'rail-grip', title: 'Drag to resize', tabindex: '0',
                      role: 'separator', 'aria-label': 'Resize the outline' }),
      d().el('header', {}, [
        d().el('h2', { text: 'Outline' }),
        countEl,
        d().el('span', { class: 'spacer' }),
        Ryker.icons.button('close', 'Hide the outline', function () { toggle(false); })
      ])
    ];
    if (Ryker.SURFACE === 'extension') parts.push(buildScope());
    parts.push(body);

    node = d().el('aside', { class: 'rail', role: 'complementary', 'aria-label': 'Ryker outline' }, parts);
    node.style.display = 'none';
    Ryker.shell.add(node);
    initResize();
    initDrag();
    applyWidth(storedWidth());
    render();
    return node;
  }

  function buildScope() {
    scopeButtons.article = d().el('button', { class: 'rk scope-choice', type: 'button', text: 'Article',
      onclick: function () { changeScope('article'); } });
    scopeButtons.page = d().el('button', { class: 'rk scope-choice', type: 'button', text: 'Full page',
      onclick: function () { changeScope('page'); } });
    scopeLabelEl = d().el('div', { class: 'scope-label' });
    return d().el('div', { class: 'rail-scope', role: 'group', 'aria-label': 'Outline scope' }, [
      d().el('div', { class: 'scope-choices' }, [scopeButtons.article, scopeButtons.page]),
      scopeLabelEl
    ]);
  }

  function changeScope(next) {
    if (!Ryker.outline.setMode(next)) {
      if (Ryker.pane) Ryker.pane.flash('No article region was found on this page.', 'warn');
    }
  }

  function syncScope() {
    if (!scopeLabelEl) return;
    var mode = Ryker.outline.mode();
    Object.keys(scopeButtons).forEach(function (name) {
      var button = scopeButtons[name];
      var on = name === mode;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });
    scopeLabelEl.textContent = (mode === 'article' ? 'Article: ' : 'Page: ') + Ryker.outline.scopeLabel();
  }

  function glyph(kind) {
    return { heading: 'H', section: 'S', table: '▦', figure: '▣',
             quote: '“', list: '≡', text: '¶' }[kind] || '¶';
  }

  function render() {
    if (!built) return;
    body.innerHTML = '';
    syncScope();
    var n = 0;
    Ryker.outline.tree().forEach(function (row) { n += draw(row, 0, body); });
    countEl.textContent = String(n);
    sync();
  }

  function draw(row, depth, host) {
    var hasKids = row.children.length > 0;
    var shut = !!closed[row.key];

    var twisty = d().el('span', { class: 'rail-tw' + (hasKids ? '' : ' none'),
                                  text: hasKids ? (shut ? '▸' : '▾') : '' });
    if (hasKids) {
      twisty.addEventListener('click', function (e) {
        e.stopPropagation();
        if (closed[row.key]) delete closed[row.key]; else closed[row.key] = 1;
        saveClosed();
        render();
      });
    }

    var el = d().el('div', {
      class: 'rail-row k-' + row.kind + (row.rank ? ' r' + row.rank : ''),
      role: 'treeitem', tabindex: '-1', draggable: row.editable ? 'true' : 'false',
      // A row that can be dragged has to say so somewhere, and the alternative
      // was a line of instructions in the header taking permanent room to
      // explain a gesture most people will try anyway.
      title: row.editable
        ? 'Drag to move it. Alt with the arrow keys moves it one place. Right-click for more.'
        : 'Navigate to this heading. This area is outside Ryker\'s editable content.',
      'aria-level': String(row.rank || (depth + 1)),
      style: 'padding-left:' + (6 + depth * 13) + 'px'
    }, [
      twisty,
      d().el('span', { class: 'rail-ico', text: glyph(row.kind) }),
      d().el('span', { class: 'rail-label', text: row.label })
    ]);
    el.__row = row;

    el.addEventListener('click', function () { el.focus(); activate(row); });
    if (!row.editable) el.classList.add('navigation-only');
    el.addEventListener('contextmenu', function (e) {
      if (!row.editable) return;
      e.preventDefault();
      e.stopPropagation();
      menuFor(row, e.clientX, e.clientY);
    });
    el.addEventListener('dragstart', function (e) {
      if (!row.editable) { e.preventDefault(); return; }
      dragging = row;
      el.classList.add('dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.label);
      } catch (err) {}
    });
    el.addEventListener('dragend', function () {
      el.classList.remove('dragging');
      clearMark();
      dragging = null;
      stopScroll();
    });
    // Alt is deliberate. The arrows alone belong to whatever the rail grows
    // into next, and a bare arrow that silently rewrites the document is the
    // wrong default for a list someone is reading.
    el.addEventListener('keydown', function (e) {
      if (!row.editable) return;
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      e.stopPropagation();
      report(Ryker.move.nudge(Ryker.outline.unitOf(row.el),
        e.key === 'ArrowUp' ? 'up' : 'down'), row);
    });

    host.appendChild(el);
    var count = 1;
    if (hasKids && !shut) {
      row.children.forEach(function (c) { count += draw(c, depth + 1, host); });
    }
    return count;
  }

  // ---- acting -------------------------------------------------------------

  function blocksOf(unit) {
    var blocks = [];
    unit.forEach(function (u) {
      Ryker.outline.blocksIn(u).forEach(function (b) {
        if (blocks.indexOf(b) === -1) blocks.push(b);
      });
    });
    return blocks;
  }

  function activate(row) {
    if (row.editable) Ryker.pick.set(blocksOf(Ryker.outline.unitOf(row.el)));
    else Ryker.pick.clear();
    try { row.el.scrollIntoView({ block: 'start', behavior: 'instant' }); } catch (e) {
      row.el.scrollIntoView(true);
    }
  }

  // ---- moving -------------------------------------------------------------
  //
  // The browser's own drag and drop, which is the opposite of the choice made
  // for selecting in the page. There a native drag had to be suppressed,
  // because a press on selected text starts one and then delivers no mousemove
  // at all, leaving the gesture invisible. Here the rows are plain list items
  // with nothing selectable in them, the browser's drag image is exactly the
  // row being moved, and pick.js already ignores anything inside the shell, so
  // the two never meet.

  var dragging = null, over = null, edge = 'after';
  var scrollRaf = 0, scrollDy = 0;

  function mark(el, where) {
    if (over === el.__row && edge === where) return;
    clearMark();
    over = el.__row;
    edge = where;
    el.classList.add(where === 'before' ? 'drop-before' : 'drop-after');
  }

  function clearMark() {
    Array.prototype.forEach.call(body.querySelectorAll('.drop-before, .drop-after'),
      function (n) { n.classList.remove('drop-before', 'drop-after'); });
    over = null;
  }

  // The rail scrolls independently of the page, and a section being dragged to
  // the far end of a 150 row outline has to be able to get there.
  function autoScroll(y) {
    var box = body.getBoundingClientRect(), band = 48;
    scrollDy = 0;
    if (y < box.top + band) scrollDy = -Math.ceil(16 * (box.top + band - y) / band);
    else if (y > box.bottom - band) scrollDy = Math.ceil(16 * (y - (box.bottom - band)) / band);
    if (scrollDy && !scrollRaf) scrollRaf = requestAnimationFrame(stepScroll);
  }

  function stepScroll() {
    scrollRaf = 0;
    if (!dragging || !scrollDy) return;
    body.scrollTop += scrollDy;
    scrollRaf = requestAnimationFrame(stepScroll);
  }

  function stopScroll() {
    scrollDy = 0;
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
  }

  // Delegated to the scrolling body rather than bound per row. A row contains
  // three spans, and dragleave fires when the pointer crosses into one of them,
  // so per-row handlers spend the whole gesture clearing their own indicator.
  function initDrag() {
    body.addEventListener('dragover', function (e) {
      if (!dragging) return;
      autoScroll(e.clientY);
      var el = e.target && e.target.closest ? e.target.closest('.rail-row') : null;
      if (!el || !el.__row || !el.__row.editable || el.__row === dragging) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
      var box = el.getBoundingClientRect();
      mark(el, (e.clientY - box.top) < box.height / 2 ? 'before' : 'after');
    });
    body.addEventListener('dragleave', function (e) {
      if (dragging && e.target === body) clearMark();
    });
    body.addEventListener('drop', function (e) {
      if (!dragging || !over) return;
      e.preventDefault();
      e.stopPropagation();
      drop();
    });
  }

  function drop() {
    var src = dragging, dst = over, where = edge;
    clearMark();
    stopScroll();
    dragging = null;
    if (!src || !dst || src === dst) return;

    var unit = Ryker.outline.unitOf(dst.el);
    // A heading owns everything under it, so landing after an h2 means after
    // the section it opens rather than between the heading and its first
    // paragraph, which is the only reading that makes dropping onto a
    // collapsed row mean anything.
    var target = where === 'before' ? unit[0] : unit[unit.length - 1];
    report(Ryker.move.apply(Ryker.outline.unitOf(src.el), target, where), src);
  }

  // One place where a refusal is spoken. Every move path can fail for the same
  // few reasons and each of them is a sentence, not a code.
  function report(why, row) {
    render();
    if (why) {
      if (Ryker.pane) Ryker.pane.flash(why, 'warn');
      return false;
    }
    if (row) {
      Ryker.pick.set(blocksOf(Ryker.outline.unitOf(row.el)));
      focusRow(row.el);
    }
    return true;
  }

  function focusRow(el) {
    var found = null;
    Array.prototype.forEach.call(body.querySelectorAll('.rail-row'), function (n) {
      if (n.__row && n.__row.el === el) found = n;
    });
    if (found) {
      found.focus();
      try { found.scrollIntoView({ block: 'nearest', behavior: 'instant' }); } catch (e) {}
    }
  }

  // Right-click deletes the row and everything under it. A heading takes its
  // run, an h2 opening a section takes the section, and a table takes the
  // wrapper that gives it its scrolling. Counting the blocks first is what makes
  // the confirmation honest: "delete 24 blocks" is a different decision from
  // "delete a paragraph", and only the row knows which this is.
  function menuFor(row, x, y) {
    var unit = Ryker.outline.unitOf(row.el);
    var blocks = blocksOf(unit);

    Ryker.menu.at(x, y, [
      { label: 'Select', icon: 'copy', run: function () { activate(row); } },
      { label: 'Move up', icon: 'up',
        run: function () { report(Ryker.move.nudge(unit, 'up'), row); } },
      { label: 'Move down', icon: 'down',
        run: function () { report(Ryker.move.nudge(unit, 'down'), row); } },
      null,
      { label: blocks.length > 1
          ? 'Delete this and its ' + (blocks.length - 1) + ' block(s)'
          : 'Delete this',
        icon: 'trash', danger: true,
        run: function () { confirmDelete(row, unit, blocks); } }
    ]);
  }

  function confirmDelete(row, unit, blocks) {
    var what = Ryker.outline.kindOf(row.el);
    var many = blocks.length > 1 || unit.length > 1;

    if (!many) {
      remove(unit);
      return;
    }
    Ryker.dialog.open({
      title: 'Delete this ' + (what === 'heading' ? 'heading and everything under it' : what) + '?',
      body: '<p>' + Ryker.dom.escapeHtml(row.label) + '</p>' +
        '<div class="note"><b>' + blocks.length + ' block(s)</b> go with it' +
        (unit.length > 1 ? ', across ' + unit.length + ' element(s)' : '') +
        '. Ctrl+Z brings all of it back as one step.</div>',
      buttons: [
        { label: 'Cancel' },
        { label: 'Delete', danger: true, primary: true,
          action: function () { remove(unit); } }
      ]
    });
  }

  function remove(unit) {
    Ryker.pick.clear();
    Ryker.multi.removeNodes(unit.slice());
    render();
  }

  // ---- state --------------------------------------------------------------

  function sync() {
    if (!built) return;
    var marked = Ryker.outline.rowsFor(Ryker.pick.picked());
    Array.prototype.forEach.call(body.querySelectorAll('.rail-row'), function (el) {
      var row = el.__row;
      el.classList.toggle('on', !!(row && marked.indexOf(row.el) !== -1));
    });
  }

  function scheduleRender() {
    clearTimeout(rebuildTimer);
    // blocks.sequence() is cheap but onChange fires on every keystroke, so an
    // undebounced rebuild would run hundreds of times while someone types.
    rebuildTimer = setTimeout(function () { if (open) render(); }, 200);
  }

  function toggle(want) {
    build();
    open = want === undefined ? !open : !!want;
    node.style.display = open ? 'flex' : 'none';
    document.body.toggleAttribute('data-ryker-rail', open);
    if (open) { render(); Ryker.shell.setEdgeSpace(node, 'left'); }
    else Ryker.shell.setEdgeSpace(null, 'left');
    toggleListeners.forEach(function (f) { try { f(open); } catch (e) {} });
    return open;
  }

  function onToggle(fn) { toggleListeners.push(fn); }

  function isOpen() { return open; }

  function reflow() { if (open) Ryker.shell.setEdgeSpace(node, 'left'); }

  // ---- resizing, mirrored from ui/pane.js -------------------------------

  function applyWidth(px, persist) {
    var max = Math.max(MIN_W, document.documentElement.clientWidth - 320);
    var w = Math.min(Math.max(px, MIN_W), max);
    node.style.width = w + 'px';
    if (persist && Ryker.SURFACE === 'extension') {
      Ryker.extensionPreferences = Ryker.extensionPreferences || {};
      Ryker.extensionPreferences.railWidth = w;
      if (Ryker.extensionStorage) {
        Ryker.extensionStorage.set('preference:rail-width', w).catch(function (error) {
          if (Ryker.pane) Ryker.pane.flash('Outline width could not be stored: ' + error.message, 'warn');
        });
      }
    } else if (persist) {
      try { localStorage.setItem(widthKey(), String(w)); } catch (e) {}
    }
    if (open) Ryker.shell.setEdgeSpace(node, 'left');
  }

  function initResize() {
    var grip = node.querySelector('.rail-grip');
    var startX = 0, startW = 0, dragging = false;

    grip.addEventListener('mousedown', function (e) {
      dragging = true;
      startX = e.clientX;
      startW = node.getBoundingClientRect().width;
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      // Mirrored: the rail grows to the RIGHT, so the delta is not negated.
      if (dragging) applyWidth(startW + (e.clientX - startX));
    });
    document.addEventListener('mouseup', function () {
      if (dragging) applyWidth(node.getBoundingClientRect().width, true);
      dragging = false;
    });
    grip.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') applyWidth(node.getBoundingClientRect().width + 24, true);
      else if (e.key === 'ArrowLeft') applyWidth(node.getBoundingClientRect().width - 24, true);
      else return;
      e.preventDefault();
    });
  }

  function init() {
    Ryker.pick.onChange(sync);
    Ryker.editable.onChange(scheduleRender);
    Ryker.outline.onScopeChange(function () { loadClosed(); render(); });
  }

  return {
    build: build, init: init, render: render, toggle: toggle, isOpen: isOpen,
    onToggle: onToggle,
    reflow: reflow, sync: sync, applyWidth: applyWidth
  };
})();
