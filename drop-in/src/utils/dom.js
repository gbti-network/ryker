// DOM helpers shared across Ryker. No dependencies, no globals beyond Ryker.
Ryker.dom = (function () {
  'use strict';

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
      });
    }
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  // Deterministic id for a block that has none of its own. Position-based ids
  // would move when a block is inserted above, so the path is taken from the
  // nearest ancestor that carries a real id and stays stable under text edits.
  function pathId(node, root) {
    var parts = [];
    var cur = node;
    while (cur && cur !== root) {
      if (cur.id) { parts.unshift('#' + cur.id); break; }
      var p = cur.parentNode;
      if (!p) break;
      var same = [];
      for (var i = 0; i < p.children.length; i++) {
        if (p.children[i].tagName === cur.tagName) same.push(p.children[i]);
      }
      parts.unshift(cur.tagName.toLowerCase() + (same.length > 1 ? ':' + same.indexOf(cur) : ''));
      cur = p;
    }
    return parts.join('/');
  }

  function textOf(node) {
    return (node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // Walks text nodes in document order, skipping anything Ryker owns.
  function textNodes(root) {
    var out = [];
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        while (p && p !== root) {
          var t = p.tagName;
          if (p.id === 'ryker-root' || t === 'SCRIPT' || t === 'STYLE' || t === 'SVG' || t === 'svg') {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = w.nextNode())) out.push(n);
    return out;
  }

  // Concatenated text of a root plus an index letting a global offset be
  // resolved back to a node and a local offset. Comment anchoring needs both.
  function flatten(root) {
    var nodes = textNodes(root);
    var text = '';
    var index = [];
    nodes.forEach(function (n) {
      index.push({ node: n, start: text.length, len: n.nodeValue.length });
      text += n.nodeValue;
    });
    return { text: text, index: index };
  }

  function locate(flat, offset) {
    for (var i = 0; i < flat.index.length; i++) {
      var e = flat.index[i];
      if (offset >= e.start && offset <= e.start + e.len) {
        return { node: e.node, offset: offset - e.start };
      }
    }
    return null;
  }

  function rangeFromOffsets(root, start, end) {
    var flat = flatten(root);
    var a = locate(flat, start);
    var b = locate(flat, end);
    if (!a || !b) return null;
    var r = document.createRange();
    try {
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
    } catch (e) { return null; }
    return r;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid(prefix) {
    var s = '';
    var bytes = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    for (var i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return (prefix || 'r') + '-' + s;
  }

  function now() { return new Date().toISOString(); }

  function fmtDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) +
        ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }

  return {
    el: el, pathId: pathId, textOf: textOf, textNodes: textNodes,
    flatten: flatten, locate: locate, rangeFromOffsets: rangeFromOffsets,
    escapeHtml: escapeHtml, uid: uid, now: now, fmtDate: fmtDate
  };
})();
