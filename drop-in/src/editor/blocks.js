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

  var SELECTOR = 'h1, p, li, td, th, h2, h3, h4, h5, figcaption, blockquote p, dd, dt';

  function root() {
    return document.querySelector('main') || document.body;
  }

  function ownHeader(head) {
    var main = document.querySelector('main');
    return !!(main && main.contains(head));
  }

  function excluded(node) {
    // Anything Ryker owns.
    if (node.closest('#ryker-root')) return true;
    // The chart and any other vector content.
    if (node.closest('svg')) return true;
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
    if (node.closest('[data-effort], [data-sort], [data-group], [data-impact]')) return true;
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

  function candidates() {
    var out = [];
    Array.prototype.forEach.call(root().querySelectorAll(SELECTOR), function (n) {
      if (excluded(n)) return;
      // A list item holding only nested block content is a container, not prose.
      if (n.querySelector(SELECTOR)) return;
      if (!Ryker.dom.textOf(n)) return;
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

  function identify(node, counts) {
    if (node.id) return '#' + node.id;
    var stamped = node.getAttribute && node.getAttribute('data-ryker-id');
    if (stamped) return '@' + stamped;
    if (idCache.has(node)) return idCache.get(node);

    // Two identical paragraphs would hash the same, so occurrences are numbered
    // in document order. Only the opening text is used, which keeps the id
    // stable when a long block is edited near its end.
    var base = hash(node.tagName + '|' + Ryker.dom.textOf(node).slice(0, 160));
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

  // Called once at boot, before anything is replayed or edited, so every id is
  // computed from the document as it was authored.
  function seedIds() { return all().length; }

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
    all().some(function (b) {
      if (b.id === id) { found = b.node; return true; }
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
    var list = all();
    list.forEach(function (b, i) {
      var box = boxOf(b.node);
      snap[b.id] = {
        html: b.node.innerHTML,
        tag: b.node.tagName,
        prev: i > 0 ? list[i - 1].id : null,
        box: box ? boxKey(b.node) : null,
        boxTag: box ? box.tagName : null
      };
    });
    return snap;
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
          tag: a.tag, prev: a.prev
        });
      } else if (htmlOf(before[id]) !== htmlOf(a)) {
        changes.push({ id: id, before: htmlOf(before[id]), after: htmlOf(a),
                       kind: 'changed', tag: a.tag });
      }
    });
    Object.keys(before).forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(after, id)) {
        var was = before[id];
        var meta = was && typeof was === 'object' ? was : {};
        changes.push({ id: id, before: htmlOf(was), after: null, kind: 'removed',
                       box: meta.box || null, boxTag: meta.boxTag || null });
      }
    });
    return changes;
  }

  // Puts a recorded change back into the document. This is what makes a journal
  // held in browser storage worth anything: the file on disk is untouched, so
  // without replay a reload silently discarded every saved edit.
  function applyChange(c) {
    var node = byId(c.id);

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
      node = document.createElement(c.tag || 'P');
      if (c.id.charAt(0) === '@') node.setAttribute('data-ryker-id', c.id.slice(1));
      else if (c.id.charAt(0) === '#') node.id = c.id.slice(1);
      var anchor = c.prev ? byId(c.prev) : null;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(node, anchor.nextSibling);
      else root().appendChild(node);
    }

    node.innerHTML = Ryker.sanitize.html(c.after);
    return true;
  }

  function applyRecords(records) {
    var applied = 0, missed = 0;
    (records || []).forEach(function (r) {
      (r.changes || []).forEach(function (c) {
        if (applyChange(c)) applied += 1; else missed += 1;
      });
    });
    return { applied: applied, missed: missed };
  }

  function label(id) {
    var node = byId(id);
    if (!node) return id;
    var head = node.closest('section');
    var h = head ? head.querySelector('h2, h3') : null;
    var text = Ryker.dom.textOf(node);
    var short = text.length > 60 ? text.slice(0, 57) + '...' : text;
    return (h ? Ryker.dom.textOf(h) + ' / ' : '') + short;
  }

  return {
    SELECTOR: SELECTOR, root: root, all: all, blockId: blockId, byId: byId, hash: hash,
    excluded: excluded, snapshot: snapshot, diffSnapshots: diffSnapshots, label: label,
    seedIds: seedIds, stamp: stamp, htmlOf: htmlOf, sequence: sequence,
    boxOf: boxOf, boxKey: boxKey,
    applyChange: applyChange, applyRecords: applyRecords
  };
})();
