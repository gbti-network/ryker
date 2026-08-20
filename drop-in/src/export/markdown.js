// Giving a Markdown file back as Markdown.
//
// The naive version regenerates the whole file from the DOM, and it is wrong in
// a way that only shows up in review: a document written with `_emphasis_` and
// `+ bullets` comes back as `*emphasis*` and `- bullets` on every save, so a
// one word edit arrives as a diff touching every line. sow-006 Phase 4 settled
// the alternative and this is it. Each block carries the line range it was
// parsed from, an untouched block is copied out of the original text byte for
// byte, and only a block that actually changed is written from the DOM.
//
// So the serialiser below is deliberately small. It never runs on content
// nobody edited, which is why it is allowed to have opinions about `*` over `_`
// without those opinions reaching a file.
Ryker.exportMarkdown = (function () {
  'use strict';

  var source = null;

  // The workspace hands over the normalised source once, at open, before boot.
  // Nothing else may set it: a second document arrives through a reload, which
  // is the same lifecycle rule openTextAt() already enforces for identity.
  function adopt(text) {
    source = typeof text === 'string' ? text : null;
  }

  function available() {
    return source !== null && Ryker.config.isMarkdown();
  }

  function inlineOf(node) {
    var out = '';
    Array.prototype.forEach.call(node.childNodes, function (n) {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName;
      if (tag === 'CODE') { out += '`' + n.textContent + '`'; return; }
      if (tag === 'BR') { out += '  \n'; return; }
      var inner = inlineOf(n);
      if (tag === 'STRONG' || tag === 'B') out += '**' + inner + '**';
      else if (tag === 'EM' || tag === 'I') out += '*' + inner + '*';
      else if (tag === 'A') out += '[' + inner + '](' + (n.getAttribute('href') || '') + ')';
      // Anything the parser cannot produce is unwrapped rather than dropped.
      // Losing the words would be a silent deletion; losing the tag is visible
      // and recoverable by whoever reads the diff.
      else out += inner;
    });
    return out;
  }

  function cellsOf(tr) {
    return Array.prototype.map.call(tr.children, function (cell) {
      return inlineOf(cell).replace(/\|/g, '\\|').trim();
    });
  }

  function tableOf(el) {
    var out = [];
    var head = el.querySelector('thead tr');
    if (head) {
      out.push('| ' + cellsOf(head).join(' | ') + ' |');
      out.push('| ' + Array.prototype.map.call(head.children, function (cell) {
        var found = (cell.getAttribute('style') || '').match(/text-align:\s*(left|right|center)/);
        var align = found ? found[1] : '';
        if (align === 'center') return ':---:';
        if (align === 'right') return '---:';
        if (align === 'left') return ':---';
        return '---';
      }).join(' | ') + ' |');
    }
    Array.prototype.forEach.call(el.querySelectorAll('tbody tr'), function (tr) {
      out.push('| ' + cellsOf(tr).join(' | ') + ' |');
    });
    return out.join('\n');
  }

  function blockOf(el) {
    var tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      return new Array(Number(tag.charAt(1)) + 1).join('#') + ' ' + inlineOf(el);
    }
    if (tag === 'UL' || tag === 'OL') {
      var n = 0;
      return Array.prototype.map.call(el.children, function (li) {
        n += 1;
        // Never a literal `-` or `*` decision that could reach an untouched
        // line: the parser keeps only the item text, so the document's own
        // bullet convention is not recoverable here. It survives because
        // unchanged lists are copied rather than rewritten.
        return (tag === 'OL' ? n + '. ' : '- ') + inlineOf(li);
      }).join('\n');
    }
    if (tag === 'BLOCKQUOTE') {
      return inlineOf(el).split('\n').map(function (line) { return '> ' + line; }).join('\n');
    }
    if (tag === 'PRE') return '```\n' + el.textContent.replace(/\n+$/, '') + '\n```';
    if (tag === 'HR') return '---';
    if (tag === 'TABLE') return tableOf(el);
    return inlineOf(el);
  }

  // The parser is its own oracle. Re-render the block's original source lines
  // and compare against what is on screen now: equal means nobody touched it,
  // so its bytes are copied out untouched.
  //
  // This is why there is no `_` versus `*` problem. A guess based on
  // round-tripping the serialiser would call `_rate_` changed, because the
  // serialiser emits `*rate*`, and would then rewrite a line nobody edited.
  function intact(el, lines, from, to) {
    if (!window.RykerWorkspace || typeof window.RykerWorkspace.markdown !== 'function') return false;
    var original;
    try { original = window.RykerWorkspace.markdown(lines.slice(from, to + 1).join('\n')); }
    catch (error) { return false; }
    var probe = document.createElement('div');
    probe.innerHTML = original;
    return normalised(probe.firstElementChild) === normalised(el);
  }

  function normalised(el) {
    if (!el) return null;
    var copy = el.cloneNode(true);
    var all = [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('*')));
    all.forEach(function (n) {
      n.removeAttribute('data-ryker-md-src');
      n.removeAttribute('data-ryker-md-from');
      n.removeAttribute('data-ryker-md-to');
      n.removeAttribute('data-ryker-id');
    });
    return copy.outerHTML;
  }

  // Gaps between blocks are blank lines the parser never owned, so they are
  // reproduced from the source rather than invented. Two blocks still adjacent
  // in the source keep whatever separated them, including a run of blank lines
  // somebody put there on purpose. Blocks that moved lose that and fall back to
  // one blank line, which is the honest answer: the source no longer says what
  // belongs between them.
  function build() {
    if (!available()) {
      throw new Error('This document was not opened from Markdown, so there is no Markdown to write back.');
    }
    var doc = Ryker.exportHtml.snapshotDoc(false);
    var body = doc.body || doc.querySelector('body');
    var lines = source.split('\n');
    var out = [];
    var cursor = 0;
    var first = true;

    Array.prototype.forEach.call(body.children, function (el) {
      var fromAttr = el.getAttribute('data-ryker-md-from');
      var toAttr = el.getAttribute('data-ryker-md-to');
      var from = fromAttr === null ? -1 : Number(fromAttr);
      var to = toAttr === null ? -1 : Number(toAttr);
      var known = from >= 0 && to >= from && to < lines.length;

      // A gap of zero lines is not an empty line, it is nothing at all. Pushing
      // '' for it puts a separator in front of the first block and shifts the
      // whole file down by one.
      if (known && from > cursor) {
        out.push(lines.slice(cursor, from).join('\n'));
      } else if (!first && !(known && from >= cursor)) {
        out.push('');
      }
      first = false;

      if (known && intact(el, lines, from, to)) {
        out.push(lines.slice(from, to + 1).join('\n'));
      } else {
        out.push(blockOf(el));
      }
      if (known && to + 1 > cursor) cursor = to + 1;
    });

    // Whatever followed the last block in the original: a trailing blank line,
    // a comment, the newline at end of file.
    if (cursor < lines.length) out.push(lines.slice(cursor).join('\n'));
    var text = out.filter(function (part) { return part !== null; }).join('\n');
    return text.replace(/\n*$/, '\n');
  }

  return {
    adopt: adopt, available: available, build: build,
    blockOf: blockOf, inlineOf: inlineOf
  };
})();
