// Layered comment anchoring, spec section 14.
//
// A comment must not rest on a DOM coordinate. Edit Mode exists so that people
// will change the text above a comment, and an XPath plus character offset
// breaks the first time they do. So an anchor records the quoted string, about
// 32 characters of context each side, and the containing block as a hint rather
// than as the anchor itself.
//
// Resolution tries five strategies in descending confidence. When none of them
// lands, the comment becomes Unanchored rather than attaching itself to
// plausible-looking but wrong content, which is the failure section 14 names.
Ryker.anchor = (function () {
  'use strict';

  var CONTEXT = 32;

  function capture(range) {
    var root = Ryker.blocks.root();
    var flat = Ryker.dom.flatten(root);
    var bounds = offsetsOf(range, flat);
    if (!bounds) return null;

    var quote = flat.text.slice(bounds.start, bounds.end);
    if (!quote.trim()) return null;

    var container = range.commonAncestorContainer;
    if (container.nodeType === 3) container = container.parentNode;
    var block = container.closest ? container.closest(Ryker.blocks.SELECTOR) : null;

    return {
      quote: quote,
      prefix: flat.text.slice(Math.max(0, bounds.start - CONTEXT), bounds.start),
      suffix: flat.text.slice(bounds.end, Math.min(flat.text.length, bounds.end + CONTEXT)),
      blockId: block ? Ryker.blocks.blockId(block, root) : null,
      approxStart: bounds.start
    };
  }

  function offsetsOf(range, flat) {
    var start = null, end = null;
    for (var i = 0; i < flat.index.length; i++) {
      var e = flat.index[i];
      if (e.node === range.startContainer) start = e.start + range.startOffset;
      if (e.node === range.endContainer) end = e.start + range.endOffset;
    }
    if (start == null || end == null || end <= start) return null;
    return { start: start, end: end };
  }

  function norm(s) { return String(s || '').replace(/\s+/g, ' '); }

  // Returns { range, confidence } or null. Confidence is reported so the panel
  // can distinguish a comment that landed exactly from one that landed on a
  // best guess.
  function resolve(a) {
    var root = Ryker.blocks.root();
    var strategies = [];

    if (a.blockId) {
      var block = Ryker.blocks.byId(a.blockId);
      if (block) {
        strategies.push({ scope: block, withContext: true, conf: 'exact' });
        strategies.push({ scope: block, withContext: false, conf: 'block' });
      }
    }
    strategies.push({ scope: root, withContext: true, conf: 'context' });
    strategies.push({ scope: root, withContext: false, conf: 'quote' });
    strategies.push({ scope: root, withContext: false, conf: 'loose', loose: true });

    for (var i = 0; i < strategies.length; i++) {
      var hit = attempt(a, strategies[i]);
      if (hit) return { range: hit, confidence: strategies[i].conf };
    }
    return null;
  }

  function attempt(a, s) {
    var flat = Ryker.dom.flatten(s.scope);
    var hay = s.loose ? norm(flat.text) : flat.text;
    var needle = s.loose ? norm(a.quote) : a.quote;
    if (!needle) return null;

    var positions = [];
    var from = 0;
    while (true) {
      var at = hay.indexOf(needle, from);
      if (at === -1) break;
      positions.push(at);
      from = at + 1;
      if (positions.length > 200) break;
    }
    if (!positions.length) return null;

    var chosen;
    if (s.withContext) {
      var scored = positions.map(function (p) {
        var pre = hay.slice(Math.max(0, p - CONTEXT), p);
        var suf = hay.slice(p + needle.length, p + needle.length + CONTEXT);
        return { p: p, score: common(pre, s.loose ? norm(a.prefix) : a.prefix, true) +
                              common(suf, s.loose ? norm(a.suffix) : a.suffix, false) };
      }).sort(function (x, y) { return y.score - x.score; });
      // Ambiguity is a reason to fail this strategy, not to guess between two
      // equally good candidates.
      if (scored.length > 1 && scored[0].score === scored[1].score && scored[0].score === 0) return null;
      chosen = scored[0].p;
    } else {
      if (positions.length > 1) return null;
      chosen = positions[0];
    }

    if (s.loose) {
      // A loose match found an offset in normalised text, which does not map
      // back to the live nodes. Re-find the raw quote near that point instead.
      var raw = flat.text.indexOf(a.quote);
      if (raw === -1) {
        var collapsed = a.quote.replace(/\s+/g, ' ').trim();
        raw = flat.text.replace(/\s+/g, ' ').indexOf(collapsed);
        if (raw === -1) return null;
      }
      chosen = raw;
      needle = a.quote;
    }

    return buildRange(s.scope, chosen, chosen + needle.length);
  }

  function common(a, b, fromEnd) {
    var n = Math.min(a.length, b.length), c = 0;
    for (var i = 0; i < n; i++) {
      var x = fromEnd ? a[a.length - 1 - i] : a[i];
      var y = fromEnd ? b[b.length - 1 - i] : b[i];
      if (x !== y) break;
      c++;
    }
    return c;
  }

  function buildRange(scope, start, end) {
    var flat = Ryker.dom.flatten(scope);
    var a = Ryker.dom.locate(flat, start);
    var b = Ryker.dom.locate(flat, end);
    if (!a || !b) return null;
    var r = document.createRange();
    try { r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset); }
    catch (e) { return null; }
    return r;
  }

  return { capture: capture, resolve: resolve, CONTEXT: CONTEXT };
})();
