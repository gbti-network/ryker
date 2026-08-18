// Undo and redo for the things the browser cannot undo itself.
//
// Ryker performs structural edits directly on the DOM: splitting a block,
// merging two, converting a paragraph into a heading. The browser's own undo
// stack only knows about edits it made, so once Ryker moves nodes around,
// Ctrl+Z does nothing and whatever was collapsed is simply gone. That is how a
// heading got absorbed into the paragraph above it with no way back.
//
// Entries hold inverse operations rather than document snapshots. A report can
// carry megabytes of inlined images inside the editable region, so snapshotting
// its HTML per keystroke would cost hundreds of megabytes; an inverse closure
// costs a few element references.
Ryker.history = (function () {
  'use strict';

  var MAX = 80;
  var past = [];
  var future = [];
  var listeners = [];
  var applying = false;
  var baselineNodes = {};
  var baselineBoxes = {};
  var baselineRows = {};

  var pending = null;   // block being typed into
  var timer = null;
  var DEBOUNCE = 600;

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  function record(entry) {
    if (applying) return;
    flushText();
    push(entry);
  }

  function push(entry) {
    past.push(entry);
    if (past.length > MAX) past.shift();
    future.length = 0;
    emit();
  }

  // Typing is collected into one entry per block per pause, so undo steps back
  // by a phrase rather than by a character. Finer granularity is not worth
  // eighty entries for one sentence.
  function text(node) {
    if (applying) return;
    if (pending && pending.node !== node) flushText();
    if (!pending) pending = { node: node, before: node.innerHTML };
    clearTimeout(timer);
    timer = setTimeout(flushText, DEBOUNCE);
  }

  function flushText() {
    clearTimeout(timer);
    if (!pending) return;
    var node = pending.node, before = pending.before;
    var after = node.innerHTML;
    pending = null;
    if (before === after) return;
    push({
      label: 'edit',
      undo: function () { node.innerHTML = before; place(node); },
      redo: function () { node.innerHTML = after; place(node); }
    });
  }

  function place(node) {
    try {
      var r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(false);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      node.focus();
    } catch (e) {}
  }

  function run(entry, dir) {
    applying = true;
    try { (dir === 'undo' ? entry.undo : entry.redo)(); }
    catch (e) { if (Ryker.log) Ryker.log('history ' + dir + ': ' + e.message); }
    applying = false;
    emit();
  }

  function undo() {
    flushText();
    var entry = past.pop();
    if (!entry) return false;
    run(entry, 'undo');
    future.push(entry);
    return true;
  }

  function redo() {
    var entry = future.pop();
    if (!entry) return false;
    run(entry, 'redo');
    past.push(entry);
    return true;
  }

  function clear() { past.length = 0; future.length = 0; pending = null; emit(); }
  function canUndo() { return past.length > 0 || !!pending; }
  function canRedo() { return future.length > 0; }
  function depth() { return past.length; }
  function isApplying() { return applying; }

  // Discard restores the actual authored nodes rather than reconstructing them
  // from text. These references retain attributes, namespaces, host listeners
  // and removable containers without cloning the whole report per edit.
  function captureBaseline(snapshot) {
    baselineNodes = {};
    baselineBoxes = {};
    baselineRows = {};
    Object.keys(snapshot || {}).forEach(function (id) {
      var node = Ryker.blocks.byId(id);
      if (!node) return;
      baselineNodes[id] = { node: node, parent: node.parentNode, next: node.nextSibling };
      var boxId = snapshot[id] && snapshot[id].box;
      var box = boxId && node.closest ? node.closest('table, figure, ul, ol, dl') : null;
      if (box && !baselineBoxes[boxId]) {
        baselineBoxes[boxId] = { node: box, parent: box.parentNode, next: box.nextSibling };
      }
      // A row is a container in exactly the way a table is, and Discard has to
      // put one back for the same reason. Deleting a row detaches the <tr>, so
      // its cells were restored into an element no longer in the document and
      // disappeared from the report while Discard reported success.
      var rowId = snapshot[id] && snapshot[id].row;
      var row = rowId && node.closest ? node.closest('tr') : null;
      if (row && !baselineRows[rowId]) {
        baselineRows[rowId] = { node: row, parent: row.parentNode, next: row.nextSibling };
      }
    });
  }

  function restoreBaseline(snapshot, armed) {
    flushText();

    // Containers come back before anything is measured. A cell added inside a
    // row and then deleted along with that row is invisible to a snapshot for
    // as long as the row is detached, so it was never counted as an extra and
    // rode back into the document when the row returned. Tables before rows,
    // because a row cannot be restored into a <tbody> that is not in the
    // document yet.
    Object.keys(baselineBoxes).reverse().forEach(function (id) {
      if (!baselineBoxes[id].node.isConnected) restore(baselineBoxes[id]);
    });
    Object.keys(baselineRows).reverse().forEach(function (id) {
      if (!baselineRows[id].node.isConnected) restore(baselineRows[id]);
    });

    var current = Ryker.blocks.snapshot();
    var extras = [];

    Object.keys(current).forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(snapshot, id)) {
        var node = Ryker.blocks.byId(id);
        if (node) extras.push(node);
      }
    });
    (armed || []).forEach(function (node) {
      var id = Ryker.blocks.blockId(node);
      if (node.isConnected && !Object.prototype.hasOwnProperty.call(snapshot, id) &&
          extras.indexOf(node) === -1) extras.push(node);
    });

    function removeExtra(node) {
      var parent = node.parentNode;
      if (!parent) return;
      parent.removeChild(node);
      // An added row's cells are extras; the <tr> holding them is not a block
      // and nothing else would ever remove it, so Discard left an empty stripe
      // across the table.
      if (parent.matches && parent.matches('tr') && !parent.children.length &&
          parent.parentNode && !baselineRows[Ryker.table.rowKey(parent)]) {
        parent.parentNode.removeChild(parent);
        return;
      }
      if (parent.matches && parent.matches('ul, ol, dl') &&
          !parent.querySelector(Ryker.blocks.SELECTOR) && parent.parentNode) {
        parent.parentNode.removeChild(parent);
      }
    }
    function restore(ref) {
      if (!ref || !ref.parent) return;
      var at = ref.next && ref.next.parentNode === ref.parent ? ref.next : null;
      ref.parent.insertBefore(ref.node, at);
    }

    extras.forEach(removeExtra);
    Object.keys(snapshot).reverse().forEach(function (id) {
      var ref = baselineNodes[id];
      if (!ref) return;
      var currentNode = Ryker.blocks.byId(id);
      if (currentNode && currentNode !== ref.node) removeExtra(currentNode);
      if (!snapshot[id].atomic) ref.node.innerHTML = Ryker.blocks.htmlOf(snapshot[id]);
      restore(ref);
      ref.node.classList.remove('ryker-dirty', 'ryker-pick');
      if (!snapshot[id].atomic) Ryker.editable.rebind(ref.node);
    });
    if (Ryker.pick) Ryker.pick.clear();
    clear();
  }

  // Ctrl+Z and Ctrl+Shift+Z, plus Ctrl+Y. Taken over completely rather than
  // shared with the browser: a stack that sometimes handles an action and
  // sometimes defers is worse than one that always does, because nobody can
  // predict what a second press will do.
  function bind() {
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      var k = (e.key || '').toLowerCase();
      if (k !== 'z' && k !== 'y') return;
      if (!Ryker.editable.isOn()) return;
      // Form fields and independent editable controls keep their own native undo.
      // Ryker takes over only inside one of the document blocks it armed; doing
      // otherwise makes Ctrl+Z in a link/save dialog mutate the page behind it.
      var path = e.composedPath ? e.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        var n = path[i];
        if (!n || !n.tagName) continue;
        if (n.tagName === 'TEXTAREA' || n.tagName === 'INPUT' || n.tagName === 'SELECT') return;
        if (n.isContentEditable && !(n.closest && n.closest('.ryker-editing'))) return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (k === 'y' || e.shiftKey) redo(); else undo();
    }, true);
  }

  return {
    record: record, text: text, flush: flushText, undo: undo, redo: redo,
    clear: clear, canUndo: canUndo, canRedo: canRedo, depth: depth,
    isApplying: isApplying, bind: bind, onChange: onChange,
    captureBaseline: captureBaseline, restoreBaseline: restoreBaseline
  };
})();
