// Turns a session's edits into a prompt an AI can act on.
//
// The prompt describes authored-to-current differences in source terms. Saved
// rounds may also persist the same data for recovery and explicit export, but
// instructions never rely on Ryker's runtime-only block ids as user locators.
Ryker.instructions = (function () {
  'use strict';

  var pristine = null; // blockId -> html as the document was authored
  var saved = null;    // blockId -> html as of the last save
  var pristineTree = null; // unit key -> where it sat, as authored
  var savedTree = null;    // unit key -> where it sat as of the last save
  var saves = 0;
  var saveNotes = [];
  var baseline = null;
  var session = null;  // one page load; scopes cumulative revision records
  var recovery = null; // stable in one tab so a refresh can find its draft
  var pristinePositions = {};
  var listeners = [];

  function tabSession() {
    var fresh = Ryker.dom.uid('session');
    if (Ryker.SURFACE === 'extension') return fresh;
    var key = 'ryker:session:' + Ryker.config.load().RYKER_DOCUMENT_ID;
    try {
      var saved = sessionStorage.getItem(key);
      if (saved) return saved;
      sessionStorage.setItem(key, fresh);
    } catch (e) { /* an in-memory id still keeps this page load safe */ }
    return fresh;
  }

  function captureOrigin() {
    pristine = Ryker.blocks.snapshot();
    pristineTree = Ryker.units.snapshot();
    baseline = null;
    pristinePositions = {};
    Object.keys(pristine).forEach(function (id) {
      pristinePositions[id] = placeOf(Ryker.blocks.byId(id));
    });
    recovery = tabSession();
    session = Ryker.dom.uid('edit');
    return Object.keys(pristine).length;
  }

  // Content-derived identity for the authored FROM state. Session identity is
  // separate because independent tabs can start from identical content.
  function baselineId() {
    if (baseline) return baseline;
    if (!pristine) return null;
    var keys = Object.keys(pristine);
    var parts = keys.map(function (k, i) {
      var p = pristine[k] || {};
      return [i, k, String(p.tag || '').toUpperCase(), p.prev || '',
        String(p.boxTag || '').toUpperCase(), p.atomic ? '1' : '0',
        Ryker.blocks.htmlOf(p)].join('\u0000');
    });
    baseline = Ryker.blocks.hash(parts.join('\u0001'));
    return baseline;
  }

  function sessionId() { return recovery; }
  function editingSessionId() { return session; }

  function pristineHtml(id) {
    if (!pristine || !Object.prototype.hasOwnProperty.call(pristine, id)) return undefined;
    return Ryker.blocks.htmlOf(pristine[id]);
  }

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  function reset() { saved = null; savedTree = null; saves = 0; saveNotes = []; emit(); }
  function originalOf(id) { return pristineHtml(id); }
  function saveCount() { return saves; }

  // Recomputed from the document, not accumulated. Accumulating each save's
  // changes meant the set could describe blocks that no longer existed.
  function record(note) {
    saved = Ryker.blocks.snapshot();
    savedTree = Ryker.units.snapshot();
    saves += 1;
    note = String(note || '').trim();
    if (note) saveNotes.push({ saveNumber: saves, text: note });
    emit();
  }

  function notes() {
    return saveNotes.map(function (n) { return { saveNumber: n.saveNumber, text: n.text }; });
  }

  // Reordering, which no block-by-block comparison can see. Derived the same
  // way edits are, against the document as authored, so a section dragged out
  // and dragged back again reports nothing.
  //
  // One record is one element. The old block-run form could not name a section
  // at all and emitted "move 3 elements" listing the section's children, which
  // told the reader to put them where they already were.
  function moves() {
    if (!pristineTree || !savedTree) return [];
    var live = Ryker.units.index();
    return Ryker.units.diff(pristineTree, savedTree).map(function (rec) {
      var el = live[rec.key];
      if (!el) return null;
      return { rec: rec, at: {
        elements: [el], tag: rec.tag,
        blocks: Array.prototype.filter.call(
          el.querySelectorAll(Ryker.blocks.SELECTOR), function (n) {
            return !Ryker.blocks.excluded(n) && !n.querySelector(Ryker.blocks.SELECTOR);
          }).length || (el.matches(Ryker.blocks.SELECTOR) ? 1 : 0),
        nav: Ryker.move.navFor ? Ryker.move.navFor([el]) : []
      } };
    }).filter(Boolean);
  }

  function edits() {
    if (!pristine || !saved) return [];
    return Ryker.blocks.diffSnapshots(pristine, saved).map(function (c) {
      return {
        id: c.id,
        kind: c.kind === 'added' ? 'insert' : (c.kind === 'removed' ? 'delete' : 'replace'),
        before: c.before, after: c.after,
        tag: c.tag || null, beforeTag: c.beforeTag || null,
        afterTag: c.afterTag || c.tag || null, prev: c.prev || null,
        atomic: !!c.atomic, box: c.box || null, boxTag: c.boxTag || null,
        row: c.row || null, col: c.col == null ? null : c.col
      };
    });
  }

  // The complete replayable delta from the authored document to what is on
  // screen now. Unlike edits(), this does not stop at the last Save boundary,
  // so it can checkpoint both saved rounds and typing still in progress for
  // recovery after a refresh.
  function recoveryChanges() {
    if (!pristine) return [];
    return Ryker.blocks.diffSnapshots(pristine, Ryker.blocks.snapshot());
  }

  // Unit records, not block runs. A record says which element moved, which
  // container it is in now and what it follows there, so replaying one puts a
  // section back as a section rather than scattering its children.
  function recoveryMoves() {
    if (!pristineTree) return [];
    return Ryker.units.diff(pristineTree, Ryker.units.snapshot());
  }

  // A table holds no blocks of its own: every cell is one. Deleting a table of
  // ten cells therefore reads as ten instructions to remove a word each, which
  // is both unfollowable and hides what actually happened. Where every block
  // inside a table is gone, say it once.
  //
  // The test matches the one the editor applies when it decides to remove a
  // table whole rather than cell by cell, and only tables qualify. A figure
  // reported this way would take an image out of the document on the strength
  // of a deleted caption.
  function groupBoxes(list) {
    var total = {};
    if (pristine) {
      Object.keys(pristine).forEach(function (id) {
        var e = pristine[id];
        var b = e && typeof e === 'object' ? e.box : null;
        if (b && e.boxTag === 'TABLE') total[b] = (total[b] || 0) + 1;
      });
    }

    var gone = {};
    list.forEach(function (e, i) {
      if (e.kind !== 'delete' || !e.box || e.boxTag !== 'TABLE') return;
      (gone[e.box] = gone[e.box] || []).push(i);
    });

    var whole = {};
    Object.keys(gone).forEach(function (b) {
      if (gone[b].length > 1 && gone[b].length === total[b]) whole[b] = gone[b];
    });
    if (!Object.keys(whole).length) return list;

    var out = [], done = {};
    list.forEach(function (e) {
      if (!e.box || !whole[e.box]) { out.push(e); return; }
      if (done[e.box]) return;
      done[e.box] = true;
      var first = list[whole[e.box][0]];
      out.push({
        kind: 'deletebox', tag: 'TABLE',
        position: first && first.id && where(first.id),
        cells: whole[e.box].map(function (j) { return list[j].before; })
      });
    });
    return out;
  }

  function text(html) {
    var t = document.createElement('div');
    t.innerHTML = html == null ? '' : html;
    return (t.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // Host-authored metadata lives outside the literal FROM/TO fences. Keep it
  // on one line and JSON-quote it so an id, title or path containing Markdown
  // cannot manufacture a new instruction section.
  function oneLine(value) {
    return String(value == null ? '' : value).replace(/[\r\n\u2028\u2029]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function quoted(value) { return JSON.stringify(oneLine(value)); }

  // Where a block is, said in terms the source file actually contains.
  //
  // Ryker's own ids are derived from content or stamped at runtime, so neither
  // appears in the HTML being edited and neither can be used to find anything.
  // A real id attribute is used when the element has one; otherwise the block is
  // located by its position inside the nearest section that does.
  function where(id) {
    if (Object.prototype.hasOwnProperty.call(pristinePositions, id)) {
      return pristinePositions[id];
    }
    return placeOf(Ryker.blocks.byId(id));
  }

  function placeOf(node) {
    if (!node) return null;
    if (node.id) return 'the element with id=' + quoted(node.id);

    var scope = node.parentElement;
    while (scope && !scope.id && scope !== document.body) scope = scope.parentElement;
    var scopeName = scope && scope.id ? 'the section with id=' + quoted(scope.id) : 'the document body';
    var within = (scope && scope.id) ? scope : Ryker.blocks.root();

    var tag = node.tagName.toLowerCase();
    var same = Array.prototype.filter.call(within.querySelectorAll(tag), function (n) {
      return !Ryker.blocks.excluded(n);
    });
    var idx = same.indexOf(node);
    if (idx === -1) return 'a <' + tag + '> inside ' + scopeName;
    return 'the ' + ordinal(idx + 1) + ' <' + tag + '> inside ' + scopeName;
  }

  // Identical content inserted more than once is almost always a slip, and an
  // instruction set that repeats it reads as deliberate unless something says
  // so. Named rather than silently deduplicated, because only the author knows
  // which copy was meant.
  function suspicious(list) {
    var out = [];
    var byText = {};
    list.forEach(function (e, i) {
      if (e.kind !== 'insert') return;
      var k = text(e.after);
      if (!k) return;
      (byText[k] = byText[k] || []).push(i + 1);
    });
    Object.keys(byText).forEach(function (k) {
      var steps = byText[k];
      if (steps.length < 2) return;
      out.push('Steps ' + steps.join(', ') + ' insert identical content: "' +
        (k.length > 70 ? k.slice(0, 67) + '...' : k) + '". ' +
        'That is usually a duplicate paste. Keep one unless all of them are meant.');
    });

    // Text removed from one block and inserted as another is a paragraph split,
    // which is fine, but the same text being both removed and inserted several
    // times is not.
    list.forEach(function (e, i) {
      if (e.kind !== 'replace') return;
      var lost = text(e.before).replace(text(e.after), '').trim();
      if (lost.length < 40) return;
      var echoes = [];
      list.forEach(function (o, j) {
        if (o.kind === 'insert' && text(o.after).indexOf(lost.slice(0, 40)) !== -1) echoes.push(j + 1);
      });
      if (echoes.length > 1) {
        out.push('Step ' + (i + 1) + ' removes a sentence that steps ' + echoes.join(', ') +
          ' then add back. Check the split was intended once, not ' + echoes.length + ' times.');
      }
    });
    return out;
  }

  // Where a moved element ends up, named at the level the element itself sits
  // at.
  //
  // The obvious answer, the block that precedes it in the finished order, is
  // the wrong one and reads as nonsense: a whole <section> came out as "move it
  // after the 101st <p> inside the section with id=rationale", and a <p> after
  // a <td>. Nothing can be placed after a cell.
  //
  // The move has already happened in the document, so the element's own
  // previous sibling IS the answer, exact and at the right level by
  // construction. Move steps are emitted in finished-document order, so where
  // one move lands against another the earlier step has already put its element
  // in place.
  function anchorOf(el) {
    var n = el.previousElementSibling;
    while (n && (n.tagName === 'SCRIPT' || n.tagName === 'STYLE')) n = n.previousElementSibling;
    return n;
  }

  // How to recognise the anchor, in one line.
  //
  // For a block that is its opening words, taken from the document as authored
  // rather than as edited: moves are applied before the rewrites, so quoting
  // the new wording would point at text the file does not contain yet.
  //
  // For a container it is the outline's own label, because textContent on a
  // table returns every cell run together with no spaces between them, which
  // came out as "#What changesWhereImpactEffortWhy R1Fix the Apple Pay hire
  // path" and identified nothing.
  function anchorLine(node) {
    var id = safeId(node);
    if (id != null) {
      var was = pristineHtml(id);
      var t = clipText(was !== undefined ? text(was) : Ryker.dom.textOf(node));
      return t ? 'That element begins: "' + t + '"' : null;
    }
    var label = Ryker.outline.label(node);
    return label ? 'That element is described as ' + quoted(label) + '.' : null;
  }

  // One move, written so it can be followed without knowing anything about
  // Ryker. What moves is identified by the exact opening markup of its first
  // block, which is text the file actually contains.
  function moveStep(m, n, stepOf, out) {
    var rec = m.rec, at = m.at;
    var el = at.elements[0];
    var tag = at.tag ? '<' + at.tag.toLowerCase() + '>' : null;

    out.push('## ' + n + '. Move ' + (tag ? 'a ' + tag : 'an element'));
    out.push('');
    out.push('Move this one ' + (tag || 'element') + ' and everything inside it. Change nothing');
    if (el.id) {
      out.push('about its contents. It is the one with id=' + quoted(el.id) + '.');
    } else {
      out.push('about its contents. It is the element whose first block reads, exactly:');
      out.push('<<<'); out.push(pristineHtml(rec.lead) != null
        ? pristineHtml(rec.lead) : ''); out.push('>>>');
    }
    out.push('');

    var anchor = anchorOf(el);
    if (!anchor) {
      var host = placeOf(el.parentElement);
      out.push('Put it first inside ' + (host || 'the document body') + ', before');
      out.push('everything else in there.');
    } else if (stepOf[safeId(anchor)]) {
      out.push('Put it immediately after the element added in step ' +
        stepOf[safeId(anchor)] + '.');
      out.push('Apply that step before this one.');
    } else {
      out.push('Put it immediately after ' + (placeOf(anchor) || 'the preceding element') + ',');
      out.push('as a sibling of it, not inside it.');
      var line = anchorLine(anchor);
      if (line) out.push(line);
    }
    out.push('');

    var wasAfter = rec.was ? Ryker.units.index()[rec.was] : null;
    if (wasAfter && wasAfter.id) {
      out.push('In the file it currently sits just after the element with id=' +
        quoted(wasAfter.id) + '.');
    } else if (rec.wasLead) {
      var w = text(pristineHtml(rec.wasLead) != null ? pristineHtml(rec.wasLead) : '');
      if (w) out.push('In the file it currently sits just after this text: "' +
        clipText(w) + '"');
    } else {
      var from = rec.wasParent ? Ryker.units.index()[rec.wasParent] : null;
      out.push('In the file it is currently the first thing inside ' +
        (from ? (placeOf(from) || 'its container') : 'the document body') + '.');
    }
    out.push('');
    out.push('Blocks carried along: ' + at.blocks);

    if (at.nav.length) {
      out.push('');
      out.push('The contents list links into what moved. Move ' +
        (at.nav.length > 1 ? 'these entries' : 'the entry') + ' to match, so the list');
      out.push('stays in document order:');
      at.nav.forEach(function (t2) { out.push('  - ' + quoted(t2)); });
    }
  }

  // Only a block has a block id, and asking for one anywhere else costs a walk
  // of the whole document to answer null.
  function safeId(node) {
    if (!node || !node.matches || !node.matches(Ryker.blocks.SELECTOR)) return null;
    if (Ryker.blocks.excluded(node)) return null;
    try { return Ryker.blocks.blockId(node); } catch (e) { return null; }
  }

  function clipText(s) {
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
  }

  function build() {
    var cfg = Ryker.config.load();
    // Whole tables first, then the rows and columns inside the ones that
    // survived. Reversing the two would take a deleted table apart row by row.
    var list = Ryker.steps.group(groupBoxes(edits()), pristine, saved,
      { where: where, text: text });
    var mv = moves();
    var out = [];

    out.push('# Document edit instructions');
    out.push('');
    out.push('Document: ' + quoted(document.title || cfg.RYKER_DOCUMENT_ID));
    out.push('File: ' + quoted(cfg.RYKER_DOCUMENT_PATH));
    out.push('Edits: ' + list.length + ' change(s)' +
      (mv.length ? ' and ' + mv.length + ' move(s)' : '') +
      ' across ' + saves + ' save(s) this session');
    out.push('');

    if (saveNotes.length) {
      out.push('## Context supplied with saves');
      out.push('');
      out.push('These optional notes explain the intent behind individual save rounds.');
      out.push('');
      saveNotes.forEach(function (note) {
        out.push('### Save ' + note.saveNumber);
        out.push('');
        String(note.text).split(/\r?\n/).forEach(function (line) {
          out.push('> ' + line);
        });
        out.push('');
      });
    }

    if (!list.length && !mv.length) {
      out.push('No edits have been made yet. Edit the document and press Save to');
      out.push('build a set of instructions here.');
      return out.join('\n');
    }

    var warnings = suspicious(list);
    if (warnings.length) {
      out.push('## Check these before applying');
      out.push('');
      warnings.forEach(function (w) { out.push('- ' + w); });
      out.push('');
      out.push('Everything below describes the document as it stands. Resolve anything');
      out.push('above first, or delete the steps you do not want, rather than applying a');
      out.push('set you already doubt.');
      out.push('');
    }

    out.push('Apply every edit below to the source HTML of this document as it was');
    out.push('authored. Every FROM below is the original text, so this applies cleanly');
    out.push('to a fresh copy of the file even where a block was edited several times.');
    out.push('');
    out.push('Locate each element using both its quoted FROM text and its Position.');
    out.push('The FROM text is exact but may also occur in another element. Position is');
    out.push('therefore part of the selector, not merely a cross-check. Replace');
    out.push('only the inner HTML, leaving the tag and its attributes alone. Add no');
    out.push('attributes of your own. Text between <<< and >>> is literal and includes');
    out.push('markup. Change nothing that is not named here.');
    out.push('');
    if (mv.length) {
      out.push('The first ' + mv.length + ' step(s) move elements rather than rewrite them.');
      out.push('Do those first and in the order given: each one names where an element');
      out.push('ends up in the finished document, so an earlier move has already put the');
      out.push('anchor a later one refers to in place. Move the element itself, with');
      out.push('everything inside it. Nothing inside a moved element changes.');
      out.push('');
    }

    // Moves run first, and the content steps are numbered from where they end.
    // A move is described by where its element sits in the FINAL document, so
    // applying them in the order given always finds the anchor already in
    // place. Doing them before the content edits also means every position a
    // later step quotes is the position that step will actually find.
    var base = mv.length;
    // Inserts chained off other inserts refer to the step that creates them,
    // since the element they follow does not exist in the file yet.
    var stepOf = {};       // blocks this set creates
    var editedAt = {};     // blocks this set rewrites
    list.forEach(function (e, i) {
      if (e.kind === 'insert') stepOf[e.id] = base + i + 1;
      else if (e.kind === 'replace') editedAt[e.id] = base + i + 1;
    });

    mv.forEach(function (m, i) {
      out.push('---');
      out.push('');
      moveStep(m, i + 1, stepOf, out);
      out.push('');
    });

    // Every function a step needs to describe the set it belongs to. Passed in
    // rather than reached for, so instructions/steps.js can be read, changed
    // and reasoned about without a live document behind it.
    var ctx = { where: where, text: text, pristine: pristineHtml,
                stepOf: stepOf, editedAt: editedAt };
    list.forEach(function (e, i) {
      out.push('---');
      out.push('');
      Ryker.steps.write(e, base + i + 1, ctx, out);
      out.push('');
    });

    out.push('---');
    out.push('');
    out.push('End of instructions. ' + list.length + ' edit(s)' +
      (mv.length ? ' and ' + mv.length + ' move(s)' : '') + '.');
    return out.join('\n');
  }

  return {
    record: record, build: build, edits: edits, moves: moves, reset: reset,
    captureOrigin: captureOrigin, originalOf: originalOf, baselineId: baselineId,
    sessionId: sessionId, editingSessionId: editingSessionId,
    recoveryChanges: recoveryChanges, recoveryMoves: recoveryMoves,
    saveCount: saveCount, saveNotes: notes,
    onChange: onChange, where: where, suspicious: suspicious
  };
})();
