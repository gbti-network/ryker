// Edit Mode. Per-block contenteditable over prose only, with sanitising at
// explicit markup-entry boundaries and a baseline snapshot so a save knows
// exactly which blocks moved.
Ryker.editable = (function () {
  'use strict';

  var on = false;
  var baseline = null;
  var bound = [];
  var resumable = [];
  var listeners = [];
  var pendingListSpace = new WeakSet();

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  function arm(node, id) {
    if (!node || !node.isConnected || Ryker.blocks.excluded(node)) return;
    if (bound.some(function (b) { return b.node === node; })) return;
    node.setAttribute('contenteditable', 'true');
    node.setAttribute('spellcheck', 'true');
    node.classList.add('ryker-editing');
    bindOne(node, id || Ryker.blocks.blockId(node));
  }

  function enable() {
    if (on) return;
    // No stamping here. Block ids come from the document's own content and are
    // already correct, so the baseline taken at boot stays valid.
    if (!baseline) {
      baseline = Ryker.blocks.snapshot();
      Ryker.history.captureBaseline(baseline);
    }
    Ryker.blocks.all().forEach(function (b) { arm(b.node, b.id); });
    // Apart from table cells, all() omits empty authored blocks because they
    // have no stable content identity. A block that Ryker already armed can
    // later become empty, though, and Hide must not make it permanently inert
    // when Ryker reopens.
    resumable.forEach(function (node) { arm(node); });
    resumable = [];
    on = true;
    emit();
  }

  function bindOne(n, id) {
    var handlers = {
        paste: function (e) {
          var clean = Ryker.sanitize.fromClipboard(e);
          if (clean == null) return;
          e.preventDefault();
          insertHtml(clean);
          mark(n, id);
        },
        drop: function (e) {
          // A drop can carry arbitrary HTML and files. Refusing it outright is
          // simpler than sanitising every shape it can take, and dropping into
          // a paragraph is not a workflow anyone needs.
          e.preventDefault();
        },
        input: function () {
          if (consumeListSpace(n)) return;
          if (autoList(n, id)) return;
          Ryker.history.text(n); mark(n, id);
        },
        keydown: function (e) {
          // Backspace at the very start of a block joins it to the one before,
          // which is what makes an emptied paragraph disappear when you keep
          // pressing it. Without this the block stayed as an empty shell and
          // there was no way to remove it at all.
          if (e.key === 'Backspace' && caretAtEdge(n, 'start')) {
            if (mergeWith(n, 'previous')) e.preventDefault();
            return;
          }
          // Delete at the very end pulls the next block up into this one.
          if (e.key === 'Delete' && caretAtEdge(n, 'end')) {
            if (mergeWith(n, 'next')) e.preventDefault();
            return;
          }
          if (e.key !== 'Enter') return;
          // Shift+Enter is a line break inside the block. Plain Enter splits it
          // into two, which is what someone breaking a paragraph in half means.
          if (e.shiftKey) return;
          // Splitting a cell in two would add a cell and change what the row
          // means, so Enter inside one is a line break rather than a split.
          // Swallowing the key outright was the older behaviour, and to anyone
          // who pressed it the cell read as the one block that would not take
          // an edit.
          if (n.tagName === 'TD' || n.tagName === 'TH') {
            e.preventDefault();
            try { document.execCommand('insertLineBreak'); } catch (err) {}
            return;
          }
          e.preventDefault();
          splitAt(n);
        }
    };
    Object.keys(handlers).forEach(function (k) { n.addEventListener(k, handlers[k]); });
    bound.push({ node: n, handlers: handlers });
  }

  // Turns a list marker typed into an otherwise empty paragraph into semantic
  // list markup. Conversion happens as soon as the marker is complete. If the
  // customary space follows, consume it from the new empty item rather than
  // leaving invisible leading whitespace. Matching the whole block keeps
  // ordinary prose such as "Step 1. review" untouched.
  function autoList(node, id) {
    if (!node || node.tagName !== 'P' || !node.parentNode) return false;
    var raw = (node.textContent || '').replace(/\u00a0/g, ' ');
    var tag = raw === '1.' || raw === '1. ' ? 'OL' :
      (raw === '*' || raw === '* ' ? 'UL' : null);
    if (!tag) return false;
    var awaitsSpace = raw === '1.' || raw === '*';

    var host = node.parentNode;
    var list = document.createElement(tag.toLowerCase());
    var item = document.createElement('li');
    Array.prototype.forEach.call(node.attributes, function (attribute) {
      if (attribute.name === 'contenteditable' || attribute.name === 'spellcheck' ||
          attribute.name === 'class') return;
      item.setAttribute(attribute.name, attribute.value);
    });
    var keep = (node.getAttribute('class') || '').split(/\s+/)
      .filter(function (name) { return name && name.indexOf('ryker-') !== 0; });
    if (keep.length) item.className = keep.join(' ');
    item.innerHTML = '<br>';
    list.appendChild(item);
    node.innerHTML = '<br>';
    Ryker.blocks.transferId(node, item);
    host.replaceChild(list, node);
    rebind(item);
    item.classList.add('ryker-dirty');
    if (awaitsSpace) pendingListSpace.add(item);

    Ryker.history.record({
      label: tag === 'OL' ? 'start ordered list' : 'start unordered list',
      undo: function () {
        pendingListSpace.delete(item);
        if (list.parentNode) list.parentNode.replaceChild(node, list);
        rebind(node);
        place(node, 'start');
      },
      redo: function () {
        if (node.parentNode) node.parentNode.replaceChild(list, node);
        rebind(item);
        if (awaitsSpace) pendingListSpace.add(item);
        place(item, 'start');
      }
    });

    place(item, 'start');
    mark(item, id);
    emit();
    return true;
  }

  function consumeListSpace(node) {
    if (!pendingListSpace.has(node)) return false;
    pendingListSpace.delete(node);
    var raw = (node.textContent || '').replace(/\u00a0/g, ' ');
    if (!/^\s+$/.test(raw)) return false;
    node.innerHTML = '<br>';
    place(node, 'start');
    return true;
  }

  // Splits a block at the caret into two siblings of the same kind. The new
  // block gets its own stamped id, so the journal records it as an addition and
  // every other block keeps the identity it already had.
  function splitAt(node) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!node.contains(range.startContainer)) return;

    var beforeSplit = node.innerHTML;
    range.deleteContents();
    var tail = range.cloneRange();
    tail.selectNodeContents(node);
    tail.setStart(range.endContainer, range.endOffset);
    var frag = tail.extractContents();

    var clone = document.createElement(node.tagName);
    // Ryker's own state classes must not be copied onto a brand new block.
    var keep = (node.getAttribute('class') || '').split(/\s+/)
      .filter(function (c) { return c && c.indexOf('ryker-') !== 0; });
    if (keep.length) clone.className = keep.join(' ');
    clone.appendChild(frag);
    if (!clone.textContent.trim()) clone.innerHTML = '<br>';
    if (!node.textContent.trim()) node.innerHTML = '<br>';

    var nodeBefore = beforeSplit;
    // Per history entry. A module-level value made an older split's redo read
    // the most recent split's HTML and silently transplant the wrong paragraph.
    var nodeAfter = node.innerHTML;
    node.parentNode.insertBefore(clone, node.nextSibling);
    Ryker.history.record({
      label: 'split',
      undo: function () {
        if (clone.parentNode) clone.parentNode.removeChild(clone);
        node.innerHTML = nodeBefore;
        place(node, 'end');
      },
      redo: function () {
        node.innerHTML = nodeAfter;
        node.parentNode.insertBefore(clone, node.nextSibling);
        rebind(clone);
        place(clone, 'start');
      }
    });
    // Only the new half is stamped. Stamping the original too renamed it, so a
    // split recorded as a delete plus two inserts rather than the edit and the
    // insert it actually is. Its content-derived id is cached and stays valid.
    Ryker.blocks.stamp(clone);

    bindOne(clone, Ryker.blocks.blockId(clone));
    clone.setAttribute('contenteditable', 'true');
    clone.setAttribute('spellcheck', 'true');
    clone.classList.add('ryker-editing', 'ryker-dirty');
    node.classList.add('ryker-dirty');

    var caret = document.createRange();
    caret.setStart(clone, 0);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    clone.focus();

    emit();
  }

  // A detached element keeps its listeners, classes and attributes, so putting
  // one back needs no rebinding in the ordinary case. This exists for the case
  // where Edit Mode was toggled in between, and is idempotent either way.
  function rebind(node) {
    if (!on) return;
    node.setAttribute('contenteditable', 'true');
    node.setAttribute('spellcheck', 'true');
    node.classList.add('ryker-editing');
    var already = bound.some(function (b) { return b.node === node; });
    if (!already) bindOne(node, Ryker.blocks.blockId(node));
  }

  function place(node, edge) {
    try {
      var r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(edge === 'start');
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      node.focus();
    } catch (e) {}
  }

  var BLOCK_TYPES = ['P', 'H1', 'H2', 'H3', 'H4', 'H5'];

  // Changes a block's element type, keeping its contents and its attributes.
  //
  // The id attribute travels with it deliberately: a heading's id is the anchor
  // the table of contents points at, and dropping it would break every link to
  // that section.
  function convert(node, tag) {
    tag = String(tag || '').toUpperCase();
    if (!node || BLOCK_TYPES.indexOf(tag) === -1) return false;
    if (node.tagName === tag) return false;
    if (node.tagName === 'TD' || node.tagName === 'TH' || node.tagName === 'LI') return false;

    var host = node.parentNode;
    var at = node.nextSibling;
    var made = document.createElement(tag.toLowerCase());
    Array.prototype.forEach.call(node.attributes, function (a) {
      if (a.name === 'contenteditable' || a.name === 'spellcheck') return;
      made.setAttribute(a.name, a.value);
    });
    made.className = (node.getAttribute('class') || '').split(/\s+/)
      .filter(function (c) { return c && c.indexOf('ryker-') !== 0; }).join(' ');
    if (!made.className) made.removeAttribute('class');
    while (node.firstChild) made.appendChild(node.firstChild);
    Ryker.blocks.transferId(node, made);

    host.replaceChild(made, node);
    rebind(made);
    made.classList.add('ryker-dirty');

    Ryker.history.record({
      label: 'convert',
      undo: function () {
        while (made.firstChild) node.appendChild(made.firstChild);
        if (made.parentNode) made.parentNode.replaceChild(node, made);
        rebind(node);
        place(node, 'end');
      },
      redo: function () {
        while (node.firstChild) made.appendChild(node.firstChild);
        if (node.parentNode) node.parentNode.replaceChild(made, node);
        rebind(made);
        place(made, 'end');
      }
    });

    place(made, 'end');
    emit();
    return true;
  }

  function blockTypeOf(node) {
    return node && BLOCK_TYPES.indexOf(node.tagName) !== -1 ? node.tagName : null;
  }

  // True when the caret sits at the very start or end of a block with nothing
  // selected. Measured by asking how much text lies between the block edge and
  // the caret, which is the only reading that survives nested markup.
  function caretAtEdge(node, edge) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    var r = sel.getRangeAt(0);
    if (!r.collapsed) return false;
    if (!node.contains(r.startContainer)) return false;
    var probe = document.createRange();
    probe.selectNodeContents(node);
    try {
      if (edge === 'start') probe.setEnd(r.startContainer, r.startOffset);
      else probe.setStart(r.startContainer, r.startOffset);
    } catch (e) { return false; }
    return probe.toString().replace(/[​\s]/g, '') === '';
  }

  function neighbour(node, dir) {
    var list = Ryker.blocks.sequence();
    var i = list.indexOf(node);
    if (i === -1) return null;
    var j = dir === 'previous' ? i - 1 : i + 1;
    return list[j] || null;
  }

  // Joins two blocks into one. The earlier block survives and keeps its id, so
  // the change records as an edit to it plus a deletion of the later one, which
  // is exactly what someone applying the change needs to do.
  function mergeWith(node, dir) {
    var other = neighbour(node, dir);
    if (!other) return false;

    // Table cells are structure, not prose. Merging two of them would change
    // what the table means and break the row.
    var STRUCTURAL = { TD: 1, TH: 1 };
    if (STRUCTURAL[node.tagName] || STRUCTURAL[other.tagName]) return false;

    var keep = dir === 'previous' ? other : node;
    var drop = dir === 'previous' ? node : other;

    // Headings are structure. Merging one into a paragraph destroys a section
    // title and desyncs the table of contents, and merging a paragraph into a
    // heading silently promotes body text. The earlier guard only covered the
    // second case, so backspacing at the start of a heading, which makes the
    // paragraph above the survivor, quietly swallowed the heading.
    var HEADING = /^H[1-6]$/;
    var mixed = HEADING.test(keep.tagName) !== HEADING.test(drop.tagName) ||
                (HEADING.test(keep.tagName) && keep.tagName !== drop.tagName);
    if (mixed) {
      // An empty paragraph between headings has nothing to merge. Treating the
      // structural guard as a blanket refusal stranded that paragraph: neither
      // Backspace toward the heading above nor Delete toward the heading below
      // could remove it. Remove only the empty paragraph and leave the heading
      // intact, regardless of which side of the paragraph the caret is on.
      if (node.tagName === 'P' && !Ryker.dom.textOf(node)) {
        var empty = node, emptyAt = node.nextSibling, emptyHost = node.parentNode;
        emptyHost.removeChild(empty);
        Ryker.history.record({
          label: 'delete empty paragraph',
          undo: function () { emptyHost.insertBefore(empty, emptyAt); rebind(empty); },
          redo: function () { if (empty.parentNode) empty.parentNode.removeChild(empty); }
        });
        place(other, dir === 'previous' ? 'end' : 'start');
        emit();
        return true;
      }
      // An empty heading is not structure worth keeping, so it goes on its own
      // rather than being merged into anything.
      if (HEADING.test(drop.tagName) && !Ryker.dom.textOf(drop)) {
        var gone = drop, at = drop.nextSibling, host = drop.parentNode;
        host.removeChild(drop);
        Ryker.history.record({
          label: 'delete heading',
          undo: function () { host.insertBefore(gone, at); rebind(gone); },
          redo: function () { if (gone.parentNode) gone.parentNode.removeChild(gone); }
        });
        place(keep, 'end');
        emit();
        return true;
      }
      return false;
    }

    var joinAt = keep.childNodes.length;
    var keepBefore = keep.innerHTML, dropBefore = drop.innerHTML;
    var dropAt = drop.nextSibling, dropHost = drop.parentNode;

    while (drop.firstChild) keep.appendChild(drop.firstChild);
    if (drop.parentNode) drop.parentNode.removeChild(drop);

    var keepAfter;
    Ryker.history.record({
      label: 'merge',
      undo: function () {
        keep.innerHTML = keepBefore;
        drop.innerHTML = dropBefore;
        dropHost.insertBefore(drop, dropAt);
        rebind(drop);
        place(drop, 'start');
      },
      redo: function () {
        keep.innerHTML = keepAfter;
        if (drop.parentNode) drop.parentNode.removeChild(drop);
        place(keep, 'end');
      }
    });

    // Collapse the <br> a freshly emptied block leaves behind.
    Array.prototype.slice.call(keep.querySelectorAll('br')).forEach(function (br) {
      if (!br.nextSibling || !Ryker.dom.textOf(keep)) br.parentNode.removeChild(br);
    });

    var caret = document.createRange();
    caret.setStart(keep, Math.min(joinAt, keep.childNodes.length));
    caret.collapse(true);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(caret);
    keep.focus();

    keepAfter = keep.innerHTML;
    mark(keep, Ryker.blocks.blockId(keep));
    emit();
    return true;
  }

  // Formatting, applied to the selection inside an editable block. execCommand
  // is deprecated and is still the only thing every browser implements for
  // contenteditable, so it is used and then the result is put through the
  // allowlist rather than trusted.
  function format(cmd, value) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    var node = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    var block = node.closest ? node.closest('[contenteditable="true"]') : null;
    if (!block) return false;

    try { document.execCommand('styleWithCSS', false, false); } catch (e) {}
    try { document.execCommand(cmd, false, value); } catch (e) { return false; }

    Ryker.sanitize.element(block);
    mark(block, Ryker.blocks.blockId(block));
    return true;
  }

  // Kept as the name the toolbar and the full build already call. The work
  // moved to Ryker.links, which handles editing an existing anchor as well as
  // making a new one, and which editable.js has no room left to host.
  function makeLink() {
    return Ryker.links.open();
  }

  function restore(range) {
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function insertHtml(html) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    var frag = tpl.content;
    var last = frag.lastChild;
    range.insertNode(frag);
    if (last) {
      range.setStartAfter(last);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function mark(node, id) {
    var was = node.classList.contains('ryker-dirty');
    var changed = baseline && Ryker.blocks.htmlOf(baseline[id]) !== node.innerHTML;
    node.classList.toggle('ryker-dirty', !!changed);
    if (was !== !!changed) emit();
    else if (changed) emit();
  }

  function disable() {
    if (!on) return;
    resumable = bound.map(function (b) { return b.node; });
    bound.forEach(function (b) {
      Object.keys(b.handlers).forEach(function (k) {
        b.node.removeEventListener(k, b.handlers[k]);
      });
      b.node.removeAttribute('contenteditable');
      b.node.removeAttribute('spellcheck');
      b.node.classList.remove('ryker-editing');
    });
    bound = [];
    on = false;
    emit();
  }

  function forgetDetachedBindings() {
    bound = bound.filter(function (b) {
      if (b.node.isConnected) return true;
      Object.keys(b.handlers).forEach(function (k) {
        b.node.removeEventListener(k, b.handlers[k]);
      });
      return false;
    });
    resumable = resumable.filter(function (node) { return node.isConnected; });
  }

  function isOn() { return on; }

  function changes() {
    if (!baseline) return [];
    return Ryker.blocks.diffSnapshots(baseline, Ryker.blocks.snapshot());
  }

  // Two questions, one walk of the document. A move changes no block's content,
  // so diffSnapshots is silent about it and asking changes() alone left Save
  // disabled after a reorder; and taking a second snapshot to ask about order
  // would double the cost of something that runs on every keystroke.
  function isDirty() {
    if (!baseline) return false;
    var now = Ryker.blocks.snapshot();
    if (Ryker.blocks.diffSnapshots(baseline, now).length) return true;
    return !!(Ryker.move && Ryker.move.between(baseline, now).length);
  }

  function baselineOf() { return baseline; }

  // Called after a successful save: the current state becomes the new baseline,
  // so the next save records deltas against what was committed rather than
  // against what was on screen when the tab opened.
  function rebase() {
    baseline = Ryker.blocks.snapshot();
    Ryker.history.captureBaseline(baseline);
    Array.prototype.forEach.call(document.querySelectorAll('.ryker-dirty'), function (n) {
      n.classList.remove('ryker-dirty');
    });
    emit();
  }

  function revertAll() {
    if (!baseline) return;
    Ryker.history.restoreBaseline(baseline, bound.map(function (b) { return b.node; }));
    forgetDetachedBindings();
    Array.prototype.forEach.call(document.querySelectorAll('.ryker-dirty'), function (n) {
      n.classList.remove('ryker-dirty');
    });
    emit();
  }

  function revertBlock(id, html) {
    var node = Ryker.blocks.byId(id);
    if (!node || html == null) return false;
    node.innerHTML = Ryker.sanitize.html(html);
    if (baseline && Ryker.blocks.htmlOf(baseline[id]) !== node.innerHTML) node.classList.add('ryker-dirty');
    emit();
    return true;
  }

  function setBaseline(snap) { baseline = snap; }

  return {
    enable: enable, disable: disable, isOn: isOn, changes: changes, isDirty: isDirty,
    baselineOf: baselineOf,
    rebase: rebase, revertAll: revertAll, revertBlock: revertBlock,
    setBaseline: setBaseline, onChange: onChange, rebind: rebind, touch: emit,
    format: format, makeLink: makeLink, splitAt: splitAt,
    convert: convert, blockTypeOf: blockTypeOf, BLOCK_TYPES: BLOCK_TYPES
  };
})();
