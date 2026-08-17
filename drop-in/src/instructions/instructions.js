// Turns a session's edits into a prompt an AI can act on.
//
// This is what Ryker exists for. Nothing durable is recorded anywhere; what is
// produced instead is a description of the difference between the document as
// authored and the document as it now stands, in terms someone can apply to the
// source file. On a report with a known source that description can be applied
// for you, and on a page whose source Ryker cannot reach it is the only output
// there could be, which is why it is the product rather than a fallback.
//
// Two rules govern the output. Everything is expressed against the ORIGINAL
// document, so five edits to one paragraph read as one change from the text
// that is actually in the file. And nothing refers to Ryker's own machinery:
// the source HTML has never heard of a block id, so an instruction that cites
// one cannot be followed.
Ryker.instructions = (function () {
  'use strict';

  var pristine = null; // blockId -> html as the document was authored
  var saved = null;    // blockId -> html as of the last save
  var saves = 0;
  var saveNotes = [];
  var baseline = null;
  var listeners = [];

  function captureOrigin() {
    pristine = Ryker.blocks.snapshot();
    baseline = null;
    return Object.keys(pristine).length;
  }

  // What the instructions in this session are measured against.
  //
  // Every record written from one page load quotes the same pristine document,
  // so all of them are cumulative supersets of each other and only the last is
  // worth keeping. A reload re-runs captureOrigin() against the document as it
  // then stands, and from that point the records quote a different starting
  // text, so they have to be COMPOSED with the earlier ones rather than
  // deduplicated against them.
  //
  // Nothing written before 2026-08-16 recorded which of those two cases it was
  // in. saveNumber resets on reload and is not it: the 17 records in the corpus
  // run to 5, reset to 2, reset to 1, then continue at 6.
  //
  // Derived from the content rather than minted at random on purpose. Two loads
  // of an unmodified document produce the same id and their records correctly
  // deduplicate; a load after edits produces a different one and its records
  // correctly compose. The grouping falls out of what the document was instead
  // of being asserted by whoever happened to be running.
  function baselineId() {
    if (baseline) return baseline;
    if (!pristine) return null;
    var keys = Object.keys(pristine).sort();
    var parts = keys.map(function (k) {
      return k + '\u0000' + Ryker.blocks.htmlOf(pristine[k]);
    });
    baseline = Ryker.blocks.hash(parts.join('\u0001'));
    return baseline;
  }

  function pristineHtml(id) {
    if (!pristine || !Object.prototype.hasOwnProperty.call(pristine, id)) return undefined;
    return Ryker.blocks.htmlOf(pristine[id]);
  }

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { try { f(); } catch (e) {} }); }

  function reset() { saved = null; saves = 0; saveNotes = []; emit(); }
  function originalOf(id) { return pristineHtml(id); }
  function saveCount() { return saves; }

  // Recomputed from the document, not accumulated. Accumulating each save's
  // changes meant the set could describe blocks that no longer existed.
  function record(note) {
    saved = Ryker.blocks.snapshot();
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
  function moves() {
    if (!pristine || !saved) return [];
    return Ryker.move.between(pristine, saved).map(function (m) {
      var d = Ryker.move.describe(m);
      return d ? { rec: m, at: d } : null;
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
        atomic: !!c.atomic, box: c.box || null, boxTag: c.boxTag || null
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
      out.push({
        kind: 'deletebox', tag: 'TABLE',
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

  // Where a block is, said in terms the source file actually contains.
  //
  // Ryker's own ids are derived from content or stamped at runtime, so neither
  // appears in the HTML being edited and neither can be used to find anything.
  // A real id attribute is used when the element has one; otherwise the block is
  // located by its position inside the nearest section that does.
  function where(id) { return placeOf(Ryker.blocks.byId(id)); }

  function placeOf(node) {
    if (!node) return null;
    if (node.id) return 'the element with id="' + node.id + '"';

    var scope = node.parentElement;
    while (scope && !scope.id && scope !== document.body) scope = scope.parentElement;
    var scopeName = scope && scope.id ? 'the section with id="' + scope.id + '"' : 'the document body';
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
    return label ? 'That element is a ' + label.charAt(0).toLowerCase() + label.slice(1) : null;
  }

  // One move, written so it can be followed without knowing anything about
  // Ryker. What moves is identified by the exact opening markup of its first
  // block, which is text the file actually contains.
  function moveStep(m, n, stepOf, out) {
    var rec = m.rec, at = m.at;
    var el = at.elements[0];
    var tag = at.tag ? '<' + at.tag.toLowerCase() + '>' : null;

    out.push('## ' + n + '. Move ' + (tag ? 'a ' + tag : at.elements.length + ' elements'));
    out.push('');
    if (at.elements.length === 1) {
      out.push('Move this one ' + (tag || 'element') + ' and everything inside it. Change nothing');
      out.push('about its contents. It is the element whose first block reads, exactly:');
    } else {
      out.push('Move these ' + at.elements.length + ' consecutive elements together, keeping their');
      out.push('order and changing nothing inside them. The first of them contains:');
    }
    out.push('<<<'); out.push(pristineHtml(rec.ids[0]) != null
      ? pristineHtml(rec.ids[0]) : ''); out.push('>>>');
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

    if (rec.wasAfter) {
      var w = text(pristineHtml(rec.wasAfter) != null ? pristineHtml(rec.wasAfter) : '');
      if (w) out.push('In the file it currently sits just after this text: "' +
        clipText(w) + '"');
    } else {
      out.push('In the file it is currently the first thing in the document body.');
    }
    out.push('');
    out.push('Blocks carried along: ' + at.blocks);

    if (at.nav.length) {
      out.push('');
      out.push('The contents list links into what moved. Move ' +
        (at.nav.length > 1 ? 'these entries' : 'the entry') + ' to match, so the list');
      out.push('stays in document order:');
      at.nav.forEach(function (t2) { out.push('  - "' + t2 + '"'); });
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
    var list = groupBoxes(edits());
    var mv = moves();
    var out = [];

    out.push('# Document edit instructions');
    out.push('');
    out.push('Document: ' + (document.title || cfg.RYKER_DOCUMENT_ID));
    out.push('File: ' + cfg.RYKER_DOCUMENT_PATH);
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
    out.push('Locate each element by the quoted FROM text, which is exact and unique.');
    out.push('The position given alongside it is a cross-check, not a selector. Replace');
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

    list.forEach(function (e, i) {
      var n = base + i + 1;
      out.push('---');
      out.push('');

      if (e.kind === 'replace') {
        var changesTag = e.beforeTag && e.afterTag && e.beforeTag !== e.afterTag;
        var sameContents = e.before === e.after;
        var replacementList = e.afterTag === 'LI' && (e.boxTag === 'OL' || e.boxTag === 'UL');
        if (replacementList) {
          out.push('## ' + n + '. Change <' + e.beforeTag.toLowerCase() + '> to an ' +
            (e.boxTag === 'OL' ? 'ordered' : 'unordered') + ' list');
        } else if (changesTag) {
          out.push('## ' + n + '. Change <' + e.beforeTag.toLowerCase() + '> to <' +
            e.afterTag.toLowerCase() + '>' + (sameContents ? '' : ' and replace its contents'));
        } else {
          out.push('## ' + n + '. Replace the contents of ' +
            (e.tag ? '<' + e.tag.toLowerCase() + '>' : 'a block'));
        }
        out.push('');
        var w = where(e.id);
        if (w) out.push('Position: ' + w);
        out.push('');
        if (changesTag && sameContents) {
          out.push('Keep the element\'s contents and attributes unchanged. Its current contents are:');
          out.push('<<<'); out.push(e.before); out.push('>>>');
        } else {
          out.push('FROM:');
          out.push('<<<'); out.push(e.before); out.push('>>>');
          out.push('');
          out.push('TO:');
          out.push('<<<'); out.push(e.after); out.push('>>>');
          out.push('');
          out.push('Plain text of the new version, for confirmation:');
          out.push('  ' + text(e.after));
        }

      } else if (e.kind === 'insert') {
        var tag = (e.tag || 'p').toLowerCase();
        var insertedList = tag === 'li' && (e.boxTag === 'OL' || e.boxTag === 'UL');
        if (insertedList) {
          out.push('## ' + n + '. Insert a new ' + (e.boxTag === 'OL' ? 'ordered' : 'unordered') +
            ' list (<'+ e.boxTag.toLowerCase() + '>) containing one <li>');
        } else {
          out.push('## ' + n + '. Insert a new <' + tag + '>');
        }
        out.push('');
        if (e.prev && stepOf[e.prev]) {
          out.push('Position: immediately after the element added in step ' + stepOf[e.prev] + '.');
        } else if (e.prev && editedAt[e.prev]) {
          // Quoting the original text here would point at wording an earlier
          // step has already replaced.
          out.push('Position: immediately after the element edited in step ' + editedAt[e.prev] + '.');
        } else if (e.prev) {
          var pw = where(e.prev);
          out.push('Position: immediately after ' + (pw || 'the preceding block') + '.');
          var ptext = text(pristineHtml(e.prev) != null ? pristineHtml(e.prev) : '');
          if (ptext) {
            out.push('That element begins: "' + (ptext.length > 80 ? ptext.slice(0, 77) + '...' : ptext) + '"');
          }
        } else {
          out.push('Position: as the first block of the document body.');
        }
        out.push('');
        out.push('CONTENT:');
        out.push('<<<');
        out.push(insertedList ? '<' + e.boxTag.toLowerCase() + '><li>' + e.after + '</li></' +
          e.boxTag.toLowerCase() + '>' : e.after);
        out.push('>>>');
        out.push('');
        out.push('Plain text, for confirmation:');
        out.push('  ' + text(e.after));

      } else if (e.kind === 'deletebox') {
        out.push('## ' + n + '. Delete a whole <table>');
        out.push('');
        out.push('Remove the entire <table> element, its rows and its cells. Leave any');
        out.push('caption, heading or paragraph around it alone unless another step names');
        out.push('it. The table is the one whose cells read, in order:');
        out.push('');
        e.cells.forEach(function (c, k) {
          var t = text(c);
          out.push('  ' + (k + 1) + '. ' + (t.length > 90 ? t.slice(0, 87) + '...' : t));
        });

      } else if (e.kind === 'delete' && e.atomic && String(e.tag).toUpperCase() === 'SVG') {
        out.push('## ' + n + '. Delete the whole <svg>');
        out.push('');
        out.push('Remove the entire SVG element, including all paths, shapes, labels and attributes.');
        out.push('Leave its surrounding container and adjacent content unchanged. Match this exact element:');
        out.push('<<<'); out.push(e.before); out.push('>>>');

      } else {
        out.push('## ' + n + '. Delete a block');
        out.push('');
        out.push('Remove the element whose exact contents are:');
        out.push('<<<'); out.push(e.before); out.push('>>>');
        out.push('');
        out.push('Plain text, for confirmation:');
        out.push('  ' + text(e.before));
      }
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
    recoveryChanges: recoveryChanges,
    saveCount: saveCount, saveNotes: notes,
    onChange: onChange, where: where, suspicious: suspicious
  };
})();
