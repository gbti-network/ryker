// The document as a tree of rows. No DOM of its own, no UI.
//
// A row is a direct child of a <section>, or a direct child of <main> that is
// not chrome. Deliberately not a tag list: three of this report's tables and ten
// of the other's sit inside a div.scroll-x that gives them their horizontal
// scrolling, so a row keyed on tag name would offer to move a table out of its
// own scroller. kindOf() reads what a row CONTAINS, so the wrapper still reads
// as a table and carries the table glyph.
//
// Rows nest by heading rank rather than by DOM nesting, because an h3 does not
// wrap the paragraphs that follow it. Every heading in both reports is a direct
// child of its section, which is what makes the single-pass stack below correct;
// tree() checks that and falls back rather than producing a wrong shape.
Ryker.outline = (function () {
  'use strict';

  var CHROME = { HEADER: 1, FOOTER: 1, NAV: 1, SCRIPT: 1, STYLE: 1, TEMPLATE: 1 };
  var HEADING = /^H([1-6])$/;

  function root() { return Ryker.blocks.root(); }

  function rankOf(el) {
    var m = el.tagName.match(HEADING);
    return m ? parseInt(m[1], 10) : 0;
  }

  // Every element the outline is willing to show, in document order.
  function rows() {
    var out = [];
    var hosts = [];
    var main = root();
    Array.prototype.forEach.call(main.children, function (n) {
      if (n.tagName === 'SECTION') hosts.push(n);
    });
    if (!hosts.length) hosts = [main];

    Array.prototype.forEach.call(main.children, function (n) {
      if (n.tagName === 'SECTION' || CHROME[n.tagName]) return;
      if (Ryker.blocks.excluded(n)) return;
      out.push(n);
    });
    hosts.forEach(function (sec) {
      Array.prototype.forEach.call(sec.children, function (n) {
        if (CHROME[n.tagName]) return;
        if (Ryker.blocks.excluded(n)) return;
        out.push(n);
      });
    });

    // Document order, since sections were walked after any loose children.
    out.sort(function (a, b) {
      var p = a.compareDocumentPosition(b);
      if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return out;
  }

  // Rows nested by heading rank. Content rows hang off the heading above them.
  function tree() {
    var flat = rows();
    var top = [];
    var stack = [];
    flat.forEach(function (el) {
      var rank = rankOf(el);
      var node = { el: el, rank: rank, kind: kindOf(el), label: label(el),
                   key: keyOf(el), children: [] };
      if (rank) {
        while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
        (stack.length ? stack[stack.length - 1].children : top).push(node);
        stack.push(node);
      } else {
        (stack.length ? stack[stack.length - 1].children : top).push(node);
      }
    });
    return top;
  }

  function kindOf(el) {
    if (rankOf(el)) return 'heading';
    if (el.tagName === 'SECTION') return 'section';
    if (el.querySelector && el.querySelector('table')) return 'table';
    if (el.tagName === 'TABLE') return 'table';
    if (el.tagName === 'FIGURE' || (el.querySelector && el.querySelector('figure'))) return 'figure';
    if (el.tagName === 'BLOCKQUOTE') return 'quote';
    if (el.tagName === 'UL' || el.tagName === 'OL') return 'list';
    if (el.tagName === 'DL') return 'list';
    return 'text';
  }

  function clip(s, n) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    n = n || 64;
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // Not blocks.label(): that prefixes the section heading, which the tree
  // already shows structurally, so every row would repeat its own ancestor.
  function label(el) {
    var kind = kindOf(el);
    if (kind === 'table') {
      var t = el.tagName === 'TABLE' ? el : el.querySelector('table');
      var head = t ? t.querySelector('thead tr, tr') : null;
      var cells = head ? Array.prototype.map.call(head.children, function (c) {
        return Ryker.dom.textOf(c);
      }).filter(Boolean) : [];
      return clip('Table: ' + (cells.join(', ') || Ryker.dom.textOf(el)));
    }
    if (kind === 'figure') {
      var fig = el.tagName === 'FIGURE' ? el : el.querySelector('figure');
      var cap = fig ? fig.querySelector('figcaption') : null;
      return clip('Figure: ' + (cap ? Ryker.dom.textOf(cap) : (fig && fig.querySelector('img')
        ? fig.querySelector('img').getAttribute('alt') || '' : '')));
    }
    if (kind === 'quote') return clip('Quote: ' + Ryker.dom.textOf(el));
    if (kind === 'list') {
      return clip('List of ' + el.children.length + ': ' + Ryker.dom.textOf(el));
    }
    return clip(Ryker.dom.textOf(el)) || '(empty)';
  }

  // Stable across a reload, because it is derived from the element's own id or
  // from its content the same way block ids are.
  function keyOf(el) {
    if (el.id) return '#' + el.id;
    var lead = el.querySelector && el.querySelector(Ryker.blocks.SELECTOR);
    var probe = lead && !Ryker.blocks.excluded(lead) ? lead : el;
    try { return Ryker.blocks.blockId(probe); } catch (e) { return el.tagName + ':' + label(el); }
  }

  // What a row takes with it: the element itself, plus everything a heading
  // owns down to the next heading of equal or higher rank. An h2 that opens a
  // section owns the whole section.
  function unitOf(el) {
    var rank = rankOf(el);
    if (!rank) return [el];
    var host = el.parentElement;
    if (host && host.tagName === 'SECTION' && host.firstElementChild === el) return [host];

    var run = [el];
    var n = el.nextElementSibling;
    while (n) {
      var r = rankOf(n);
      if (r && r <= rank) break;
      if (!CHROME[n.tagName]) run.push(n);
      n = n.nextElementSibling;
    }
    return run;
  }

  // Maps a set of leaf blocks up to the rows that contain them.
  function rowsFor(nodes) {
    var all = rows();
    var out = [];
    (nodes || []).forEach(function (n) {
      for (var i = 0; i < all.length; i++) {
        if (all[i] === n || all[i].contains(n)) {
          if (out.indexOf(all[i]) === -1) out.push(all[i]);
          return;
        }
      }
    });
    return out;
  }

  // Every editable block a row covers, so a deletion can be reported block by
  // block by the instruction set even though the row is the thing removed.
  function blocksIn(el) {
    var out = [];
    Ryker.blocks.sequence().forEach(function (b) {
      if (el === b || el.contains(b)) out.push(b);
    });
    return out;
  }

  return {
    rows: rows, tree: tree, unitOf: unitOf, kindOf: kindOf, label: label,
    keyOf: keyOf, rowsFor: rowsFor, blocksIn: blocksIn, rankOf: rankOf
  };
})();
