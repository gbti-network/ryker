// Selecting across blocks, which the browser will not do.
//
// Every prose block is its own editing host, and that is what keeps an edit from
// running away into the markup around it. The price is that Blink refuses to
// extend a selection past an editing-host boundary: drag from paragraph one into
// paragraph four and the anchor and the focus both stay in paragraph one. The
// earlier attempt read the native selection and therefore saw nothing on every
// real gesture, while a select-all with focus on the body handed it the entire
// document and deleted the report.
//
// So Ryker owns the gesture instead. The set below is the only thing that counts
// as picked, a selection Ryker did not make can never fill it, and the browser
// keeps its own selection whenever the drag stays inside one block.
Ryker.pick = (function () {
  'use strict';

  var picked = [];
  var origin = null;
  var pressed = false, engaged = false;
  var lastX = 0, lastY = 0;
  var seq = null, raf = 0;
  var listeners = [];

  // The scroll band at the window edge, and the most it moves in one frame.
  var EDGE = 90, CAP = 18;

  function inShell(n) { return !!(n && Ryker.shell && Ryker.shell.owns(n)); }
  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  // elementFromPoint rather than the event target: the target is the node the
  // press began on and stops following the pointer once a drag is under way.
  // Shadow content retargets to its host, so a hit on the Ryker root means one
  // of our own surfaces is in the way and there is no block under the pointer.
  function blockAt(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el || inShell(el)) return null;
    var b = el.closest ? el.closest(Ryker.blocks.PICK_SELECTOR) : null;
    if (!b || inShell(b)) return null;
    if (Ryker.blocks.excluded(b)) return null;
    if (!Ryker.blocks.atomic(b) && b.querySelector(Ryker.blocks.SELECTOR)) return null;
    if (!Ryker.blocks.root().contains(b)) return null;
    return b;
  }

  // Dragging down the page margin resolves no element at all, and without this
  // the whole gesture picks nothing. The 200px clamp is load bearing: unbounded,
  // a pointer in the margin grabs a block from the far end of the document.
  function blockNear(x, y) {
    var hit = blockAt(x, y);
    if (hit) return hit;
    var rr = Ryker.blocks.root().getBoundingClientRect();
    if (x < rr.left - 40 || x > rr.right + 40) return null;
    var list = seq || Ryker.blocks.pickSequence();
    var best = null, bestD = 200, i, r, d;
    for (i = 0; i < list.length; i++) {
      r = list[i].getBoundingClientRect();
      if (!r.width && !r.height) continue;
      d = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
      if (d < bestD) { bestD = d; best = list[i]; }
    }
    return best;
  }

  // Drawn from the same sequence multi.collapse() filters, so the two agree
  // about what a block is by construction rather than by coincidence.
  function span(a, b) {
    var list = seq || (seq = Ryker.blocks.pickSequence());
    var i = list.indexOf(a), j = list.indexOf(b);
    if (i === -1 || j === -1) return [];
    return i <= j ? list.slice(i, j + 1) : list.slice(j, i + 1);
  }

  // A class diff, never a full repaint: the report can hold hundreds of blocks
  // and a drag repaints on every pointer move.
  function paint(next) {
    var was = picked;
    was.forEach(function (n) {
      if (next.indexOf(n) === -1) n.classList.remove('ryker-pick');
    });
    next.forEach(function (n) {
      if (was.indexOf(n) === -1) n.classList.add('ryker-pick');
    });
    picked = next;
    emit();
  }

  function clear() {
    if (!picked.length && !engaged) return;
    picked.forEach(function (n) { n.classList.remove('ryker-pick'); });
    picked = [];
    engaged = false;
    document.body.classList.remove('ryker-picking');
    emit();
  }

  function set(list) {
    paint((list || []).filter(function (n) { return n && !Ryker.blocks.excluded(n); }));
  }

  function extend(node) {
    if (!node) return;
    var from = origin || picked[0] || node;
    origin = from;
    paint(span(from, node));
  }

  function dropNative() {
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
  }

  // Engaging only when the pointer leaves the block it started in is what keeps
  // ordinary text selection intact. Up to that moment the browser is doing
  // something useful and nothing is taken away from it; past it the browser has
  // already given up.
  function track(x, y) {
    if (!pressed || !origin) return;
    var hit = blockNear(x, y);
    if (!hit) return;
    if (!engaged) {
      if (hit === origin) return;
      engaged = true;
      document.body.classList.add('ryker-picking');
    }
    dropNative();
    paint(span(origin, hit));
  }

  function step() {
    raf = 0;
    if (!pressed) return;
    var h = window.innerHeight;
    var dy = 0;
    if (lastY < EDGE) dy = -Math.ceil(CAP * (EDGE - lastY) / EDGE);
    else if (lastY > h - EDGE) dy = Math.ceil(CAP * (lastY - (h - EDGE)) / EDGE);
    if (dy) {
      // Instant, because both reports set scroll-behavior:smooth, and a smooth
      // scrollBy inside a frame loop animates every call and then reads back a
      // position that has not arrived yet.
      window.scrollBy({ top: dy, left: 0, behavior: 'instant' });
      track(lastX, lastY);
    }
    raf = window.requestAnimationFrame(step);
  }

  function down(e) {
    if (e.button !== 0) return;
    if (inShell(e.target)) return;
    if (!Ryker.editable.isOn()) return;

    if (e.shiftKey && picked.length) {
      var hit = blockNear(e.clientX, e.clientY);
      if (hit) { e.preventDefault(); dropNative(); extend(hit); }
      return;
    }

    clear();
    seq = Ryker.blocks.pickSequence();
    origin = blockNear(e.clientX, e.clientY);
    if (Ryker.blocks.atomic(origin)) {
      e.preventDefault();
      dropNative();
      paint([origin]);
      origin = null;
      pressed = false;
      return;
    }
    pressed = true;
    lastX = e.clientX;
    lastY = e.clientY;
    if (!raf) raf = window.requestAnimationFrame(step);
  }

  function move(e) {
    if (!pressed) return;
    lastX = e.clientX;
    lastY = e.clientY;
    track(lastX, lastY);
  }

  function up() {
    pressed = false;
    seq = null;
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
  }

  // The union box of the picked blocks, for anything that needs to point at the
  // selection now that there is no Range to ask.
  function rect() {
    if (!picked.length) return null;
    var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    picked.forEach(function (n) {
      var k = n.getBoundingClientRect();
      if (!k.width && !k.height) return;
      l = Math.min(l, k.left); t = Math.min(t, k.top);
      r = Math.max(r, k.right); b = Math.max(b, k.bottom);
    });
    if (l === Infinity) return null;
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  }

  function init() {
    document.addEventListener('mousedown', down, true);
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
    window.addEventListener('pointercancel', up, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && picked.length) clear();
    }, true);
    // Mandatory, not defensive. Chrome starts a native drag when a press lands
    // on already-selected text or on an image, and a native drag delivers no
    // mousemove at all, so without this the gesture is invisible to us and
    // picks nothing.
    document.addEventListener('dragstart', function (e) {
      if (pressed && !inShell(e.target)) e.preventDefault();
    }, true);
  }

  return {
    init: init, picked: function () { return picked.slice(); },
    rect: rect, set: set, extend: extend, clear: clear,
    isEngaged: function () { return engaged; },
    has: function (n) { return picked.indexOf(n) !== -1; },
    onChange: onChange
  };
})();
