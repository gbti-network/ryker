// Which parts of the report are editable, and how a block is named.
//
// Editing is scoped to prose. The target reports carry a hand-authored inline
// SVG chart, a filterable table whose behaviour lives in data-effort and
// data-sort attributes read by the report's own script, and images inlined as
// base64. A general rich-text surface over that would let a well-meaning edit
// break the sort handler or delete the chart, and the breakage would be
// indistinguishable from a report bug.
Ryker.blocks = (function () {
  'use strict';

  var SELECTOR = 'h1, p, li, td, th, h2, h3, h4, h5, figcaption, caption, blockquote p, dd, dt';
  var ATOMIC_SELECTOR = 'svg';
  var PICK_SELECTOR = SELECTOR + ', ' + ATOMIC_SELECTOR;

  function root() {
    return document.querySelector('main') || document.body;
  }

  function ownHeader(head) {
    var main = document.querySelector('main');
    return !!(main && main.contains(head));
  }

  // A marker attribute locks the element carrying it and everything inside it,
  // because that element's text may be the key. Table structure is the case
  // where that reading is wrong. A <table data-sort> or a <tr data-effort> is
  // declaring how the container behaves, and the key is the attribute itself,
  // not the prose in each cell beneath it. Reading those as locks took every
  // cell of a sortable table out of the editable set at a stroke, which is the
  // single most common shape a report's tables arrive in.
  var HOST_KEYS = '[data-effort], [data-sort], [data-group], [data-impact]';
  var GRID = { TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, COLGROUP: 1, COL: 1 };

  function hostLocked(node) {
    var marked = node.closest ? node.closest(HOST_KEYS) : null;
    while (marked && GRID[marked.tagName]) {
      marked = marked.parentElement ? marked.parentElement.closest(HOST_KEYS) : null;
    }
    return !!marked;
  }

  function excluded(node) {
    // Anything Ryker owns.
    if (Ryker.shell && Ryker.shell.owns(node)) return true;
    // SVG internals are never editable. The root SVG itself is an atomic
    // selectable object, however, so a person can highlight and remove the
    // whole chart without being allowed to damage paths, labels or geometry.
    var vector = node.closest('svg');
    if (vector && node !== vector) return true;
    // Navigation is not content. Editing the table of contents would desync it
    // from the headings it points at.
    if (node.closest('nav, footer')) return true;
    // A <header> is usually site chrome, but the document's own title block is
    // also a header, and that one IS content. The test is where it sits rather
    // than what it is called: a header inside <main> belongs to the document.
    // Without this the title was the one piece of prose Ryker could not touch.
    var head = node.closest('header');
    if (head && !ownHeader(head)) return true;
    // Elements the host page's own script reads. Their text may be the key the
    // script sorts or filters on.
    if (hostLocked(node)) return true;
    if (node.hasAttribute && (node.hasAttribute('data-ryker-lock') || node.closest('[data-ryker-lock]'))) return true;
    return false;
  }

  // Block identity has to survive the file being closed and reopened.
  //
  // Two earlier attempts failed for opposite reasons. A positional id is stable
  // across a reload and wrong the moment a paragraph is split, because inserting
  // one <p> renumbers every <p> after it. A stamped attribute is stable under
  // splitting and useless across a reload, because the file on disk carries no
  // stamps: a saved edit could not find its block, so it was appended to the end
  // of the document as a duplicate while the original stayed untouched.
  //
  // What is stable in both directions is the document's own pristine content. An
  // id derived from a block's tag and opening text recomputes identically from a
  // freshly loaded file, and is cached per node the first time it is seen so it
  // does not drift as that block is edited. Blocks created during a session have
  // no pristine content, so those alone carry a stamped attribute, and replay
  // recreates them with the same stamp.
  var idCache = new WeakMap();

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  var CELL = { TD: 1, TH: 1 };

  function candidates() {
    var out = [];
    Array.prototype.forEach.call(root().querySelectorAll(SELECTOR), function (n) {
      if (excluded(n)) return;
      // A list item holding only nested block content is a container, not prose.
      if (n.querySelector(SELECTOR)) return;
      // An empty block has nothing to derive an identity from, so it is not a
      // candidate. A table cell is the exception worth making: a blank cell in
      // a filled-in table is a hole someone opened the document to fill, and
      // leaving it out made the one edit that table needed the one edit Ryker
      // would not take. seatOf() gives it an identity the grid already holds.
      if (!Ryker.dom.textOf(n) && !CELL[n.tagName]) return;
      out.push(n);
    });
    return out;
  }

  // Every editable element in document order, INCLUDING ones with no text.
  // all() drops empties on purpose, because an empty block has no content to
  // derive an identity from. That makes it the wrong list for finding a block's
  // neighbour: the block someone is trying to delete is precisely the one they
  // have just emptied, and it was invisible here.
  function sequence() {
    var out = [];
    Array.prototype.forEach.call(root().querySelectorAll(SELECTOR), function (n) {
      if (excluded(n)) return;
      if (n.querySelector(SELECTOR)) return;
      out.push(n);
    });
    return out;
  }

  function all() {
    var nodes = candidates();
    var counts = {};
    var seen = {};
    var out = [];
    nodes.forEach(function (n) {
      var id = identify(n, counts);
      if (seen[id]) return;
      seen[id] = true;
      out.push({ id: id, node: n });
    });
    return out;
  }

  function atomic(node) {
    return !!(node && node.matches && node.matches(ATOMIC_SELECTOR) &&
      root().contains(node) && !excluded(node));
  }

  function atomicNodes() {
    return Array.prototype.filter.call(root().querySelectorAll(ATOMIC_SELECTOR), atomic);
  }

  function inDocumentOrder(nodes) {
    return nodes.sort(function (a, b) {
      var p = a.compareDocumentPosition(b);
      if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  // Pickable objects include editable prose plus atomic media. Keeping this
  // separate from sequence() is what prevents enable() from ever placing
  // contenteditable on an SVG.
  function pickSequence() {
    return inDocumentOrder(sequence().concat(atomicNodes()));
  }

  // Snapshots must include atomic media or removing it would produce no delta,
  // leave Save disabled and vanish from recovery and generated instructions.
  function tracked() {
    var nodes = inDocumentOrder(candidates().concat(atomicNodes()));
    var counts = {}, seen = {}, out = [];
    nodes.forEach(function (node) {
      var id = identify(node, counts);
      if (!seen[id]) { seen[id] = true; out.push({ id: id, node: node }); }
    });
    return out;
  }

  function identify(node, counts) {
    if (node.id) return '#' + node.id;
    var stamped = node.getAttribute && node.getAttribute('data-ryker-id');
    if (stamped) return '@' + stamped;
    if (idCache.has(node)) return idCache.get(node);

    // Two identical paragraphs would hash the same, so occurrences are numbered
    // in document order. Only the opening text is used, which keeps the id
    // stable when a long block is edited near its end.
    var text = Ryker.dom.textOf(node);
    var base = hash(text ? node.tagName + '|' + text.slice(0, 160)
      : (Ryker.table.seatId(node) || node.tagName + '|'));
    var n = (counts[base] = (counts[base] || 0) + 1);
    var id = '~' + base + (n > 1 ? '.' + n : '');
    idCache.set(node, id);
    return id;
  }

  // A table is not a block, so deleting one removes a block per cell and the
  // change set reads as ten separate deletions of a word each. Recording which
  // container a block belongs to lets the instructions say "remove the table"
  // once. The key is per node and assigned lazily, so it is identical in every
  // snapshot of the same table and meaningless across documents, which is all
  // that is asked of it.
  var BOX = 'table, figure, ul, ol, dl';
  var boxKeys = new WeakMap();
  var boxSeq = 0;

  function boxOf(node) {
    var c = node.closest ? node.closest(BOX) : null;
    return c && !excluded(c) ? c : null;
  }

  function boxKey(node) {
    var c = boxOf(node);
    if (!c) return null;
    var k = boxKeys.get(c);
    if (!k) { k = 'x' + (++boxSeq); boxKeys.set(c, k); }
    return k;
  }

  function blockId(node) {
    if (node.id) return '#' + node.id;
    var stamped = node.getAttribute && node.getAttribute('data-ryker-id');
    if (stamped) return '@' + stamped;
    if (idCache.has(node)) return idCache.get(node);
    // Not seen yet: identify it in the context of the whole document so the
    // duplicate numbering matches what all() would have produced.
    var found = null;
    all().some(function (b) { if (b.node === node) { found = b.id; return true; } return false; });
    return found || identify(node, {});
  }

  // Replacing an element to change P -> H1 creates a new DOM node. Carry the
  // authored block identity across that replacement so the change is one tag
  // conversion, not a deletion plus an unrelated insertion.
  function transferId(from, to) {
    if (!from || !to) return null;
    var id = blockId(from);
    idCache.set(to, id);
    return id;
  }

  // Called once at boot, before anything is replayed or edited, so every id is
  // computed from the document as it was authored.
  function seedIds() { var editable = all().length; tracked(); return editable; }

  function stamp(node) {
    if (node.id) return '#' + node.id;
    var v = node.getAttribute('data-ryker-id');
    if (!v) {
      v = Ryker.dom.uid('b').slice(0, 12);
      node.setAttribute('data-ryker-id', v);
    }
    return '@' + v;
  }

  function byId(id) {
    var r = root();
    if (id.charAt(0) === '#') {
      var direct = document.getElementById(id.slice(1));
      if (direct && !excluded(direct)) return direct;
    }
    if (id.charAt(0) === '@') {
      var q = r.querySelector('[data-ryker-id="' + id.slice(1).replace(/"/g, '') + '"]');
      if (q && !excluded(q)) return q;
    }
    // A content-derived id resolves by scanning, which also seeds the cache.
    var found = null;
    tracked().some(function (b) {
      if (b.id === id) { found = b.node; return true; }
      return false;
    });
    if (found) return found;

    // tracked() is built from candidates(), which drops a block with no text
    // because an empty block has nothing to derive an identity from. A block
    // that was GIVEN an identity is a different case: autoList() builds its
    // <li> empty and calls transferId() onto it, so the id is cached and real
    // while the node is invisible to the scan above. Recovery, moves and every
    // instruction resolve blocks through here, so without this the newly
    // converted list item cannot be found by the id it was just handed.
    // sequence() keeps empties on purpose, which is exactly what it is for.
    sequence().some(function (node) {
      if (idCache.get(node) === id) { found = node; return true; }
      return false;
    });
    return found;
  }

  // A snapshot is the map used to compute a save's deltas. innerHTML rather
  // than textContent, because an edit that only changes a link target is still
  // an edit worth recording.
  //
  // Tag and preceding-block id travel with it because a change record has to be
  // replayable. Without them an added block could be recorded but never put
  // back: the id says what it is and not where it goes.
  function snapshot() {
    var snap = {};
    var list = tracked();
    list.forEach(function (b, i) {
      var box = boxOf(b.node);
      var seat = Ryker.table.seatOf(b.node);
      snap[b.id] = {
        html: atomic(b.node) ? atomicHtml(b.node) : b.node.innerHTML,
        tag: b.node.tagName,
        prev: i > 0 ? list[i - 1].id : null,
        box: box ? boxKey(b.node) : null,
        boxTag: box ? box.tagName : null,
        atomic: atomic(b.node),
        row: seat ? seat.row : null, col: seat ? seat.col : null
      };
    });
    return snap;
  }

  function atomicHtml(node) {
    var copy = node.cloneNode(true);
    copy.classList.remove('ryker-pick', 'ryker-dirty', 'ryker-editing');
    if (!copy.getAttribute('class')) copy.removeAttribute('class');
    return copy.outerHTML;
  }

  function htmlOf(entry) {
    // Journals written before snapshots carried structure hold a bare string.
    return entry && typeof entry === 'object' ? entry.html : entry;
  }

  function diffSnapshots(before, after) {
    var changes = [];
    Object.keys(after).forEach(function (id) {
      var a = after[id];
      if (!Object.prototype.hasOwnProperty.call(before, id)) {
        changes.push({
          id: id, before: null, after: htmlOf(a), kind: 'added',
          tag: a.tag, prev: a.prev, box: a.box || null, boxTag: a.boxTag || null,
          row: a.row || null, col: a.col == null ? null : a.col
        });
      } else if (htmlOf(before[id]) !== htmlOf(a) ||
                 (before[id] && before[id].tag) !== a.tag) {
        changes.push({ id: id, before: htmlOf(before[id]), after: htmlOf(a),
                       kind: 'changed', tag: a.tag,
                       beforeTag: before[id] && before[id].tag || null,
                       afterTag: a.tag || null, prev: a.prev || null,
                       box: a.box || null, boxTag: a.boxTag || null,
                       row: a.row || null, col: a.col == null ? null : a.col });
      }
    });
    Object.keys(before).forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(after, id)) {
        var was = before[id];
        var meta = was && typeof was === 'object' ? was : {};
        changes.push({ id: id, before: htmlOf(was), after: null, kind: 'removed',
                       tag: meta.tag || null, atomic: !!meta.atomic,
                       prev: meta.prev || null,
                       box: meta.box || null, boxTag: meta.boxTag || null,
                       row: meta.row || null, col: meta.col == null ? null : meta.col });
      }
    });
    return changes;
  }

  // Puts a recorded change back into the document. This is what makes a journal
  // held in browser storage worth anything: the file on disk is untouched, so
  // without replay a reload silently discarded every saved edit.
  function boxIndex() {
    var boxes = {};
    Array.prototype.forEach.call(root().querySelectorAll(BOX), function (box) {
      var key = boxKey(box);
      if (key) boxes[key] = box;
    });
    return boxes;
  }

  function insertNew(node, c, anchor, context) {
    if (Ryker.table.place(node, c, anchor, context)) return;
    var boxTag = String(c.boxTag || '').toUpperCase();
    var box = c.box && context.boxes[c.box];
    if (c.box && /^(OL|UL|DL|FIGURE)$/.test(boxTag)) {
      if (!box) {
        box = document.createElement(boxTag);
        boxKeys.set(box, c.box);
        context.boxes[c.box] = box;
        var unit = anchor && (boxOf(anchor) || anchor);
        if (unit && unit.parentNode) unit.parentNode.insertBefore(box, unit.nextSibling);
        else root().insertBefore(box, root().firstChild);
      }
      if (anchor && anchor.parentNode === box) box.insertBefore(node, anchor.nextSibling);
      else box.appendChild(node);
      return;
    }
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(node, anchor.nextSibling);
    else root().appendChild(node);
  }

  function applyChange(c, context) {
    context = context || { boxes: boxIndex(), rows: Ryker.table.rowIndex() };
    var node = byId(c.id);
    var tag = String(c.afterTag || c.tag || '').toUpperCase();
    var validTag = /^(H[1-5]|P|LI|TD|TH|FIGCAPTION|CAPTION|BLOCKQUOTE|DD|DT|SVG)$/.test(tag);

    if (c.kind === 'removed') {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      return !!node;
    }

    if (!node) {
      // Only an insert may create an element. A 'changed' record whose block
      // cannot be found means the document is not the one the edit was made
      // against, and appending it would silently corrupt the report, which is
      // exactly what happened before block identity survived a reload.
      if (c.kind !== 'added' || c.after == null) return false;
      if (!validTag) return false;
      node = document.createElement(tag);
      if (c.id.charAt(0) === '@') node.setAttribute('data-ryker-id', c.id.slice(1));
      else if (c.id.charAt(0) === '#') node.id = c.id.slice(1);
      var anchor = c.prev ? byId(c.prev) : null;
      insertNew(node, c, anchor, context);
    }

    if (c.kind === 'changed' && tag && node.tagName !== tag) {
      if (!validTag || tag === 'SVG') return false;
      var replacement = document.createElement(tag);
      Array.prototype.slice.call(node.attributes).forEach(function (attr) {
        replacement.setAttribute(attr.name, attr.value);
      });
      transferId(node, replacement);
      var boxTag = String(c.boxTag || '').toUpperCase();
      if (tag === 'LI' && /^(OL|UL)$/.test(boxTag) && node.parentNode.tagName !== boxTag) {
        var list = document.createElement(boxTag);
        if (c.box) { boxKeys.set(list, c.box); context.boxes[c.box] = list; }
        node.parentNode.replaceChild(list, node);
        list.appendChild(replacement);
      } else {
        node.parentNode.replaceChild(replacement, node);
      }
      node = replacement;
    }

    node.innerHTML = Ryker.sanitize.html(c.after);
    return true;
  }

  function completeBoxDeletes(changes, context) {
    var groups = {}, handled = {};
    (changes || []).forEach(function (change) {
      if (change.kind === 'removed' && change.box && change.boxTag === 'TABLE') {
        (groups[change.box] = groups[change.box] || []).push(change.id);
      }
    });
    Object.keys(groups).forEach(function (key) {
      var box = context.boxes[key];
      if (!box || !box.parentNode) return;
      var inside = tracked().filter(function (block) { return box.contains(block.node); })
        .map(function (block) { return block.id; });
      if (!inside.length || !inside.every(function (id) { return groups[key].indexOf(id) !== -1; })) return;
      box.parentNode.removeChild(box);
      groups[key].forEach(function (id) { handled[id] = true; });
      delete context.boxes[key];
    });
    return handled;
  }

  // Restore recorded order among blocks that share a parent. Moving across
  // different containers needs container-level metadata and is reported as a
  // miss by the recovery caller rather than guessed.
  function applyOrder(ids) {
    var groups = [];
    var parents = [];
    var missed = 0, moved = 0;
    (ids || []).forEach(function (id) {
      var node = byId(id);
      if (!node || !node.parentNode) { missed += 1; return; }
      var at = parents.indexOf(node.parentNode);
      if (at === -1) {
        parents.push(node.parentNode);
        groups.push([node]);
      } else {
        groups[at].push(node);
      }
    });
    groups.forEach(function (nodes) {
      var parent = nodes[0] && nodes[0].parentNode;
      if (!parent || nodes.length < 2) return;
      var current = Array.prototype.filter.call(parent.children, function (child) {
        return nodes.indexOf(child) !== -1;
      });
      var differs = nodes.some(function (node, i) { return current[i] !== node; });
      if (!differs) return;

      // A flat legacy order describes only tracked blocks. Preserve every
      // untracked widget, image wrapper and text node in its existing slot by
      // marking the tracked slots before moving anything into their new order.
      var markers = current.map(function (node) {
        var marker = document.createComment('ryker-order');
        parent.insertBefore(marker, node);
        return marker;
      });
      current.forEach(function (node) { parent.removeChild(node); });
      markers.forEach(function (marker, i) {
        parent.insertBefore(nodes[i], marker);
        parent.removeChild(marker);
      });
      moved += nodes.filter(function (node, i) { return current[i] !== node; }).length;
    });
    return { moved: moved, missed: missed };
  }

  function applyRecords(records) {
    var applied = 0, missed = 0, moved = 0, orderMissed = 0;
    (records || []).forEach(function (r) {
      var context = { boxes: boxIndex(), rows: Ryker.table.rowIndex() };
      var boxed = completeBoxDeletes(r.changes || [], context);
      var rowed = Ryker.table.completeRowDeletes(r.changes || [], context, tracked());
      (r.changes || []).forEach(function (c) {
        if (boxed[c.id] || rowed[c.id] || applyChange(c, context)) applied += 1; else missed += 1;
      });
      if (Array.isArray(r.order)) {
        var ordered = applyOrder(r.order);
        moved += ordered.moved;
        orderMissed += ordered.missed;
      }
    });
    return { applied: applied, missed: missed, moved: moved, orderMissed: orderMissed };
  }

  function label(id) {
    var node = byId(id);
    if (!node) return id;
    var head = node.closest('section');
    var h = head ? head.querySelector('h2, h3') : null;
    var text = Ryker.dom.textOf(node);
    // A blank cell has no words to name itself with, and a change list showing
    // an empty row for it says nothing about which hole is being filled.
    if (!text && CELL[node.tagName]) text = Ryker.table.seatLabel(node) || text;
    var short = text.length > 60 ? text.slice(0, 57) + '...' : text;
    return (h ? Ryker.dom.textOf(h) + ' / ' : '') + short;
  }

  return {
    SELECTOR: SELECTOR, PICK_SELECTOR: PICK_SELECTOR, root: root, all: all,
    atomic: atomic, pickSequence: pickSequence, blockId: blockId, transferId: transferId,
    byId: byId, hash: hash,
    excluded: excluded, snapshot: snapshot, diffSnapshots: diffSnapshots, label: label,
    seedIds: seedIds, stamp: stamp, htmlOf: htmlOf, sequence: sequence,
    boxOf: boxOf, boxKey: boxKey,
    applyChange: applyChange, applyRecords: applyRecords, applyOrder: applyOrder
  };
})();
