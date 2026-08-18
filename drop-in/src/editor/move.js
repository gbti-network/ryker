// Moving whole units of the document, and knowing afterwards that they moved.
//
// A move was the one edit Ryker could not see. Block identity is derived from a
// block's own content, so a paragraph dragged from the end of a section to the
// start of it keeps its id and its markup: diffSnapshots compares the two
// snapshots key by key, finds every key present in both with identical HTML,
// and reports nothing at all. isDirty stayed false and Save would not open.
//
// What a move changes is ORDER, and a snapshot already records order. Its keys
// are the block ids in document order, and every id begins with ~, # or @, so
// none of them is an array index, which is the one case where an object
// reorders its own keys. A move is therefore derived exactly the way an edit
// is: compare the order the document was authored in against the order it is
// in now. Nothing is accumulated, so moving a paragraph out and back again
// registers as what it is, which is nothing.
//
// Reporting it needs one more step. Two orders differ in many ways at once and
// most accounts of the difference are useless: saying that four hundred blocks
// each shifted up by one is true and unfollowable. The smallest honest account
// is the set that has to move for everything else to be left alone, which is
// whatever falls outside the longest run of blocks that kept its relative
// order. That is what longestRun() finds and what between() reports.
Ryker.move = (function () {
  'use strict';

  // ---- what moved, derived from two snapshots -----------------------------

  // The longest subsequence that is already in ascending order. Everything
  // outside it is what has to be moved. O(n squared) on purpose: n is the
  // number of contiguous runs, not the number of blocks, and a session with
  // three moves in it produces about four runs.
  // The longest increasing subsequence of runs, weighted by how many BLOCKS each
  // run holds rather than by how many runs are kept.
  //
  // Unweighted this counted runs, and the two are not the same answer. Moving
  // one paragraph from the end of five to the front leaves runs [e] and
  // [a,b,c,d]: one run either way, so the tie fell to whichever came first and
  // the report was "move a, b, c and d after e" instead of "move e to the
  // front". Both produce the same document and only one is readable, and this
  // module exists to give the smallest honest account rather than any true one.
  //
  // Weighting also makes the tie-break meaningful where it used to be arbitrary:
  // the set left alone is the one covering the most of the document.
  // between(), cover() and describe() below are the flat block-order model.
  // They no longer decide what moved: editor/units.js does, because a move is a
  // change to the element tree and flat order cannot see one. What is left here
  // serves replay() alone, so a recovery draft written before the unit model
  // still replays through the reader that wrote it.
  function longestRun(vals, weights) {
    var n = vals.length, best = [], from = [], top = -1, i, j;
    for (i = 0; i < n; i++) {
      var w = weights ? weights[i] : 1;
      best[i] = w; from[i] = -1;
      for (j = 0; j < i; j++) {
        if (vals[j] < vals[i] && best[j] + w > best[i]) { best[i] = best[j] + w; from[i] = j; }
      }
      if (top === -1 || best[i] > best[top]) top = i;
    }
    var keep = {};
    while (top !== -1) { keep[top] = 1; top = from[top]; }
    return keep;
  }

  // Blocks that are contiguous in both orders travel together. Without this a
  // moved section of twenty paragraphs reads as twenty separate moves, each of
  // which is individually true and collectively unreadable.
  function between(before, after) {
    if (!before || !after) return [];
    var afterIds = Object.keys(after);
    var present = {};
    afterIds.forEach(function (id) { present[id] = 1; });

    // Compacted, so that a block deleted from the middle of a run does not
    // split the run in two and report a move nobody made.
    var order = {}, origin = [];
    Object.keys(before).forEach(function (id) {
      if (present[id]) { order[id] = origin.length; origin.push(id); }
    });

    var runs = [], cur = null;
    afterIds.forEach(function (id, i) {
      var p = order[id];
      if (p === undefined) return;
      if (cur && p === cur.end + 1) { cur.end = p; cur.ids.push(id); return; }
      cur = { start: p, end: p, ids: [id], at: i };
      runs.push(cur);
    });
    if (runs.length < 2) return [];

    var keep = longestRun(
      runs.map(function (r) { return r.start; }),
      runs.map(function (r) { return r.ids.length; }));
    var out = [];
    runs.forEach(function (r, i) {
      if (keep[i]) return;
      out.push({
        kind: 'move',
        ids: r.ids.slice(),
        // The block it now follows, named from the final order including any
        // block this session added, so applying the moves in the order given
        // always finds its anchor already in place.
        prev: r.at > 0 ? afterIds[r.at - 1] : null,
        wasAfter: r.start > 0 ? origin[r.start - 1] : null
      });
    });
    return out;
  }

  // What the toolbar and the save dialog put a number on. Asked of the unit
  // tree, so a table dragged into another section counts as the one move it is
  // rather than as nothing at all.
  function count() {
    if (Ryker.units) return Ryker.units.moves().length;
    var base = Ryker.editable.baselineOf();
    if (!base) return 0;
    return between(base, Ryker.blocks.snapshot()).length;
  }

  // ---- what a run of blocks actually is, in the source file ---------------

  // The smallest set of elements holding every block of the run and nothing
  // else. A run covering every cell of a table is the table; a run covering
  // every child of a section is the section. The source HTML has tables and
  // sections in it and has never heard of a block, so this is the only form of
  // the answer anyone can act on.
  function cover(nodes) {
    var top = Ryker.blocks.root();
    var seq = Ryker.blocks.sequence();
    var out = [];

    function holds(el) {
      for (var i = 0; i < seq.length; i++) {
        if (el.contains(seq[i]) && nodes.indexOf(seq[i]) === -1) return false;
      }
      return true;
    }

    nodes.forEach(function (n) {
      var el = n;
      while (el.parentElement && el.parentElement !== top && holds(el.parentElement)) {
        el = el.parentElement;
      }
      if (out.indexOf(el) === -1 && !covered(out, el)) out.push(el);
    });
    return out.filter(function (el) {
      return !out.some(function (o) { return o !== el && o.contains(el); });
    });
  }

  function covered(list, el) {
    return list.some(function (o) { return o.contains(el); });
  }

  function nodesOf(rec) {
    var out = [];
    rec.ids.forEach(function (id) {
      var n = Ryker.blocks.byId(id);
      if (n) out.push(n);
    });
    return out;
  }

  // Everything a move step needs to be written down: what moved, what it is
  // called, and which contents entries have to travel with it.
  function describe(rec) {
    var nodes = nodesOf(rec);
    if (!nodes.length) return null;
    var els = cover(nodes);
    if (!els.length) return null;
    return {
      nodes: nodes, elements: els,
      tag: els.length === 1 ? els[0].tagName : null,
      kind: Ryker.outline.kindOf(els[0]),
      label: Ryker.outline.label(els[0]),
      blocks: nodes.length,
      nav: navLabels(els)
    };
  }

  // ---- the report's own table of contents ---------------------------------

  function navLinks() {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('nav'), function (nav) {
      Array.prototype.forEach.call(nav.querySelectorAll('a[href^="#"]'), function (a) {
        out.push(a);
      });
    });
    return out;
  }

  function navLabels(els) {
    var out = [];
    navLinks().forEach(function (a) {
      var t = document.getElementById(a.getAttribute('href').slice(1));
      if (!t) return;
      if (els.some(function (el) { return el === t || el.contains(t); })) {
        out.push(Ryker.dom.textOf(a));
      }
    });
    return out;
  }

  // The contents list is navigation, so it is not editable and no snapshot
  // covers it. A section that moves would leave it listing the old order, which
  // reads as a bug in the report rather than as an edit in progress. The links
  // are put back in document order here, and the instruction set says the same
  // thing has to happen in the file.
  function syncNav() {
    Array.prototype.forEach.call(document.querySelectorAll('nav'), function (nav) {
      var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
      if (links.length < 2) return;
      var host = links[0].parentNode;
      if (!links.every(function (a) { return a.parentNode === host; })) return;

      var ranked = [], ok = true;
      links.forEach(function (a, i) {
        var t = document.getElementById(a.getAttribute('href').slice(1));
        if (!t) { ok = false; return; }
        ranked.push({ a: a, i: i, t: t });
      });
      if (!ok) return;

      var sorted = ranked.slice().sort(function (x, y) {
        var p = x.t.compareDocumentPosition(y.t);
        if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return x.i - y.i;
      });
      if (!sorted.some(function (r, i) { return r !== ranked[i]; })) return;

      // The whitespace between two links is a text node, and appendChild moves
      // only the link. Collected before anything is moved, because reading a
      // sibling halfway through the reorder reads the new arrangement.
      var pairs = sorted.map(function (r) {
        var ws = r.a.nextSibling;
        return { a: r.a, ws: (ws && ws.nodeType === 3 && !ws.nodeValue.trim()) ? ws : null };
      });
      pairs.forEach(function (p) {
        host.appendChild(p.a);
        if (p.ws) host.appendChild(p.ws);
      });
    });
  }

  // ---- performing a move --------------------------------------------------

  var CHROME = { HEADER: 1, FOOTER: 1, NAV: 1, SCRIPT: 1, STYLE: 1, TEMPLATE: 1 };

  function movable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'SECTION') return true;
    if (CHROME[el.tagName]) return false;
    return !Ryker.blocks.excluded(el);
  }

  // Where the unit is actually allowed to land. A <section> is a top-level unit
  // and nesting one inside another would produce a structure the report's own
  // stylesheet has never seen, so a dropped section climbs to the nearest
  // top-level element rather than being refused.
  function landing(nodes, target) {
    if (!target || !nodes.length) return null;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] === target || nodes[i].contains(target)) return null;
    }
    var t = target;
    if (nodes.some(function (n) { return n.tagName === 'SECTION'; })) {
      var top = Ryker.blocks.root();
      while (t && t.parentElement !== top) t = t.parentElement;
    }
    if (!t || !t.parentNode || !movable(t)) return null;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i] === t || nodes[i].contains(t)) return null;
    }
    return t;
  }

  function check(nodes, target, where) {
    if (!nodes || !nodes.length) return 'There is nothing to move.';
    var t = landing(nodes, target);
    if (!t) return 'That would put it inside itself.';
    var last = nodes[nodes.length - 1];
    if (where === 'after' && t === nodes[0].previousElementSibling) return 'It is already there.';
    if (where === 'before' && t === last.nextElementSibling) return 'It is already there.';
    return null;
  }

  // Returns null when the move happened, and a sentence when it did not.
  function apply(nodes, target, where) {
    var why = check(nodes, target, where);
    if (why) return why;

    var t = landing(nodes, target);
    var host = t.parentNode;
    // Captured once, before anything moves. check() has already refused the two
    // arrangements in which the anchor could be one of the nodes being moved.
    var anchor = where === 'before' ? t : t.nextSibling;
    var was = nodes.map(function (n) {
      return { node: n, host: n.parentNode, at: n.nextSibling };
    });

    function put() {
      nodes.forEach(function (n) { host.insertBefore(n, anchor); });
      syncNav();
    }
    // Reverse order, so a node's recorded next sibling is back in the document
    // before it is used as an insertion point. Same reasoning as multi.js, and
    // the same failure without it: the run comes back inside out.
    function back() {
      was.slice().reverse().forEach(function (d) {
        var at = d.at && d.at.parentNode === d.host ? d.at : null;
        d.host.insertBefore(d.node, at);
      });
      syncNav();
    }

    put();
    // No rebinding. A move never detaches an element from the document, so its
    // listeners, its contenteditable attribute and its classes all travel with
    // it untouched.
    Ryker.history.record({ label: 'move', undo: back, redo: put });
    if (Ryker.pick) Ryker.pick.clear();
    Ryker.editable.touch();
    return null;
  }

  // Reapply recorded structural moves without adding them to the current
  // tab's undo stack. Recovery starts from the authored DOM, resolves block
  // ids back to their smallest complete units, then uses the saved predecessor
  // to place those units even when the move crossed container boundaries.
  function replay(records) {
    var applied = 0, missed = 0, unchanged = 0;
    (records || []).forEach(function (record) {
      var ids = Array.isArray(record && record.ids) ? record.ids : [];
      var nodes = nodesOf({ ids: ids });
      if (!ids.length || nodes.length !== ids.length) { missed += 1; return; }
      var elements = cover(nodes);
      if (!elements.length) { missed += 1; return; }

      var target = record.prev ? Ryker.blocks.byId(record.prev) : null;
      var where = record.prev ? 'after' : 'before';
      if (!target) {
        target = Ryker.blocks.sequence().filter(function (candidate) {
          return !elements.some(function (element) {
            return element === candidate || element.contains(candidate);
          });
        })[0] || null;
      }
      if (!target) { missed += 1; return; }

      var why = check(elements, target, where);
      if (why === 'It is already there.') { unchanged += 1; return; }
      if (why) { missed += 1; return; }

      var landingTarget = landing(elements, target);
      var host = landingTarget.parentNode;
      var anchor = where === 'before' ? landingTarget : landingTarget.nextSibling;
      elements.forEach(function (element) { host.insertBefore(element, anchor); });
      applied += 1;
    });
    if (applied) syncNav();
    return { applied: applied, missed: missed, unchanged: unchanged };
  }

  // One step up or down, for the keyboard and for the context menu. Drag is not
  // the only way to reorder a document and should not be the only way here.
  // A heading unit moves past a whole SECTION of the document, not past one
  // element.
  //
  // The sibling immediately above a heading is the LAST paragraph of the
  // section above it, and the sibling immediately below a unit is the NEXT
  // section's heading. Landing against either of those stranded a paragraph:
  // moving "Stop blocking on verification" up put it between the heading and
  // the body of the section above, and left that section's paragraph at the
  // end of the document under someone else's heading. Reproduced on a flat
  // heading-and-paragraph document, 2026-08-18. This is the outline rail's own
  // Move up and Move down, so it was reachable in any document that does not
  // wrap every subsection in its own container.
  //
  // So a move has to land against the far edge of the neighbouring unit: the
  // FIRST element of the unit above going up, the LAST element of the unit
  // below going down.

  // Where one unit stops and the next begins. A SECTION is a unit on its own,
  // and so is a heading at or above the rank being moved. A deeper heading is
  // part of the unit it sits inside and does not open a new one.
  function opensUnit(el, rank) {
    if (!el) return true;
    if (el.tagName === 'SECTION') return true;
    var r = Ryker.outline.rankOf(el);
    return !!r && r <= rank;
  }

  function unitEdge(from, dir, rank) {
    if (!rank) return from;
    var edge = from, n;

    if (dir === 'up') {
      n = from;
      while (n && !opensUnit(n, rank)) {
        if (movable(n)) edge = n;
        n = n.previousElementSibling;
      }
      // A heading opens the unit, so it IS the landing point. A SECTION or the
      // top of the container does not, and the earliest block seen is.
      if (n && n.tagName !== 'SECTION') return n;
      return edge;
    }

    n = from.nextElementSibling;
    while (n && !opensUnit(n, rank)) {
      if (movable(n)) edge = n;
      n = n.nextElementSibling;
    }
    return edge;
  }

  function nudge(nodes, dir) {
    if (!nodes || !nodes.length) return 'There is nothing to move.';
    var n = dir === 'up' ? nodes[0].previousElementSibling
                         : nodes[nodes.length - 1].nextElementSibling;
    while (n && !movable(n)) {
      n = dir === 'up' ? n.previousElementSibling : n.nextElementSibling;
    }
    if (!n) return dir === 'up' ? 'It is already first.' : 'It is already last.';
    n = unitEdge(n, dir, Ryker.outline.rankOf(nodes[0]));
    return apply(nodes, n, dir === 'up' ? 'before' : 'after');
  }

  return {
    between: between, count: count, describe: describe, cover: cover,
    apply: apply, replay: replay, check: check, nudge: nudge, landing: landing,
    movable: movable, syncNav: syncNav, navFor: navLabels
  };
})();
