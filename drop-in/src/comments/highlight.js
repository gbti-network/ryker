// Painting comment ranges without mutating the report.
//
// CSS.highlights is the primary path because it marks text without touching the
// DOM, which matters when the same DOM is being edited, diffed and exported. A
// <mark> wrapper would put Ryker's elements inside the report's own content,
// where they would land in the saved HTML, shift the block ids that comments
// anchor against, and appear in the PDF.
//
// Confirmed available from file:// on 2026-08-13. The wrapper fallback exists
// for browsers without it and is removed cleanly on teardown.
Ryker.highlight = (function () {
  'use strict';

  var supported = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
  var registry = {};
  var wrappers = [];

  var NAMES = { open: 'ryker-open', resolved: 'ryker-resolved', active: 'ryker-active' };

  function clear() {
    if (supported) {
      Object.keys(NAMES).forEach(function (k) { CSS.highlights.delete(NAMES[k]); });
    }
    wrappers.forEach(function (w) {
      if (!w.parentNode) return;
      while (w.firstChild) w.parentNode.insertBefore(w.firstChild, w);
      w.parentNode.removeChild(w);
    });
    wrappers = [];
    registry = {};
    if (!supported) Ryker.blocks.root().normalize();
  }

  // ranges: [{ id, range, status }]
  function paint(ranges, activeId) {
    clear();
    if (!ranges.length) return;

    if (supported) {
      var buckets = { open: [], resolved: [], active: [] };
      ranges.forEach(function (r) {
        registry[r.id] = r.range;
        var key = r.id === activeId ? 'active' : (r.status === 'resolved' ? 'resolved' : 'open');
        buckets[key].push(r.range);
      });
      Object.keys(buckets).forEach(function (k) {
        if (!buckets[k].length) return;
        var h = new Highlight();
        buckets[k].forEach(function (rg) { h.add(rg); });
        CSS.highlights.set(NAMES[k], h);
      });
      return;
    }

    ranges.forEach(function (r) {
      registry[r.id] = r.range;
      try {
        var mark = document.createElement('mark');
        mark.className = 'ryker-mark ryker-mark-' + (r.id === activeId ? 'active' : (r.status || 'open'));
        mark.setAttribute('data-ryker-comment', r.id);
        r.range.surroundContents(mark);
        wrappers.push(mark);
      } catch (e) {
        // surroundContents throws on a range crossing element boundaries.
        // Skipping is correct: the comment still exists in the panel and is
        // still anchored, it simply is not painted.
      }
    });
  }

  function scrollTo(id) {
    var range = registry[id];
    if (!range) return false;
    var node = range.startContainer;
    var el = node.nodeType === 3 ? node.parentNode : node;
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    return false;
  }

  function isSupported() { return supported; }

  return { paint: paint, clear: clear, scrollTo: scrollTo, isSupported: isSupported, NAMES: NAMES };
})();
