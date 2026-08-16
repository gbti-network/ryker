// Word-level diff for a single changed block.
//
// The journal captures deltas at write time, so nothing here diffs whole
// documents. All that remains is comparing two versions of one block, which is
// a small LCS and about 150 lines rather than a vendored diff library that
// would need splitting to meet the line cap.
Ryker.diff = (function () {
  'use strict';

  function tokenize(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html == null ? '' : html;
    var text = tmp.textContent || '';
    // Keep whitespace as its own token so rejoining reproduces the original
    // spacing rather than normalising it.
    return text.match(/\s+|[^\s]+/g) || [];
  }

  // Classic LCS table. Blocks are paragraphs, so the quadratic cost is fine;
  // a guard below falls back to a whole-block replace on anything pathological.
  function lcs(a, b) {
    var n = a.length, m = b.length;
    var table = new Array(n + 1);
    for (var i = 0; i <= n; i++) {
      table[i] = new Int32Array(m + 1);
    }
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    return table;
  }

  function words(beforeHtml, afterHtml) {
    var a = tokenize(beforeHtml);
    var b = tokenize(afterHtml);

    if (a.length * b.length > 4000000) {
      return [{ op: 'del', text: a.join('') }, { op: 'ins', text: b.join('') }];
    }

    var table = lcs(a, b);
    var out = [];
    var i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { push(out, 'same', a[i]); i++; j++; }
      else if (table[i + 1][j] >= table[i][j + 1]) { push(out, 'del', a[i]); i++; }
      else { push(out, 'ins', b[j]); j++; }
    }
    while (i < a.length) { push(out, 'del', a[i]); i++; }
    while (j < b.length) { push(out, 'ins', b[j]); j++; }
    return out;
  }

  function push(out, op, text) {
    var last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op: op, text: text });
  }

  // Counts for the revision panel. Whitespace-only runs are not changes anyone
  // wants counted, so they are excluded from the totals.
  function counts(parts) {
    var ins = 0, del = 0;
    parts.forEach(function (p) {
      if (!p.text.trim()) return;
      var n = (p.text.trim().match(/\S+/g) || []).length;
      if (p.op === 'ins') ins += n;
      else if (p.op === 'del') del += n;
    });
    return { additions: ins, removals: del };
  }

  function countChange(change) {
    if (change.kind === 'added') {
      return { additions: (tokenize(change.after).join('').trim().match(/\S+/g) || []).length, removals: 0 };
    }
    if (change.kind === 'removed') {
      return { additions: 0, removals: (tokenize(change.before).join('').trim().match(/\S+/g) || []).length };
    }
    return counts(words(change.before, change.after));
  }

  function renderInline(parts) {
    var d = Ryker.dom;
    var frag = document.createDocumentFragment();
    parts.forEach(function (p) {
      if (p.op === 'same') { frag.appendChild(document.createTextNode(p.text)); return; }
      var tag = p.op === 'ins' ? 'ins' : 'del';
      frag.appendChild(d.el(tag, { class: 'ryker-diff-' + p.op, text: p.text }));
    });
    return frag;
  }

  return { words: words, counts: counts, countChange: countChange, renderInline: renderInline, tokenize: tokenize };
})();
