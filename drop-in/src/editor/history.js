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
      // The instruction pane is an ordinary textarea and keeps its own undo.
      var path = e.composedPath ? e.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        var n = path[i];
        if (n && n.tagName === 'TEXTAREA') return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (k === 'y' || e.shiftKey) redo(); else undo();
    }, true);
  }

  return {
    record: record, text: text, flush: flushText, undo: undo, redo: redo,
    clear: clear, canUndo: canUndo, canRedo: canRedo, depth: depth,
    isApplying: isApplying, bind: bind, onChange: onChange
  };
})();
