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
  var pristineSource = null;   // block id -> the Markdown it was authored as
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
    // The authored Markdown for each block, taken here for the same reason the
    // position is: it is a property of the document as it arrived, and reading
    // it later would read it from a node somebody has since edited. The stamp
    // itself is never rewritten, but the node can stop existing.
    pristineSource = {};
    Object.keys(pristine).forEach(function (id) {
      var node = Ryker.blocks.byId(id);
      pristinePositions[id] = placeOf(node);
      var src = node && node.getAttribute ? node.getAttribute('data-ryker-md-src') : null;
      if (src != null) pristineSource[id] = src;
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

  // Serialising through the exporter's own inline writer rather than a second
  // one here is the point: two writers would drift, and the instruction would
  // then describe an edit the export does not make.
  function markdownOf(html) {
    // Throws rather than degrading, deliberately. The first version of this
    // guard returned the HTML unchanged if the member was missing, and when the
    // reference turned out to name the wrong module every TO payload silently
    // stayed HTML while the suite went green. A missing capability may degrade;
    // a missing module member is a typo, and a typo has to be loud.
    if (!Ryker.exportMarkdown || !Ryker.exportMarkdown.inlineOf) {
      throw new Error('instructions: Ryker.exportMarkdown.inlineOf is missing, ' +
        'so a Markdown TO cannot be written');
    }
    var holder = document.createElement('div');
    holder.innerHTML = html == null ? '' : html;
    return Ryker.exportMarkdown.inlineOf(holder);
  }

  // The exporter's block writer, so an inserted heading in a prompt and an
  // inserted heading in an export cannot disagree about what a prefix is.
  function markdownBlockOf(tag, html) {
    if (!Ryker.exportMarkdown || !Ryker.exportMarkdown.blockOf) {
      throw new Error('instructions: Ryker.exportMarkdown.blockOf is missing, ' +
        'so a Markdown insert cannot be written');
    }
    var holder = document.createElement(/^[A-Z][A-Z0-9]*$/.test(tag || '') ? tag : 'p');
    holder.innerHTML = html == null ? '' : html;
    return Ryker.exportMarkdown.blockOf(holder);
  }

  function authoredSource(id) {
    if (!pristineSource || !Object.prototype.hasOwnProperty.call(pristineSource, id)) return null;
    return pristineSource[id];
  }

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
        elements: [el], tag: rec.tag, blocks: rec.blocks,
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

    // A Position naming a tag and an id is worse than useless in a Markdown
    // file, because the preamble says Position is part of the selector and
    // neither of those things is in the source. It names structure instead,
    // through the same vocabulary the steps use, so there is still one place
    // where a Markdown word is decided.
    if (Ryker.config.isMarkdown()) {
      var tagName = node.tagName.toLowerCase();
      var root = Ryker.blocks.root();
      // A move to the front hands this the root itself, and "the 1st block in
      // the document" would be a description of the whole document.
      if (node === root || node === document.body) return 'the document';
      var kin = Array.prototype.filter.call(root.querySelectorAll(tagName), function (n) {
        return !Ryker.blocks.excluded(n);
      });
      var at = kin.indexOf(node);
      var noun = Ryker.steps.word({ format: 'markdown' }, 'bareBlock', node.tagName);
      return at === -1 ? 'a ' + noun + ' in the document'
        : 'the ' + ordinal(at + 1) + ' ' + noun + ' in the document';
    }

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
  function writerCtx(stepOf, editedAt) {
    return { where: where, text: text, pristine: pristineHtml,
             stepOf: stepOf || {}, editedAt: editedAt || {},
             format: Ryker.config.isMarkdown() ? 'markdown' : 'html',
             source: authoredSource, md: markdownOf, mdBlock: markdownBlockOf,
             place: placeOf, quote: quoted };
  }

  // The move writer lives in instructions/moves.js. These stay because the
  // suspicious() and build() paths below use them for their own reasons.
  function safeId(node) { return Ryker.moveStep.safeId(node); }
  function clipText(s) { return Ryker.moveStep.clipText(s); }

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

    // Handed a Markdown file, every sentence of the HTML preamble was false:
    // it named a source the file does not have, told the reader to preserve
    // tags and attributes that do not exist, and promised that the text
    // between the fences was markup. This is the half of the SOW that produced
    // wrong work rather than wrong labels, because an assistant acts on it.
    if (Ryker.config.isMarkdown()) {
      out.push('Apply every edit below to the Markdown source of this document as it');
      out.push('was authored. Every FROM below is the original Markdown, so this applies');
      out.push('cleanly to a fresh copy of the file even where a block was edited');
      out.push('several times.');
      out.push('');
      out.push('Locate each line using both its quoted FROM text and its Position.');
      out.push('The FROM text is exact but may also occur elsewhere in the file.');
      out.push('Position is therefore part of the selector, not merely a cross-check.');
      out.push('When a step replaces text, replace the text of the line, leave its');
      out.push('Markdown prefix alone unless the step says otherwise, and keep the blank');
      out.push('lines around it as they are. A step that inserts a block says what');
      out.push('spacing it needs.');
      out.push('Text between <<< and >>> is literal Markdown. Change nothing that is not');
      out.push('named here.');
      out.push('');
    } else {
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
    }
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
      Ryker.moveStep.write(m, i + 1, stepOf, out, writerCtx(stepOf));
      out.push('');
    });

    // Every function a step needs to describe the set it belongs to. Passed in
    // rather than reached for, so instructions/steps.js can be read, changed
    // and reasoned about without a live document behind it.
    var ctx = writerCtx(stepOf, editedAt);
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
