// The document as a tree of movable elements.
//
// A move is a change to the element tree, and until this module existed Ryker
// inferred one from a flat list of blocks. Flat order cannot carry the answer.
// Three failures followed from that, all of them measured rather than guessed:
//
//   Moving a table from one section to the front of another leaves the flat
//   sequence of blocks completely unchanged, because the same cells still
//   follow the same heading. isDirty() therefore reported clean while the
//   table sat in the wrong section, and Discard cleared the dirty flag without
//   putting it back.
//
//   "Move the table past the heading" and "move the heading past the table"
//   produce the same flat order, so the shorter run won and the instructions
//   named the heading. Structure tells them apart: only one of the two leaves
//   every element in the container it was authored in.
//
//   A section whose blocks are not all in the run could never be named at all,
//   so a section move was reported and replayed as a move of its children,
//   which hoisted them out of the section they belonged to.
//
// A unit is any element move.js is willing to move, hanging off the block root
// or off another unit. A table's insides are not units: rows and columns are
// Ryker.table's business, and a report that sorts its own rows must not read as
// a document someone reordered.
//
// Derivation is kept. Two snapshots of an unchanged document are identical, so
// moving something out and back still reports nothing at all, which is the
// property the README promises and the reason moves were derived rather than
// recorded in the first place.
Ryker.units = (function () {
  'use strict';

  // A table is opaque on purpose, per the note above.
  var OPAQUE = { TABLE: 1 };

  var baseline = null;
  var marks = [];

  function root() { return Ryker.blocks.root(); }

  function isUnit(el) {
    return !!(el && el.nodeType === 1 && Ryker.move.movable(el));
  }

  // ---- identity ------------------------------------------------------------
  //
  // A unit is named by the first block inside it, which is the same
  // content-derived identity blocks.js uses and recomputes identically from a
  // freshly loaded file. The tag comes first because a <ul> and its opening
  // <li> would otherwise share a name. Depth deliberately does NOT appear: a
  // unit that moves into a container at another depth has to keep its name, or
  // the move it just made would read as a deletion and an insertion.
  //
  // Cached per element the first time it is seen, for the same reason blocks.js
  // caches a block id: a name derived from the FIRST block inside a container
  // changes the moment that block moves, so reordering two list items renamed
  // the list around them and the move read as one list vanishing and another
  // appearing. The first walk happens at boot on the authored document, so the
  // cached name is the authored one, which is what a saved record has to match.

  var names = new WeakMap();

  function leadOf(el) {
    var sel = Ryker.blocks.SELECTOR;
    if (el.matches && el.matches(sel) && !Ryker.blocks.excluded(el) &&
        !el.querySelector(sel)) return el;
    var found = null;
    Array.prototype.some.call(el.querySelectorAll(sel), function (n) {
      if (Ryker.blocks.excluded(n) || n.querySelector(sel)) return false;
      found = n;
      return true;
    });
    return found;
  }

  function bareName(el, path) {
    if (el.id) return '#' + el.id;
    var stamped = el.getAttribute && el.getAttribute('data-ryker-id');
    if (stamped) return '@' + stamped;
    var lead = leadOf(el);
    if (lead) return el.tagName + ':' + Ryker.blocks.blockId(lead);
    // Nothing inside to be named by: an empty paragraph, a wrapper holding only
    // locked prose. Positional, and marked as such, because a unit with no
    // content of its own has nothing else to offer and is not one anybody moves
    // by name. Replay reports it as a miss rather than guessing.
    return '^' + path;
  }

  // ---- the tree ------------------------------------------------------------

  function walk() {
    var list = [];
    var seen = {};

    function visit(parent, parentKey, depth, path) {
      var kids = Array.prototype.filter.call(parent.children, isUnit);
      var prev = null;
      kids.forEach(function (el, i) {
        var here = path ? path + '.' + i : String(i);
        var key = names.get(el);
        if (!key) {
          // Two units that name themselves the same way are numbered in
          // document order, exactly as two identical paragraphs are. The
          // numbering has to consider names already handed out in this walk,
          // cached ones included, or a new element would silently take a name
          // an existing one is still using.
          key = bareName(el, here);
          var base = key, n = 1;
          while (seen[key]) { n += 1; key = base + '#' + n; }
          names.set(el, key);
        }
        seen[key] = 1;
        list.push({
          el: el, key: key, parent: parentKey, prev: prev, at: i,
          depth: depth, tag: el.tagName, kind: Ryker.outline.kindOf(el)
        });
        prev = key;
        if (!OPAQUE[el.tagName]) visit(el, key, depth + 1, here);
      });
    }

    visit(root(), null, 0, '');
    return list;
  }

  // What a diff compares: no element references, so it survives a reload and
  // can be written into a recovery record as it stands.
  function snapshot() {
    var out = {};
    walk().forEach(function (u) {
      out[u.key] = { parent: u.parent, prev: u.prev, at: u.at,
                     depth: u.depth, tag: u.tag, kind: u.kind };
    });
    return out;
  }

  function index() {
    var out = {};
    walk().forEach(function (u) { out[u.key] = u.el; });
    return out;
  }

  // ---- the diff ------------------------------------------------------------

  // The elements that kept their place, so the ones that did not can be named.
  // Without it, moving one unit reports every unit after it as moved too,
  // because each of them genuinely does have a new neighbour.
  function common(before, after) {
    var m = before.length, n = after.length;
    var grid = [];
    var i, j;
    for (i = 0; i <= m; i++) grid.push(new Array(n + 1).fill(0));
    for (i = m - 1; i >= 0; i--) {
      for (j = n - 1; j >= 0; j--) {
        grid[i][j] = before[i] === after[j]
          ? grid[i + 1][j + 1] + 1
          : Math.max(grid[i + 1][j], grid[i][j + 1]);
      }
    }
    var keep = {};
    i = 0; j = 0;
    while (i < m && j < n) {
      if (before[i] === after[j]) { keep[before[i]] = 1; i++; j++; }
      else if (grid[i + 1][j] >= grid[i][j + 1]) i++;
      else j++;
    }
    return keep;
  }

  function siblings(snap, keys, parent) {
    return keys.filter(function (k) { return snap[k].parent === parent; })
      .sort(function (a, b) { return snap[a].at - snap[b].at; });
  }

  function ancestorMoved(snap, key, moved) {
    var at = snap[key].parent;
    while (at) {
      if (moved[at]) return true;
      at = snap[at] ? snap[at].parent : null;
    }
    return false;
  }

  function diff(before, after) {
    if (!before || !after) return [];
    var shared = Object.keys(after).filter(function (k) {
      return Object.prototype.hasOwnProperty.call(before, k);
    });
    var moved = {};

    // A unit in a different container has moved, and no ordering argument can
    // say otherwise.
    shared.forEach(function (k) {
      if (before[k].parent !== after[k].parent) moved[k] = 1;
    });

    // Within one container, the units that stayed are the longest run whose
    // order held. Everything else moved.
    var settled = shared.filter(function (k) { return !moved[k]; });
    var parents = [];
    settled.forEach(function (k) {
      if (parents.indexOf(after[k].parent) === -1) parents.push(after[k].parent);
    });
    parents.forEach(function (parent) {
      var was = siblings(before, settled, parent);
      var now = siblings(after, settled, parent);
      var keep = common(was, now);
      now.forEach(function (k) { if (!keep[k]) moved[k] = 1; });
    });

    // A section's contents travel with the section, so saying so twice would
    // ask for the same move to be made again inside a container that has
    // already taken it.
    return Object.keys(moved)
      .filter(function (k) { return !ancestorMoved(after, k, moved); })
      .sort(function (a, b) { return after[a].depth - after[b].depth; })
      .map(function (k) {
        return { kind: 'unit', key: k, parent: after[k].parent,
                 prev: after[k].prev, tag: after[k].tag, unit: after[k].kind };
      });
  }

  // ---- replay --------------------------------------------------------------

  // The first place a unit may go inside a container. Not firstChild: a comment
  // or a locked paragraph ahead of the first unit is the author's, and a
  // restored element has no business jumping in front of it.
  function opening(parent) {
    var first = Array.prototype.filter.call(parent.children, isUnit)[0];
    return first || null;
  }

  function describe(rec) {
    return (rec.unit || 'element') + ' "' + rec.key + '"';
  }

  // Records are applied outermost first, so a section is in place before
  // anything is positioned inside it. Anything that cannot be resolved is
  // reported rather than placed on a guess: a move that lands in the wrong
  // container damages the document, and saying "this one did not come back" is
  // always the better failure.
  function replay(records) {
    var applied = 0, missed = 0, unchanged = 0;
    var skipped = [];
    (records || []).forEach(function (rec) {
      var live = index();
      var el = live[rec.key];
      var parent = rec.parent ? live[rec.parent] : root();
      var prev = rec.prev ? live[rec.prev] : null;

      if (!el || !parent || (rec.prev && !prev)) {
        missed += 1; skipped.push(describe(rec)); return;
      }
      if (el === parent || el.contains(parent)) {
        missed += 1; skipped.push(describe(rec)); return;
      }
      if (prev && prev.parentNode !== parent) {
        missed += 1; skipped.push(describe(rec)); return;
      }

      var anchor = prev ? prev.nextSibling : opening(parent);
      if (el.parentNode === parent && el.nextSibling === anchor) { unchanged += 1; return; }
      if (anchor === el) { unchanged += 1; return; }
      parent.insertBefore(el, anchor);
      applied += 1;
    });
    if (applied) Ryker.move.syncNav();
    return { applied: applied, missed: missed, unchanged: unchanged, skipped: skipped };
  }

  // ---- the authored tree, for Discard --------------------------------------

  // Node references rather than keys. Discard puts the authored document back
  // exactly, including the comments and locked paragraphs between units, and
  // only the real next sibling can do that.
  function capture() {
    baseline = snapshot();
    marks = walk().map(function (u) {
      return { node: u.el, parent: u.el.parentNode, next: u.el.nextSibling };
    });
  }

  function rebase() { capture(); }
  function baselineOf() { return baseline; }
  function moves() { return baseline ? diff(baseline, snapshot()) : []; }

  // Two passes, because the two things being fixed want opposite orders.
  //
  // Forward first, parents before children, so a unit that was deleted along
  // with its container is put back into a container that is in the document
  // again rather than into a detached one, which is how a restored block
  // vanished from the report while Discard reported success.
  //
  // Reverse second, so a unit's recorded next sibling is back where it belongs
  // before it is used as an insertion point. Same reasoning as move.js's own
  // undo, and the same failure without it: the run comes back inside out.
  //
  // No isConnected guard on the second pass. A unit that MOVED is still in the
  // document, which is exactly the case this exists for, and skipping it was
  // why Discard restored a moved paragraph and left a moved table where it was
  // dropped.
  function put(ref) {
    if (!ref.parent || !ref.parent.isConnected) return false;
    var at = ref.next && ref.next.parentNode === ref.parent ? ref.next : null;
    if (ref.node.parentNode === ref.parent && ref.node.nextSibling === at) return false;
    ref.parent.insertBefore(ref.node, at);
    return true;
  }

  function restore() {
    var touched = false;
    marks.forEach(function (ref) {
      if (!ref.node.isConnected && put(ref)) touched = true;
    });
    marks.slice().reverse().forEach(function (ref) {
      if (put(ref)) touched = true;
    });
    if (touched) Ryker.move.syncNav();
  }

  return {
    snapshot: snapshot, index: index, diff: diff, replay: replay,
    capture: capture, rebase: rebase, restore: restore,
    baseline: baselineOf, moves: moves, isUnit: isUnit
  };
})();
