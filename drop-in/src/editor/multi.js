// Deleting more than one block at a time, and deleting whole tables.
//
// Each block is its own editing host, which is what keeps an edit from running
// away into the markup around it. The cost is that a selection dragged across
// several paragraphs is refused outright: Blink clamps it to the host the press
// began in, so there is nothing to read. Ryker.pick tracks the gesture itself
// and this module acts on what it collected.
//
// Two rules keep it predictable. Only blocks the selection covers ENTIRELY are
// removed, so dragging from the middle of one paragraph to the middle of
// another takes what is between them and leaves the two ends intact rather than
// splicing their halves together. And a table is removed as a table: emptying
// its cells one by one leaves a grid of blank rows behind, which is never what
// anybody meant.
Ryker.multi = (function () {
  'use strict';

  function inShell(node) {
    return !!(node && node.closest && node.closest('#ryker-root'));
  }

  // What is selected across blocks. Ryker.pick owns it now.
  //
  // This used to read the native selection, and was wrong in both directions.
  //
  // Reading the native selection here was wrong in both directions at once.
  // It never fired when it should: Blink refuses to extend a selection across
  // an editing-host boundary, and per-block contenteditable makes every
  // paragraph its own host, so a real drag clamps to the paragraph it started
  // in and this returned nothing. Measured on the live report: drag paragraph 1
  // to paragraph 4, anchor and focus both land in paragraph 1, covered() is 0.
  // The module's tests passed only because a Range built in script leaves
  // boundary points that a user gesture never produces.
  //
  // And it fired catastrophically when it should not. Click the page margin so
  // focus sits on BODY, press Ctrl+A, press Backspace: the selection spans the
  // whole document, every block is enclosed, and the report is deleted. 455
  // blocks to 0 on the shipped report, recoverable only by undo, and gone for
  // good if the next act is a save.
  //
  // The replacement is a Ryker-owned pick layer that tracks the drag itself, so
  // a selection Ryker did not make can never produce a target set. Until that
  // lands this returns nothing, which is exactly what it returned for every
  // real gesture anyway. Nothing is lost by the withdrawal except the hazard.
  function covered() {
    return Ryker.pick ? Ryker.pick.picked() : [];
  }

  // A table whose blocks are all going becomes one removal of the table itself.
  //
  // Deliberately limited to tables, and to tables holding more than one block.
  // The instruction set applies the same test when it decides whether to say
  // "remove the table" or to list the cells, and the two must agree: a figure
  // removed here but reported as a caption deletion would take an image out of
  // the document that no instruction ever mentioned.
  function promotable(node) {
    var box = Ryker.blocks.boxOf(node);
    if (!box || box.tagName !== 'TABLE') return null;
    return box;
  }

  function collapse(nodes) {
    var set = nodes.slice();
    var boxes = [];
    var out = [];
    var swallowed = [];

    set.forEach(function (n) {
      var box = promotable(n);
      if (!box || boxes.indexOf(box) !== -1) return;
      var inside = Ryker.blocks.sequence().filter(function (m) {
        return Ryker.blocks.boxOf(m) === box;
      });
      if (inside.length < 2) return;
      var whole = inside.every(function (m) { return set.indexOf(m) !== -1; });
      if (!whole) return;
      boxes.push(box);
      swallowed = swallowed.concat(inside);
    });

    set.forEach(function (n) {
      if (swallowed.indexOf(n) === -1 && out.indexOf(n) === -1) out.push(n);
    });
    return boxes.concat(out);
  }

  function removeNodes(targets) {
    if (!targets.length) return false;
    var undoData = targets.map(function (n) {
      return { node: n, host: n.parentNode, at: n.nextSibling };
    }).filter(function (d) { return d.host; });
    if (!undoData.length) return false;

    function pull() {
      undoData.forEach(function (d) {
        if (d.node.parentNode) d.node.parentNode.removeChild(d.node);
      });
    }
    function put() {
      // Reverse order, so a node's recorded next sibling is already back in the
      // document by the time it is used as the insertion point.
      undoData.slice().reverse().forEach(function (d) {
        var at = d.at && d.at.parentNode === d.host ? d.at : null;
        d.host.insertBefore(d.node, at);
        rebindTree(d.node);
      });
    }

    pull();
    Ryker.history.record({ label: 'delete', undo: put, redo: pull });

    if (Ryker.pick) Ryker.pick.clear();
    Ryker.editable.touch();
    return true;
  }

  function rebindTree(node) {
    if (!Ryker.editable.isOn()) return;
    var list = node.matches && node.matches(Ryker.blocks.SELECTOR)
      ? [node]
      : Array.prototype.slice.call(node.querySelectorAll(Ryker.blocks.SELECTOR));
    list.forEach(function (n) {
      if (!Ryker.blocks.excluded(n) && !n.querySelector(Ryker.blocks.SELECTOR)) {
        Ryker.editable.rebind(n);
      }
    });
  }

  // The selection route: what someone gets from dragging across blocks.
  function removeSelection() {
    var nodes = covered();
    if (nodes.length < 2) return false;
    return removeNodes(collapse(nodes));
  }

  // The caret route: standing anywhere in a table and asking for it to go.
  function removeTableAt(node) {
    var box = node ? promotable(node) : null;
    if (!box) return false;
    return removeNodes([box]);
  }

  function tableAt(node) {
    return node ? promotable(node) : null;
  }

  // Safe now, because the set it reads can only have been filled by a gesture
  // Ryker tracked itself. A select-all cannot reach it.
  function init() {
    document.addEventListener('keydown', function (e) {
      if (!Ryker.editable.isOn()) return;
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      var path = e.composedPath ? e.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        if (path[i] && path[i].id === 'ryker-root') return;
        if (path[i] && path[i].tagName === 'TEXTAREA') return;
      }
      if (Ryker.pick.picked().length < 2) return;
      e.preventDefault();
      e.stopPropagation();
      removeSelection();
    }, true);
  }

  return {
    init: init, covered: covered, removeSelection: removeSelection,
    removeNodes: removeNodes,
    removeTableAt: removeTableAt, tableAt: tableAt, collapse: collapse
  };
})();
